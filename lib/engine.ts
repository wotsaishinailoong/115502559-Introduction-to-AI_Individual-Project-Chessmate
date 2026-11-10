export type Level = 'beginner' | 'casual' | 'advanced';
export const levels: Record<Level, { label: string; depth: number; skill: number }> = {
  beginner: { label: '入門', depth: 2, skill: 0 },
  casual: { label: '一般', depth: 5, skill: 5 },
  advanced: { label: '進階', depth: 9, skill: 12 },
};
// A fresh worker per search makes undo/new game cancellation unambiguous.
export function findMove(fen: string, level: Level, onMove: (move: string) => void, onError: () => void) {
  const worker = new Worker('/engine/stockfish-17.1-lite-single-03e3232.js');
  let finished = false;
  const dispose = () => { finished = true; clearTimeout(timer); worker.terminate(); };
  const fail = () => { if (!finished) { dispose(); onError(); } };
  const timer = setTimeout(fail, 30000);
  worker.onerror = fail;
  worker.onmessage = (event: MessageEvent<string>) => {
    if (finished || typeof event.data !== 'string') return;
    for (const line of event.data.split('\n')) {
      if (line.trim() === 'uciok') {
        worker.postMessage(`setoption name Skill Level value ${levels[level].skill}`);
        worker.postMessage('setoption name Hash value 16');
        worker.postMessage('isready');
      }
      if (line.trim() === 'readyok') {
        worker.postMessage(`position fen ${fen}`);
        worker.postMessage(`go depth ${levels[level].depth} movetime 1500`);
      }
      if (line.startsWith('bestmove ')) {
        const move = line.split(' ')[1];
        dispose();
        if (/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(move)) onMove(move); else onError();
      }
    }
  };
  worker.postMessage('uci');
  return dispose;
}
