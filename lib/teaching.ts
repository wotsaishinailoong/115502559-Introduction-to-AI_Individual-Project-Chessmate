import { Chess, type Color, type PieceSymbol } from 'chess.js';
import { classify, cpLoss, keyMoments, legalLine, scoreLabel, type Position, type Report, type Score } from './analysis.ts';

export type TutorEvidence = { fen: string; uci: string; best: { score: Score; pv: string[] }; played: { score: Score; pv: string[] } };
export type TutorText = { title: string; why: string[]; better: string; takeaway: string; factIds: string[] };
export type Lesson = TutorText & { theme: string; hint: string; facts: { id: string; text: string }[]; bestLine: string[]; playedLine: string[] };
const pieceNames: Record<PieceSymbol, string> = { p: '兵', n: '馬', b: '象', r: '車', q: '后', k: '王' };

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('教學資料格式不正確。');
  return value as Record<string, unknown>;
}
function score(value: unknown): Score {
  const s = object(value);
  if (s.kind === 'cp' && Number.isInteger(s.value) && Math.abs(s.value as number) <= 100000) return { kind: 'cp', value: s.value as number };
  if (s.kind === 'mate' && (s.winner === 'w' || s.winner === 'b') && Number.isInteger(s.moves) && (s.moves as number) >= 0 && (s.moves as number) <= 1000) return { kind: 'mate', winner: s.winner, moves: s.moves as number };
  throw new Error('評分格式不正確。');
}
function evaluation(value: unknown) {
  const e = object(value);
  if (!Array.isArray(e.pv) || e.pv.length > 8 || !e.pv.every(m => typeof m === 'string' && /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(m))) throw new Error('變化線格式不正確。');
  return { score: score(e.score), pv: e.pv as string[] };
}

export function evidenceFromPosition(p: Position): TutorEvidence {
  return { fen: p.fen, uci: p.uci, best: { score: p.best.score, pv: p.best.pv.slice(0, 8) }, played: { score: p.played.score, pv: p.played.pv.slice(0, 8) } };
}

// Shared by browser and server: no PGN headers, user instructions, or arbitrary prompt text.
export function validateEvidence(value: unknown): TutorEvidence {
  const input = object(value);
  if (typeof input.fen !== 'string' || input.fen.length > 120 || typeof input.uci !== 'string' || !/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(input.uci)) throw new Error('局面或走法格式不正確。');
  const board = new Chess(input.fen);
  if (board.isGameOver()) throw new Error('此局面已結束，無法產生落子教學。');
  const best = evaluation(input.best); const played = evaluation(input.played);
  if (!best.pv.length || best.score.kind === 'mate' && best.score.moves === 0) throw new Error('缺少有效的建議走法。');
  legalLine(input.fen, best.pv); legalLine(input.fen, played.pv);
  board.move({ from: input.uci.slice(0, 2), to: input.uci.slice(2, 4), promotion: input.uci[4] });
  if (played.pv.length && played.pv[0] !== input.uci) throw new Error('實際走法與變化線不一致。');
  if (played.score.kind === 'mate' && played.score.moves === 0 && (!board.isCheckmate() || board.turn() === played.score.winner)) throw new Error('將殺結果與棋盤不一致。');
  // Empty lines also occur for draws determined from move history. FEN alone cannot verify repetition.
  return { fen: input.fen, uci: input.uci, best, played: { ...played, pv: played.pv.length ? played.pv : [input.uci] } };
}

function events(fen: string, pv: string[]) {
  const board = new Chess(fen);
  return pv.map(uci => {
    const m = board.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
    return { san: m.san, color: m.color, captured: m.captured, check: board.isCheck(), mate: board.isCheckmate() };
  });
}

export function buildLesson(raw: TutorEvidence): Lesson {
  const e = validateEvidence(raw);
  const board = new Chess(e.fen); const mover: Color = board.turn();
  const actual = board.move({ from: e.uci.slice(0, 2), to: e.uci.slice(2, 4), promotion: e.uci[4] });
  const bestLine = legalLine(e.fen, e.best.pv);
  const playedLine = e.played.pv.length ? legalLine(e.fen, e.played.pv) : [actual.san];
  const playedEvents = events(e.fen, e.played.pv);
  const reply = playedEvents[1];
  const finding = classify(e.best.score, e.played.score, mover);
  const theme = finding === 'allows-mate' || finding === 'missed-mate' || reply?.check ? '國王安全與將軍' : reply?.captured ? '吃子與交換' : '比較候選走法';
  const loss = cpLoss(e.best.score, e.played.score, mover);
  const facts = [
    { id: 'actual', text: `你在這個局面走了 ${actual.san}。` },
    { id: 'suggestion', text: `引擎在本次搜尋中建議 ${bestLine[0]}。` },
    { id: 'evaluation', text: `白方視角：建議走法 ${scoreLabel(e.best.score)}；實際走法 ${scoreLabel(e.played.score)}。${loss !== null ? `落子者的評分損失約 ${(loss / 100).toFixed(2)} 分。` : ''}` },
  ];
  let comparison: string | null = null;
  const alternate = new Chess(e.fen);
  alternate.move({ from: e.best.pv[0].slice(0, 2), to: e.best.pv[0].slice(2, 4), promotion: e.best.pv[0][4] });
  if (alternate.isCheckmate()) comparison = `改走 ${bestLine[0]} 可以立即將死對方，這已由棋盤規則核對。`;
  else if (reply && !alternate.isGameOver()) {
    try {
      const uci = e.played.pv[1];
      const response = alternate.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
      if (reply.mate && !alternate.isCheckmate()) {
        if (alternate.isCheck()) {
          const replies = alternate.moves({ verbose: true });
          const defence = replies.find(m => m.from === actual.from) ?? replies[0];
          comparison = `改走 ${bestLine[0]} 後，若對方仍走 ${response.san}，規則上可用 ${defence.san} 應將。這條對照線只示範當下的合法防守，不保證是最佳回應。`;
        } else comparison = `改走 ${bestLine[0]} 後，即使對方仍走 ${response.san}，這步也沒有將軍。這是合法的對照線，不代表對方會選擇這個回應。`;
      }
    } catch {
      comparison = `改走 ${bestLine[0]} 後，原示範線中的 ${reply.san} 不能立刻合法走出。對手需要選擇其他回應。`;
    }
  }
  if (comparison) facts.push({ id: 'comparison', text: comparison });
  if (reply) facts.push({ id: 'reply', text: `在實際走法的示範線中，對手用 ${reply.san}${reply.mate ? '將死你的國王' : reply.check ? '將軍' : reply.captured ? `吃掉一個${pieceNames[reply.captured]}` : '回應'}。` });
  if (finding === 'allows-mate') facts.push({ id: 'mate', text: '引擎判斷實際走法允許對方強制將殺；這是有限搜尋的結果。' });
  if (finding === 'missed-mate') facts.push({ id: 'mate', text: '引擎在建議走法中找到己方將殺，但實際走法沒有保留該將殺評分。' });
  const why = [finding === 'allows-mate' ? '這一步忽略了對方的將殺威脅。先確認國王能否安全度過對手的下一次進攻。' : finding === 'missed-mate' ? '你原本有機會用連續的威脅完成將殺，這步沒有保留引擎找到的機會。' : loss !== null ? `在同一搜尋預算下，這一步比引擎建議低約 ${(loss / 100).toFixed(2)} 分。需要比較具體回應，才能看出差別。` : '先比較兩條示範線，觀察對方如何回應。'];
  if (reply) why.push(facts.find(f => f.id === 'reply')!.text);
  const hint = theme === '國王安全與將軍' ? '先找對方可能的將軍，再看看國王周圍的斜線與逃生格。' : theme === '吃子與交換' ? '先檢查對手有哪些吃子，以及交換之後誰保留較多子力。' : '至少比較兩個候選走法，並各想一個對方最直接的回應。';
  return {
    theme, hint, facts, bestLine, playedLine,
    title: theme === '國王安全與將軍' ? '先看國王是否安全' : theme === '吃子與交換' ? '吃子之前，先算對手的回應' : '多想一個候選走法',
    why, better: comparison ?? `試著比較 ${bestLine[0]} 與原走法 ${actual.san}。沿著建議變化逐步播放，檢查將軍、吃子與對手的回應；這條變化是參考，對方也可能選擇其他走法。`,
    takeaway: theme === '國王安全與將軍' ? '每次落子前，先問：對手下一步能將軍嗎？我準備怎麼回應？' : theme === '吃子與交換' ? '不要只看自己能吃什麼，也要算對手接著能吃什麼。' : '落子前比較兩個選擇，並檢查對手的將軍、吃子與直接威脅。',
    factIds: facts.map(f => f.id),
  };
}

export function validateTutorText(value: unknown, lesson: Lesson, evidence: TutorEvidence): TutorText {
  const data = object(value);
  const text = (value: unknown, max: number) => {
    if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error('AI 教學回覆格式不正確。');
    return value.trim();
  };
  if (!Array.isArray(data.why) || !data.why.length || data.why.length > 3 || !Array.isArray(data.factIds) || data.factIds.length < 1 || data.factIds.length > lesson.facts.length || !data.factIds.every(id => typeof id === 'string' && lesson.facts.some(f => f.id === id))) throw new Error('AI 教學缺少可核對的依據。');
  const result: TutorText = { title: text(data.title, 60), why: data.why.map(v => text(v, 240)), better: text(data.better, 400), takeaway: text(data.takeaway, 160), factIds: [...new Set(data.factIds)] as string[] };
  // Reject invented board coordinates. This is a useful guard, not proof that prose is correct.
  const coordinates = new Set([evidence.uci, ...evidence.best.pv, ...evidence.played.pv].flatMap(m => [m.slice(0, 2), m.slice(2, 4)]));
  // Rule-verified counterfactual replies may add a legal defence outside the engine PV.
  for (const fact of lesson.facts) for (const square of fact.text.match(/[a-h][1-8]/g) ?? []) coordinates.add(square);
  for (const square of JSON.stringify(result).match(/[a-h][1-8]/g) ?? []) if (!coordinates.has(square)) throw new Error('AI 教學包含沒有引擎依據的格子。');
  return result;
}

export function lessonMarkdown(report: Report) {
  const lines = ['# 棋伴復盤講義', '', `分析對象：${report.player === 'w' ? '白方' : '黑方'}；共 ${report.positions.length} 手。`, '', '本講義使用 Stockfish 與規則式教學，評分為有限搜尋結果，不是勝率。', ''];
  for (const [index, p] of keyMoments(report).entries()) {
    const lesson = buildLesson(evidenceFromPosition(p));
    lines.push(`## ${index + 1}. 第 ${p.fen.split(' ')[5]} 回合 ${p.san}｜${lesson.theme}`, '', lesson.title, '', ...lesson.why.map(s => `- ${s}`), '', `建議：${lesson.better}`, '', `建議變化：${lesson.bestLine.join(' → ')}`, `原走法變化：${lesson.playedLine.join(' → ')}`, '', `下次記得：${lesson.takeaway}`, '');
  }
  if (!keyMoments(report).length) lines.push('本次分析沒有找到達到門檻的關鍵失誤，不代表每一步都是最佳走法。');
  return lines.join('\n');
}
