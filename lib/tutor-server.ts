import { createHash } from 'node:crypto';
import { Chess } from 'chess.js';
import { EnvHttpProxyAgent, fetch as proxyFetch } from 'undici';
import { buildLesson, validateEvidence, validateTutorText, type Lesson, type TutorEvidence, type TutorText } from './teaching.ts';

export type TutorResponse = { source: 'engine' | 'ai'; text: TutorText; notice: string };
type Options = { key?: string; model?: string; fetcher?: typeof fetch; signal?: AbortSignal };
const cache = new Map<string, { expires: number; result: TutorResponse }>();
let active = 0; let used = 0; let resetAt = 0;
let transport: EnvHttpProxyAgent | undefined;
const fallback = (lesson: Lesson, notice: string): TutorResponse => ({ source: 'engine', text: { title: lesson.title, why: lesson.why, better: lesson.better, takeaway: lesson.takeaway, factIds: lesson.factIds }, notice });

export async function tutorReply(raw: unknown, options: Options = {}): Promise<TutorResponse> {
  const evidence: TutorEvidence = validateEvidence(raw);
  const lesson = buildLesson(evidence);
  if (!options.key) return fallback(lesson, '目前使用引擎教學；站方尚未啟用 AI 教練。');
  const model = options.model || 'gpt-4.1-mini';
  const key = createHash('sha256').update(JSON.stringify({ evidence, model, version: 2 })).digest('hex');
  const now = Date.now();
  for (const [id, entry] of cache) if (entry.expires <= now) cache.delete(id);
  const cached = cache.get(key);
  if (cached) return cached.result;
  if (now >= resetAt) { used = 0; resetAt = now + 10 * 60 * 1000; }
  if (active >= 2 || used >= 20) return fallback(lesson, 'AI 教練目前較忙，先使用引擎教學，稍後可重試。');
  active++; used++;
  try {
    const signal = options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000);
    const request = {
      method: 'POST', signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${options.key}` },
      body: JSON.stringify({
        model, max_completion_tokens: 900, store: false,
        messages: [
          { role: 'system', content: '你是繁體中文西洋棋初學者教練。只依據提供的引擎事實與合法變化線講解。不要自行計算走法、發明棋子位置、宣稱唯一解、把局勢分數當勝率，或假設對手必定依示範線走。以簡單、友善、具體的文字說明為什麼要改進、如何比較建議走法，以及下一局的一個檢查習慣。只引用提供的 factIds；沒有依據時承認無法判定戰術原因。' },
          { role: 'user', content: JSON.stringify({ facts: lesson.facts, theme: lesson.theme, bestLine: lesson.bestLine, playedLine: lesson.playedLine, scorePerspective: 'white', learner: new Chess(evidence.fen).turn() }) },
        ],
        response_format: { type: 'json_schema', json_schema: { name: 'chess_lesson', strict: true, schema: {
          type: 'object', additionalProperties: false,
          properties: { title: { type: 'string' }, why: { type: 'array', items: { type: 'string' } }, better: { type: 'string' }, takeaway: { type: 'string' }, factIds: { type: 'array', items: { type: 'string', enum: lesson.facts.map(f => f.id) } } },
          required: ['title', 'why', 'better', 'takeaway', 'factIds'],
        } } },
      }),
    };
    const url = 'https://api.openai.com/v1/chat/completions';
    const response = options.fetcher
      ? await options.fetcher(url, request)
      : await proxyFetch(url, { ...request, dispatcher: transport ??= new EnvHttpProxyAgent() });
    if (!response.ok) throw new Error('Provider unavailable');
    const body = await response.text();
    if (body.length > 50000) throw new Error('Provider response too large');
    const payload = JSON.parse(body);
    const message = payload?.choices?.[0]?.message;
    if (message?.refusal || typeof message?.content !== 'string') throw new Error('No usable text');
    const text = validateTutorText(JSON.parse(message.content), lesson, evidence);
    const result: TutorResponse = { source: 'ai', text, notice: 'AI 解說根據引擎資料生成，仍可能有誤；請搭配棋盤變化線核對。' };
    if (cache.size >= 100) cache.delete(cache.keys().next().value!);
    cache.set(key, { expires: now + 15 * 60 * 1000, result });
    return result;
  } catch {
    // Never expose provider errors or authentication values to the client.
    return fallback(lesson, 'AI 教練暫時無法提供可靠回覆，先使用引擎教學。');
  } finally { active--; }
}
