import { Chess } from 'chess.js';
import { classify, keyMoments, legalLine, parseGame, type Evaluation, type Report, type Score } from './analysis.ts';
import { buildLesson, evidenceFromPosition } from './teaching.ts';

export const LIBRARY_KEY = 'chessmate.library.v1';
export const MAX_REPORTS = 20;
export const MAX_LIBRARY_CHARS = 2_000_000;
type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;
export type Practice = { attempts: number; successes: number; independentSuccesses: number; lastAttemptAt: number | null; lastOutcome: 'success' | 'retry' | null };
export type SavedAnalysis = { id: string; pgn: string; report: Report; createdAt: number; updatedAt: number; practice: Record<string, Practice> };
export type Library = { version: 1; activeId: string | null; entries: SavedAnalysis[] };
export const emptyLibrary = (): Library => ({ version: 1, activeId: null, entries: [] });
export const emptyPractice = (): Practice => ({ attempts: 0, successes: 0, independentSuccesses: 0, lastAttemptAt: null, lastOutcome: null });
export const needsPractice = (p: Practice) => !p.independentSuccesses || p.lastOutcome === 'retry';
const cache = new WeakMap<StorageLike, { raw: string | null; library: Library }>();
const invalid = () => new Error('複習資料格式不正確或版本不相容；原資料未被覆寫，請先匯出備份。');
const object = (v: unknown): Record<string, unknown> => { if (!v || typeof v !== 'object' || Array.isArray(v)) throw invalid(); return v as Record<string, unknown>; };
const integer = (v: unknown, max = 1_000_000): number => { if (!Number.isInteger(v) || (v as number) < 0 || (v as number) > max) throw invalid(); return v as number; };
const timestamp = (v: unknown) => integer(v, 8_640_000_000_000_000);
const idValue = (v: unknown): string => { if (typeof v !== 'string' || !/^[a-zA-Z0-9-]{8,80}$/.test(v)) throw invalid(); return v; };

function parseScore(value: unknown): Score {
  const s = object(value);
  if (s.kind === 'cp' && Number.isInteger(s.value) && Math.abs(s.value as number) <= 100000) return { kind: 'cp', value: s.value as number };
  if (s.kind === 'mate' && (s.winner === 'w' || s.winner === 'b')) return { kind: 'mate', winner: s.winner, moves: integer(s.moves, 1000) };
  throw invalid();
}
function parseEvaluation(value: unknown): Evaluation {
  const e = object(value);
  if (!Array.isArray(e.pv) || e.pv.length > 8 || !e.pv.every(m => typeof m === 'string' && /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(m))) throw invalid();
  return { score: parseScore(e.score), depth: integer(e.depth, 256), pv: e.pv as string[] };
}

// Store only evaluations; derive FEN, SAN and engine position commands from PGN.
function storedEntry(e: SavedAnalysis) {
  return { id: e.id, pgn: e.pgn, player: e.report.player, createdAt: e.createdAt, updatedAt: e.updatedAt, practice: e.practice,
    analysis: e.report.positions.map(p => ({ best: { ...p.best, pv: p.best.pv.slice(0, 8) }, played: { ...p.played, pv: p.played.pv.slice(0, 8) }, refined: p.refined })) };
}
function parseEntry(value: unknown): SavedAnalysis {
  const e = object(value); const id = idValue(e.id);
  if (typeof e.pgn !== 'string' || (e.player !== 'w' && e.player !== 'b')) throw invalid();
  const { initialFen, moves } = parseGame(e.pgn);
  const analysis = e.analysis;
  if (!Array.isArray(analysis) || analysis.length !== moves.length) throw invalid();
  const ucis: string[] = [];
  const positions = moves.map((m, i) => {
    const data = object(analysis[i]);
    const best = parseEvaluation(data.best), played = parseEvaluation(data.played);
    if (!best.pv.length || typeof data.refined !== 'boolean') throw invalid();
    legalLine(m.before, best.pv.slice(0, 1));
    const uci = m.from + m.to + (m.promotion ?? '');
    if (played.pv.length && played.pv[0] !== uci) throw invalid();
    const position = `position fen ${initialFen}${ucis.length ? ` moves ${ucis.join(' ')}` : ''}`;
    ucis.push(uci);
    return { ply: i + 1, mover: m.color, san: m.san, uci, fen: m.before, after: m.after, position, best, played, refined: data.refined, finding: classify(best.score, played.score, m.color) };
  });
  const report: Report = { initialFen, initialScore: positions[0].best.score, player: e.player, positions };
  // Only selected teaching positions expose complete PVs to interactive replay.
  for (const p of keyMoments(report)) buildLesson(evidenceFromPosition(p));
  const practice: Record<string, Practice> = {};
  for (const [ply, value] of Object.entries(object(e.practice))) {
    if (!/^[1-9]\d{0,2}$/.test(ply) || !positions[Number(ply) - 1] || positions[Number(ply) - 1].mover !== report.player) throw invalid();
    const p = object(value);
    const attempts = integer(p.attempts), successes = integer(p.successes), independentSuccesses = integer(p.independentSuccesses);
    if (successes > attempts || independentSuccesses > successes) throw invalid();
    const lastAttemptAt = p.lastAttemptAt === null ? null : timestamp(p.lastAttemptAt);
    if (attempts === 0 ? lastAttemptAt !== null || p.lastOutcome !== null : lastAttemptAt === null || p.lastOutcome !== 'success' && p.lastOutcome !== 'retry') throw invalid();
    practice[ply] = { attempts, successes, independentSuccesses, lastAttemptAt, lastOutcome: p.lastOutcome as Practice['lastOutcome'] };
  }
  const createdAt = timestamp(e.createdAt), updatedAt = timestamp(e.updatedAt);
  if (updatedAt < createdAt) throw invalid();
  return { id, pgn: e.pgn, report, practice, createdAt, updatedAt };
}

export function analysisKey(report: Report) { return JSON.stringify([report.initialFen, report.player, report.positions.map(p => p.uci)]); }
export function parseLibrary(text: string): Library {
  if (text.length > MAX_LIBRARY_CHARS) throw new Error('複習備份太大，目前上限為 2,000,000 字元。');
  try {
    const raw = object(JSON.parse(text));
    if (raw.version !== 1 || !Array.isArray(raw.entries) || raw.entries.length > MAX_REPORTS) throw invalid();
    const entries = raw.entries.map(parseEntry);
    if (new Set(entries.map(e => e.id)).size !== entries.length || new Set(entries.map(e => analysisKey(e.report))).size !== entries.length) throw invalid();
    const activeId = raw.activeId === null ? null : idValue(raw.activeId);
    if (activeId && !entries.some(e => e.id === activeId)) throw invalid();
    return { version: 1, activeId, entries };
  } catch { throw invalid(); }
}
export function serializeLibrary(library: Library) { return JSON.stringify({ version: 1, activeId: library.activeId, entries: library.entries.map(storedEntry) }); }
function storageOrThrow(storage?: StorageLike) {
  try { return storage ?? window.localStorage; } catch { throw new Error('瀏覽器目前不允許儲存資料；仍可分析與下載講義。'); }
}
export function loadLibrary(storage?: StorageLike): Library {
  const target = storageOrThrow(storage);
  let raw: string | null;
  try { raw = target.getItem(LIBRARY_KEY); } catch { throw new Error('無法讀取此瀏覽器的複習紀錄。'); }
  const cached = cache.get(target);
  if (cached && cached.raw === raw) return structuredClone(cached.library);
  const library = raw === null ? emptyLibrary() : parseLibrary(raw);
  cache.set(target, { raw, library });
  return structuredClone(library);
}
export function persistLibrary(library: Library, storage?: StorageLike) {
  if (library.entries.length > MAX_REPORTS) throw new Error('已達 20 份報告上限，請先匯出備份或刪除不需要的報告。');
  const raw = serializeLibrary(library);
  if (raw.length > MAX_LIBRARY_CHARS) throw new Error('複習資料已達儲存上限，請先匯出備份並整理報告。');
  const target = storageOrThrow(storage);
  try { target.setItem(LIBRARY_KEY, raw); } catch { throw new Error('儲存空間不足或瀏覽器禁止儲存；這次變更尚未保存，請先下載備份或講義。'); }
  cache.set(target, { raw, library: structuredClone(library) });
}

export function upsertAnalysis(library: Library, pgn: string, report: Report, now = Date.now(), newId = crypto.randomUUID()): { library: Library; entry: SavedAnalysis } {
  const { initialFen, moves } = parseGame(pgn);
  if (report.initialFen !== initialFen || report.positions.length !== moves.length || report.positions.some((p, i) => p.uci !== moves[i].from + moves[i].to + (moves[i].promotion ?? ''))) throw invalid();
  const existing = library.entries.find(e => analysisKey(e.report) === analysisKey(report));
  if (!existing && library.entries.length >= MAX_REPORTS) throw new Error('已達 20 份報告上限，請先匯出備份或刪除不需要的報告。');
  const candidate: SavedAnalysis = { id: existing?.id ?? newId, pgn, report, practice: existing?.practice ?? {}, createdAt: existing?.createdAt ?? now, updatedAt: Math.max(now, existing?.updatedAt ?? now) };
  const entry = parseEntry(storedEntry(candidate));
  return { library: { version: 1, activeId: entry.id, entries: [entry, ...library.entries.filter(e => e.id !== entry.id)] }, entry };
}
export function saveAnalysis(pgn: string, report: Report, storage?: StorageLike) {
  const result = upsertAnalysis(loadLibrary(storage), pgn, report);
  persistLibrary(result.library, storage); return result.entry;
}
export function addPractice(library: Library, id: string, ply: number, success: boolean, independent: boolean, now = Date.now()): Library {
  const entry = library.entries.find(e => e.id === id);
  if (!entry || !keyMoments(entry.report).some(p => p.ply === ply)) throw new Error('找不到這個複習局面，紀錄可能已被刪除或重新分析。');
  const old = entry.practice[ply] ?? emptyPractice();
  if (old.attempts >= 1_000_000) throw new Error('此局面的練習次數已達紀錄上限，請先匯出備份。');
  const progress: Practice = { attempts: old.attempts + 1, successes: old.successes + Number(success), independentSuccesses: old.independentSuccesses + Number(success && independent), lastAttemptAt: Math.max(now, old.lastAttemptAt ?? 0), lastOutcome: success ? 'success' : 'retry' };
  return { ...library, entries: library.entries.map(e => e.id === id ? { ...e, practice: { ...e.practice, [ply]: progress } } : e) };
}
export function recordPractice(id: string, ply: number, success: boolean, independent: boolean, storage?: StorageLike) {
  const updated = addPractice(loadLibrary(storage), id, ply, success, independent);
  persistLibrary(updated, storage); return updated.entries.find(e => e.id === id)!.practice[ply];
}
export function removeAnalysis(id: string, storage?: StorageLike) {
  const library = loadLibrary(storage); const entries = library.entries.filter(e => e.id !== id);
  const result: Library = { ...library, entries, activeId: library.activeId === id ? entries[0]?.id ?? null : library.activeId };
  persistLibrary(result, storage); return result;
}

export function mergeLibraries(current: Library, incoming: Library): Library {
  let entries = [...current.entries];
  for (const item of incoming.entries) {
    const existing = entries.find(e => analysisKey(e.report) === analysisKey(item.report));
    if (!existing) { entries.push({ ...item, id: entries.some(e => e.id === item.id) ? crypto.randomUUID() : item.id }); continue; }
    const practice = { ...existing.practice };
    for (const [ply, progress] of Object.entries(item.practice)) {
      const old = practice[ply];
      if (!old) practice[ply] = progress;
      else {
        const latest = (progress.lastAttemptAt ?? 0) > (old.lastAttemptAt ?? 0) ? progress : old;
        practice[ply] = { attempts: Math.max(old.attempts, progress.attempts), successes: Math.max(old.successes, progress.successes), independentSuccesses: Math.max(old.independentSuccesses, progress.independentSuccesses), lastAttemptAt: latest.lastAttemptAt, lastOutcome: latest.lastOutcome };
      }
    }
    const latest = item.updatedAt > existing.updatedAt ? item : existing;
    entries = entries.map(e => e.id === existing.id ? { ...latest, id: existing.id, createdAt: Math.min(existing.createdAt, item.createdAt), practice } : e);
  }
  if (entries.length > MAX_REPORTS) throw new Error('合併後超過 20 份報告，請先整理現有紀錄再匯入。');
  return { version: 1, activeId: current.activeId ?? entries[0]?.id ?? null, entries: entries.sort((a, b) => b.updatedAt - a.updatedAt) };
}
export function importLibrary(text: string, storage?: StorageLike) {
  const merged = mergeLibraries(loadLibrary(storage), parseLibrary(text));
  persistLibrary(merged, storage); return merged;
}
export function backupLibrary(storage?: StorageLike) {
  // Allow recovering even malformed or future-version data without overwriting it.
  const target = storageOrThrow(storage);
  return target.getItem(LIBRARY_KEY) ?? serializeLibrary(emptyLibrary());
}
export function practiceItems(library: Library) {
  return library.entries.flatMap(entry => keyMoments(entry.report).map(p => ({ entryId: entry.id, ply: p.ply, san: p.san, round: p.fen.split(' ')[5], player: entry.report.player, theme: buildLesson(evidenceFromPosition(p)).theme, progress: entry.practice[p.ply] ?? emptyPractice() })))
    .sort((a, b) => Number(!needsPractice(a.progress)) - Number(!needsPractice(b.progress)) || (a.progress.lastAttemptAt ?? 0) - (b.progress.lastAttemptAt ?? 0));
}
