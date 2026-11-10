import { Chess } from 'chess.js';
import { HttpError } from './http-server.ts';
import { providerFetch, type Fetcher } from './provider-http.ts';
import { type Provider, providers, validModel } from './tutor-config.ts';
import type { Credential } from './tutor-sessions.ts';
import type { Lesson, TutorEvidence } from './teaching.ts';

const instructions = '你是繁體中文西洋棋初學者教練。只依據提供的引擎事實與合法變化線講解。不要自行計算走法、發明棋子位置、宣稱唯一解、把局勢分數當勝率，或假設對手必定依示範線走。以簡單、友善、具體的文字說明為什麼要改進、如何比較建議走法，以及下一局的一個檢查習慣。只引用提供的 factIds；沒有依據時承認無法判定戰術原因。';
export async function verifyCredential(credential: Credential, fetcher?: Fetcher, signal?: AbortSignal) {
  const { key, provider, model } = credential;
  if (!validModel(model, provider)) throw new HttpError(400, '模型名稱不正確。');
  const url = provider === 'openai' ? `https://api.openai.com/v1/models/${encodeURIComponent(model)}` : `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}`;
  const headers: Record<string, string> = provider === 'openai' ? { Authorization: `Bearer ${key}` } : { 'x-goog-api-key': key };
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
    if (provider === 'openai' ? data.id !== model : data.name !== `models/${model}` || !data.supportedGenerationMethods?.includes('generateContent')) throw new HttpError(400, '這個模型無法用於目前的文字教學介面。');
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(502, '無法完成連線測試，請確認網路與模型名稱後重試。');
  }
}

export async function generateTutor(credential: Credential, evidence: TutorEvidence, lesson: Lesson, signal: AbortSignal, fetcher?: Fetcher): Promise<unknown> {
  const schema = { type: 'object', additionalProperties: false,
    properties: { title: { type: 'string' }, why: { type: 'array', items: { type: 'string' } }, better: { type: 'string' }, takeaway: { type: 'string' }, factIds: { type: 'array', items: { type: 'string', enum: lesson.facts.map(f => f.id) } } },
    required: ['title', 'why', 'better', 'takeaway', 'factIds'],
  };
  const input = JSON.stringify({ facts: lesson.facts, theme: lesson.theme, bestLine: lesson.bestLine, playedLine: lesson.playedLine, scorePerspective: 'white', learner: new Chess(evidence.fen).turn() });
  const { provider, key, model } = credential;
  const url = provider === 'openai' ? 'https://api.openai.com/v1/chat/completions' : `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const headers: Record<string, string> = provider === 'openai' ? { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` } : { 'Content-Type': 'application/json', 'x-goog-api-key': key };
  const body = provider === 'openai' ? { model, max_completion_tokens: 900, store: false,
    messages: [{ role: 'system', content: instructions }, { role: 'user', content: input }],
    response_format: { type: 'json_schema', json_schema: { name: 'chess_lesson', strict: true, schema } },
  } : { systemInstruction: { parts: [{ text: instructions }] }, contents: [{ role: 'user', parts: [{ text: input }] }], generationConfig: { maxOutputTokens: 1500, responseMimeType: 'application/json', responseJsonSchema: schema } };
  const response = await providerFetch(url, { method: 'POST', signal, headers, body: JSON.stringify(body) }, fetcher);
  if (!response.ok) { await response.body?.cancel(); throw new Error('Provider unavailable'); }
  const raw = await response.text(); if (raw.length > 50000) throw new Error('Provider response too large');
  const data = JSON.parse(raw);
  let text: string;
  if (provider === 'openai') {
    const message = data?.choices?.[0]?.message;
    if (message?.refusal || typeof message?.content !== 'string') throw new Error('No usable text');
    text = message.content;
  } else {
    const candidate = data?.candidates?.[0];
    if (!candidate || candidate.finishReason !== 'STOP' || !Array.isArray(candidate.content?.parts)) throw new Error('No completed text');
    text = candidate.content.parts.filter((p: { thought?: boolean; text?: string }) => !p.thought && typeof p.text === 'string').map((p: { text: string }) => p.text).join('');
  }
  return JSON.parse(text);
}
export function credentialFromInput(value: unknown): Credential {
  const data = value as Record<string, unknown> | null;
  if (!data || typeof data !== 'object' || Array.isArray(data) || (data.provider !== 'openai' && data.provider !== 'gemini')) throw new HttpError(400, '請選擇 OpenAI 或 Google Gemini。');
  if (typeof data.key !== 'string' || !/^[A-Za-z0-9._-]{10,512}$/.test(data.key.trim())) throw new HttpError(400, '請輸入有效的 API 金鑰，且不要包含空格或換行。');
  const provider: Provider = data.provider;
  const model = typeof data.model === 'string' ? data.model.trim() : providers[provider].model;
  if (!validModel(model, provider)) throw new HttpError(400, '模型名稱不正確，請只輸入模型 ID，不要輸入網址。');
  return { provider, key: data.key.trim(), model };
}
