import { Chess } from 'chess.js';
import { HttpError } from './http-server.ts';
import { providerFetch, type Fetcher } from './provider-http.ts';
import { type Provider, isProvider, providers, validModel } from './tutor-config.ts';
import type { Credential } from './tutor-sessions.ts';
import { tutorCoordinates, type Lesson, type TutorEvidence } from './teaching.ts';

const instructions = '你是繁體中文西洋棋初學者教練。只依據提供的引擎事實與合法變化線講解。不要自行計算走法、發明棋子位置、宣稱唯一解、把局勢分數當勝率，或假設對手必定依示範線走。以簡單、友善、具體的文字說明為什麼要改進、如何比較建議走法，以及下一局的一個檢查習慣。只引用提供的 factIds；沒有依據時承認無法判定戰術原因。';
function authorizationHeaders({ provider, key }: Credential): Record<string, string> {
  if (provider === 'openai') return { Authorization: `Bearer ${key}` };
  if (provider === 'claude') return { 'x-api-key': key, 'anthropic-version': '2026-10-21' };
  return { 'x-goog-api-key': key };
}
// Only fixed, actionable messages leave the server; provider bodies may contain secrets.
export class TutorProviderError extends Error {
  code: string;
  constructor(code: string, message: string) { super(message); this.code = code; }
}
function providerFailure(status: number): TutorProviderError {
  // Preserve the status rather than treating every upstream failure as missing quota.
  // Do not forward error bodies, headers or statusText, which may contain private data.
  const failure = (code: string, message: string) => new TutorProviderError(code, `HTTP ${status}：${message}`);
  if (status === 401 || status === 403) return failure('access', 'AI 服務拒絕生成：請確認金鑰與模型的生成權限，再到 AI 設定重新連接。');
  if (status === 429) return failure('quota', 'AI 服務的額度不足或請求過於頻繁：請檢查該服務的 API 額度與計費，稍後再試。');
  if (status === 404) return failure('model', '找不到可生成解說的模型：請到 AI 設定確認模型 ID。');
  if (status === 400 || status === 422) return failure('request', '模型不支援目前的結構化教學請求：請在 AI 設定改用預設文字模型。');
  if (status === 500) return failure('service', '上游回報內部錯誤；這不是額度不足的狀態碼。請稍後重試，持續發生可更換可用模型。');
  if (status === 502) return failure('service', 'AI 服務或中間閘道回應異常，請稍後重試。');
  if (status === 503) return failure('service', '上游暫時無法提供服務，可能忙碌或維護；不代表你的免費額度已用完。請稍後重試或更換可用模型。');
  if (status === 504) return failure('service', '上游或中間閘道等待生成逾時，請稍後重試。');
  if (status === 529) return failure('service', 'AI 服務目前過載，請稍後重試。');
  return failure('service', 'AI 服務未成功處理生成請求，請依狀態碼檢查服務或網路。');
}
export async function verifyCredential(credential: Credential, fetcher?: Fetcher, signal?: AbortSignal) {
  const { provider, model } = credential;
  if (!validModel(model, provider)) throw new HttpError(400, '模型名稱不正確。');
  const url = provider === 'openai' ? `https://api.openai.com/v1/models/${encodeURIComponent(model)}` : provider === 'claude' ? `https://api.anthropic.com/v1/models/${encodeURIComponent(model)}` : `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}`;
  const headers = authorizationHeaders(credential);
  try {
    const timeout = AbortSignal.timeout(12000);
    const response = await providerFetch(url, { method: 'GET', headers, signal: signal ? AbortSignal.any([signal, timeout]) : timeout }, fetcher);
    if (!response.ok) {
      await response.body?.cancel();
      if ([401, 403].includes(response.status)) throw new HttpError(400, '金鑰無效、已撤銷或沒有模型存取權，請檢查金鑰與服務選擇。');
      if (response.status === 404) throw new HttpError(400, '找不到這個模型，或此金鑰無權存取。請確認模型名稱。');
      if (response.status === 429) throw new HttpError(429, '服務暫時限流或額度不足，請稍後再測試。');
      throw new HttpError(502, 'AI 服務暫時無法回應，原有連線未變更。');
    }
    const body = await response.text(); if (body.length > 50000) throw new Error('Oversized model metadata');
    const data = JSON.parse(body);
    // Anthropic resolves model aliases to a dated ID; exact equality would reject valid aliases.
    const supported = provider === 'openai' ? data.id === model
      : provider === 'claude' ? data.type === 'model' && validModel(data.id, 'claude') && data.capabilities?.structured_outputs?.supported !== false
      : data.name === `models/${model}` && data.supportedGenerationMethods?.includes('generateContent');
    if (!supported) throw new HttpError(400, '這個模型無法用於目前的文字教學介面。');
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(502, '無法完成連線測試，請確認網路與模型名稱後重試。');
  }
}

export async function generateTutor(credential: Credential, evidence: TutorEvidence, lesson: Lesson, signal: AbortSignal, fetcher?: Fetcher): Promise<unknown> {
  const schema = { type: 'object', additionalProperties: false,
    properties: { title: { type: 'string', minLength: 1, maxLength: 40 }, why: { type: 'array', minItems: 1, maxItems: 2, items: { type: 'string', minLength: 1, maxLength: 120 } }, better: { type: 'string', minLength: 1, maxLength: 200 }, takeaway: { type: 'string', minLength: 1, maxLength: 80 }, factIds: { type: 'array', minItems: 1, maxItems: lesson.facts.length, items: { type: 'string', enum: lesson.facts.map(f => f.id) } } },
    required: ['title', 'why', 'better', 'takeaway', 'factIds'],
  };
  const input = JSON.stringify({ allowedSquares: tutorCoordinates(lesson, evidence), outputRules: '提供精簡解說，全文以約200字為目標，不必填滿上限。只可提及 allowedSquares 內的格子。title 最多40字；why 1至2項，每項最多120字；better 最多200字；takeaway 最多80字。不要重算棋局或重複整條變化線。不要用 Markdown 包住 JSON。', facts: lesson.facts, theme: lesson.theme, bestLine: lesson.bestLine, playedLine: lesson.playedLine, scorePerspective: 'white', learner: new Chess(evidence.fen).turn() });
  const { provider, model } = credential;
  const url = provider === 'openai' ? 'https://api.openai.com/v1/chat/completions' : provider === 'claude' ? 'https://api.anthropic.com/v1/messages' : `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const headers = { 'Content-Type': 'application/json', ...authorizationHeaders(credential) };
  // Claude does not accept string-length or maxItems constraints. Keep them in the
  // prompt and validate locally, while the API constrains types, keys and references.
  const claudeSchema = { ...schema, properties: {
    title: { type: 'string' }, why: { type: 'array', minItems: 1, items: { type: 'string' } },
    better: { type: 'string' }, takeaway: { type: 'string' },
    factIds: { type: 'array', minItems: 1, items: schema.properties.factIds.items },
  } };
  const body = provider === 'openai' ? { model, max_completion_tokens: 4096, store: false,
    messages: [{ role: 'system', content: instructions }, { role: 'user', content: input }],
    response_format: { type: 'json_schema', json_schema: { name: 'chess_lesson', strict: true, schema } },
  } : provider === 'claude' ? { model, max_tokens: 4096, system: instructions,
    messages: [{ role: 'user', content: input }], output_config: { format: { type: 'json_schema', schema: claudeSchema } },
  } : { systemInstruction: { parts: [{ text: instructions }] }, contents: [{ role: 'user', parts: [{ text: input }] }], generationConfig: { maxOutputTokens: 4096, ...(/^gemini-[3-9]/.test(model) ? { thinkingConfig: { thinkingLevel: 'LOW' } } : /^gemini-2\.5-flash/.test(model) ? { thinkingConfig: { thinkingBudget: 0 } } : {}), responseMimeType: 'application/json', responseJsonSchema: schema } };
  const response = await providerFetch(url, { method: 'POST', signal, headers, body: JSON.stringify(body) }, fetcher);
  if (!response.ok) { await response.body?.cancel(); throw providerFailure(response.status); }
  const raw = await response.text(); if (raw.length > 50000) throw new Error('Provider response too large');
  const data = JSON.parse(raw);
  let text: string;
  if (provider === 'openai') {
    if (data?.choices?.[0]?.finish_reason === 'length') throw new TutorProviderError('output_limit', 'AI 回覆達到輸出上限，未完成解說；請改用預設文字模型後重試。');
    const message = data?.choices?.[0]?.message;
    if (message?.refusal || typeof message?.content !== 'string') throw new TutorProviderError('blocked', 'AI 服務沒有提供可用文字，請稍後重試或更換文字模型。');
    text = message.content;
  } else if (provider === 'claude') {
    if (data?.stop_reason === 'max_tokens') throw new TutorProviderError('output_limit', 'Claude 回覆達到輸出上限，未完成解說；請稍後重試或更換模型。');
    if (data?.stop_reason !== 'end_turn' || !Array.isArray(data?.content)) throw new TutorProviderError('blocked', 'Claude 沒有提供完整的文字解說，請稍後重試或更換模型。');
    text = data.content.filter((p: { type?: string; text?: string }) => p.type === 'text' && typeof p.text === 'string').map((p: { text: string }) => p.text).join('');
  } else {
    const candidate = data?.candidates?.[0];
    if (candidate?.finishReason === 'MAX_TOKENS') throw new TutorProviderError('output_limit', 'AI 思考或文字達到輸出上限，未完成解說；請改用預設文字模型後重試。');
    if (!candidate || candidate.finishReason !== 'STOP' || !Array.isArray(candidate.content?.parts)) throw new Error('No completed text');
    text = candidate.content.parts.filter((p: { thought?: boolean; text?: string }) => !p.thought && typeof p.text === 'string').map((p: { text: string }) => p.text).join('');
  }
  return JSON.parse(text);
}
export function credentialFromInput(value: unknown): Credential {
  const data = value as Record<string, unknown> | null;
  if (!data || typeof data !== 'object' || Array.isArray(data) || !isProvider(data.provider)) throw new HttpError(400, '請選擇 OpenAI、Google Gemini 或 Claude。');
  if (typeof data.key !== 'string' || !/^[A-Za-z0-9._-]{10,512}$/.test(data.key.trim())) throw new HttpError(400, '請輸入有效的 API 金鑰，且不要包含空格或換行。');
  const provider: Provider = data.provider;
  const model = typeof data.model === 'string' ? data.model.trim() : providers[provider].model;
  if (!validModel(model, provider)) throw new HttpError(400, '模型名稱不正確，請只輸入模型 ID，不要輸入網址。');
  return { provider, key: data.key.trim(), model };
}
