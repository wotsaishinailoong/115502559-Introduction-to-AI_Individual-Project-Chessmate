import { createHash } from 'node:crypto';
import { buildLesson, validateEvidence, validateTutorText, type Lesson, type TutorText } from './teaching.ts';
import { providers, validModel, type Provider } from './tutor-config.ts';
import { generateTutor } from './tutor-provider.ts';

export type TutorResponse = { source: 'engine' | 'ai'; text: TutorText; notice: string };
type Options = { key?: string; provider?: Provider; model?: string; fetcher?: typeof fetch; signal?: AbortSignal };
const cache = new Map<string, { expires: number; result: TutorResponse }>();
const budgets = new Map<string, { used: number; resetAt: number }>();
let active = 0;
const fallback = (lesson: Lesson, notice: string): TutorResponse => ({ source: 'engine', text: { title: lesson.title, why: lesson.why, better: lesson.better, takeaway: lesson.takeaway, factIds: lesson.factIds }, notice });

export async function tutorReply(raw: unknown, options: Options = {}): Promise<TutorResponse> {
  const evidence = validateEvidence(raw); const lesson = buildLesson(evidence);
  if (!options.key) return fallback(lesson, '目前使用引擎教學；可在 AI 設定中連接自己的金鑰。');
  const provider = options.provider ?? 'openai'; const model = options.model || providers[provider].model;
  if (!validModel(model, provider)) return fallback(lesson, '模型設定不正確，先使用引擎教學。');
  const scope = createHash('sha256').update(provider).update(options.key).digest('hex');
  const key = createHash('sha256').update(JSON.stringify({ evidence, provider, model, scope, version: 3 })).digest('hex');
  const now = Date.now();
  for (const [id, entry] of cache) if (entry.expires <= now) cache.delete(id);
  const cached = cache.get(key); if (cached) return cached.result;
  for (const [id, budget] of budgets) if (budget.resetAt <= now) budgets.delete(id);
  const budget = budgets.get(scope) ?? { used: 0, resetAt: now + 10 * 60 * 1000 };
  if (active >= 2 || budget.used >= 20 || !budgets.has(scope) && budgets.size >= 100) return fallback(lesson, 'AI 教練目前較忙，先使用引擎教學，稍後可重試。');
  budgets.set(scope, budget); active++; budget.used++;
  try {
    const timeout = AbortSignal.timeout(provider === 'gemini' ? 20000 : 15000);
    const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
    const rawText = await generateTutor({ key: options.key, provider, model }, evidence, lesson, signal, options.fetcher);
    const text = validateTutorText(rawText, lesson, evidence);
    const result: TutorResponse = { source: 'ai', text, notice: `${providers[provider].name} 解說根據引擎資料生成，仍可能有誤；請搭配棋盤變化線核對。` };
    if (cache.size >= 100) cache.delete(cache.keys().next().value!);
    cache.set(key, { expires: now + 15 * 60 * 1000, result }); return result;
  } catch { return fallback(lesson, 'AI 教練暫時無法提供可靠回覆，請檢查 AI 設定；先使用引擎教學。'); }
  finally { active--; }
}
