import { Chess, type Color } from 'chess.js';

export type Score = { kind: 'cp'; value: number } | { kind: 'mate'; winner: Color; moves: number };
export type Evaluation = { score: Score; pv: string[]; depth: number };
export type Finding = 'blunder' | 'mistake' | 'missed-mate' | 'allows-mate' | null;
export type Position = {
  ply: number; mover: Color; san: string; uci: string; fen: string; after: string;
  position: string; best: Evaluation; played: Evaluation; finding: Finding; refined: boolean;
};
export type Report = { initialFen: string; initialScore: Score; positions: Position[]; player: Color };
export type Search = (position: string, turn: Color, nodes: number, move?: string) => Promise<Evaluation>;
export const MAX_PLIES = 240;
export const SCAN_NODES = 12000;
export const REVIEW_NODES = 80000;

export function parseGame(pgn: string) {
  if (!pgn.trim() || pgn.length > 32000) throw new Error('請輸入有效的 PGN，長度限 32,000 字元。');
  const game = new Chess();
  try { game.loadPgn(pgn); } catch { throw new Error('無法讀取棋譜，請檢查 PGN 格式與走法。'); }
  const moves = game.history({ verbose: true });
  if (!moves.length) throw new Error('棋譜至少需要一手走法。');
  if (moves.length > MAX_PLIES) throw new Error('目前支援最多 120 回合（240 手）的棋譜。');
  return { initialFen: moves[0].before, moves };
}

export function cpLoss(best: Score, played: Score, mover: Color): number | null {
  if (best.kind !== 'cp' || played.kind !== 'cp') return null;
  return Math.max(0, (best.value - played.value) * (mover === 'w' ? 1 : -1));
}

export function classify(best: Score, played: Score, mover: Color): Finding {
  // Do not penalize an already forced loss just for a different mate distance.
  if (best.kind === 'mate' && best.winner !== mover) return null;
  if (played.kind === 'mate' && played.winner !== mover) return 'allows-mate';
  if (best.kind === 'mate' && best.winner === mover) {
    return played.kind === 'mate' && played.winner === mover ? null : 'missed-mate';
  }
  const loss = cpLoss(best, played, mover) ?? 0;
  return loss >= 200 ? 'blunder' : loss >= 100 ? 'mistake' : null;
}

export function severity(p: Position) {
  return p.finding === 'allows-mate' ? 100000 : p.finding === 'missed-mate' ? 90000 : cpLoss(p.best.score, p.played.score, p.mover) ?? 0;
}

export function keyMoments(report: Report) {
  return report.positions.filter(p => p.mover === report.player && p.refined && p.finding)
    .sort((a, b) => severity(b) - severity(a)).slice(0, 3);
}

export function acceptable(best: Score, trial: Score, mover: Color) {
  if (trial.kind === 'mate') {
    if (trial.winner === mover) return true;
    return best.kind === 'mate' && best.winner !== mover && trial.moves >= best.moves;
  }
  if (best.kind === 'mate') return best.winner !== mover;
  return (cpLoss(best, trial, mover) ?? Infinity) <= 50;
}

export function scoreLabel(score: Score) {
  if (score.kind === 'mate') return score.moves === 0
    ? `${score.winner === 'w' ? '白' : '黑'}方已將死對手`
    : `${score.winner === 'w' ? '白' : '黑'}方將殺（${score.moves} 步）`;
  const value = score.value / 100;
  return `${value > 0 ? '+' : ''}${value.toFixed(2)}`;
}

export function chartValue(score: Score) {
  return score.kind === 'mate' ? (score.winner === 'w' ? 8 : -8) : Math.max(-8, Math.min(8, score.value / 100));
}

export function legalLine(fen: string, pv: string[]) {
  const game = new Chess(fen);
  return pv.slice(0, 8).map(uci => {
    if (!/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(uci)) throw new Error('引擎變化線格式無效。');
    return game.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] }).san;
  });
}

function terminal(game: Chess): Evaluation | null {
  if (game.isCheckmate()) return { score: { kind: 'mate', winner: game.turn() === 'w' ? 'b' : 'w', moves: 0 }, pv: [], depth: 0 };
  if (game.isDraw()) return { score: { kind: 'cp', value: 0 }, pv: [], depth: 0 };
  return null;
}

export async function analyzeGame(pgn: string, player: Color, search: Search, progress: (percent: number, text: string) => void): Promise<Report> {
  const { initialFen, moves } = parseGame(pgn);
  const replay = new Chess(initialFen);
  const ucis: string[] = [];
  const positions: Position[] = [];
  for (const [i, move] of moves.entries()) {
    progress(Math.round(i / moves.length * 80), `分析第 ${i + 1} / ${moves.length} 手`);
    const position = `position fen ${initialFen}${ucis.length ? ` moves ${ucis.join(' ')}` : ''}`;
    const uci = move.from + move.to + (move.promotion ?? '');
    const best = await search(position, move.color, SCAN_NODES);
    replay.move(move.san);
    const played = terminal(replay) ?? (best.pv[0] === uci ? best : await search(position, move.color, SCAN_NODES, uci));
    legalLine(move.before, best.pv); legalLine(move.before, played.pv);
    positions.push({ ply: i + 1, mover: move.color, san: move.san, uci, fen: move.before, after: move.after, position, best, played, finding: classify(best.score, played.score, move.color), refined: false });
    ucis.push(uci);
  }
  const candidates = positions.filter(p => p.mover === player && p.finding).sort((a, b) => severity(b) - severity(a)).slice(0, 6);
  for (const [i, p] of candidates.entries()) {
    progress(80 + Math.round(i / candidates.length * 19), `深入檢查關鍵走法 ${i + 1} / ${candidates.length}`);
    p.best = await search(p.position, p.mover, REVIEW_NODES);
    // Replay full history for draw detection, not just the isolated FEN.
    const board = new Chess(initialFen);
    for (const move of moves.slice(0, p.ply)) board.move(move.san);
    p.played = terminal(board) ?? (p.best.pv[0] === p.uci ? p.best : await search(p.position, p.mover, REVIEW_NODES, p.uci));
    legalLine(p.fen, p.best.pv); legalLine(p.fen, p.played.pv);
    p.finding = classify(p.best.score, p.played.score, p.mover);
    p.refined = true;
  }
  progress(100, '分析完成');
  return { initialFen, initialScore: positions[0].best.score, positions, player };
}
