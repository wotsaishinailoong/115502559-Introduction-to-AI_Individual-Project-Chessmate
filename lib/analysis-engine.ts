import type { Color } from 'chess.js';
import type { Evaluation, Score, Search } from './analysis.ts';

export function parseInfo(line: string, turn: Color): Evaluation | null {
  // Bounds are not exact scores and must not be used for loss comparisons.
  if (/\b(lowerbound|upperbound)\b/.test(line)) return null;
  const score = /\bscore (cp|mate) (-?\d+)/.exec(line);
  const depth = /\bdepth (\d+)/.exec(line);
  const pv = /\bpv (.+)$/.exec(line);
  if (!score || !depth || !pv) return null;
  const n = Number(score[2]);
  const normalized: Score = score[1] === 'cp'
    ? { kind: 'cp', value: n * (turn === 'w' ? 1 : -1) }
    : { kind: 'mate', winner: n > 0 ? turn : turn === 'w' ? 'b' : 'w', moves: Math.abs(n) };
  return { score: normalized, depth: Number(depth[1]), pv: pv[1].trim().split(/\s+/) };
}

export class AnalysisEngine {
  private worker: Worker;
  private pending: { reject: (error: Error) => void; line: (text: string) => void; timer: ReturnType<typeof setTimeout> } | null = null;
  private closed = false;

  constructor() {
    this.worker = new Worker('/engine/stockfish-17.1-lite-single-03e3232.js');
    this.worker.onmessage = (event: MessageEvent<string>) => {
      if (typeof event.data === 'string') for (const line of event.data.split('\n')) this.pending?.line(line.trim());
    };
    this.worker.onerror = () => this.close(new Error('分析引擎無法載入，請重新分析。'));
  }

  private request<T>(commands: string[], receive: (line: string) => T | undefined): Promise<T> {
    if (this.closed) return Promise.reject(new Error('分析已取消。'));
    if (this.pending) return Promise.reject(new Error('引擎正在處理另一個搜尋。'));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.close(new Error('分析逾時，請縮短棋譜或稍後重試。')), 20000);
      this.pending = { timer, reject, line: line => {
        try {
          const result = receive(line);
          if (result !== undefined) { clearTimeout(timer); this.pending = null; resolve(result); }
        } catch (error) { this.close(error instanceof Error ? error : new Error('分析失敗。')); }
      } };
      for (const command of commands) this.worker.postMessage(command);
    });
  }

  async init() {
    await this.request(['uci'], line => line === 'uciok' ? true : undefined);
    await this.request(['setoption name Hash value 16', 'setoption name Skill Level value 20', 'isready'], line => line === 'readyok' ? true : undefined);
  }

  search: Search = async (position, turn, nodes, move) => {
    let latest: Evaluation | null = null;
    // Clearing hash gives best-vs-played searches the same starting conditions.
    return this.request(['setoption name Clear Hash', position, `go nodes ${nodes}${move ? ` searchmoves ${move}` : ''}`], line => {
      const info = parseInfo(line, turn);
      if (info) latest = info;
      if (!line.startsWith('bestmove ')) return undefined;
      if (!latest || (move && latest.pv[0] !== move)) throw new Error('引擎未產生可比較的結果，請重新分析。');
      return latest;
    });
  };

  close(error = new Error('分析已取消。')) {
    this.closed = true;
    if (this.pending) { clearTimeout(this.pending.timer); this.pending.reject(error); this.pending = null; }
    this.worker.terminate();
  }
}
