import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Chess } from 'chess.js';
import { acceptable, analyzeGame, chartValue, classify, cpLoss, keyMoments, legalLine, parseGame, REVIEW_NODES, type Evaluation, type Score } from '../lib/analysis.ts';
import { parseInfo } from '../lib/analysis-engine.ts';
const cp = (value: number): Score => ({ kind: 'cp', value });

test('black and white losses use the mover perspective while all saved scores face white', () => {
  assert.equal(cpLoss(cp(80), cp(-150), 'w'), 230);
  assert.equal(classify(cp(80), cp(-150), 'w'), 'blunder');
  assert.equal(cpLoss(cp(-80), cp(150), 'b'), 230);
  assert.equal(classify(cp(-80), cp(150), 'b'), 'blunder');
  assert.equal(classify(cp(80), cp(110), 'w'), null);
  assert.equal(classify(cp(0), cp(-99), 'w'), null);
  assert.equal(classify(cp(0), cp(-100), 'w'), 'mistake');
});

test('forced mates are classified separately, including already lost positions', () => {
  const win: Score = { kind: 'mate', winner: 'w', moves: 2 };
  const loss: Score = { kind: 'mate', winner: 'b', moves: 1 };
  assert.equal(classify(cp(0), loss, 'w'), 'allows-mate');
  assert.equal(classify(win, cp(300), 'w'), 'missed-mate');
  assert.equal(classify(win, { ...win, moves: 4 }, 'w'), null);
  assert.equal(classify(loss, loss, 'w'), null);
  assert.equal(chartValue(loss), -8);
});

test('near-equivalent alternative moves are accepted in both colors without accepting a lost mate', () => {
  assert.equal(acceptable(cp(50), cp(5), 'w'), true);
  assert.equal(acceptable(cp(-50), cp(-5), 'b'), true);
  assert.equal(acceptable(cp(50), cp(-10), 'w'), false);
  assert.equal(acceptable(cp(0), { kind: 'mate', winner: 'b', moves: 1 }, 'w'), false);
  assert.equal(acceptable({ kind: 'mate', winner: 'w', moves: 2 }, cp(900), 'w'), false);
});

test('UCI scores normalize black, mates and exclude search bounds', () => {
  const p = parseInfo('info depth 9 score cp 130 nodes 500 pv e7e5 g1f3', 'b');
  assert.deepEqual(p?.score, cp(-130));
  assert.deepEqual(parseInfo('info depth 9 score mate -2 pv g7g6', 'b')?.score, { kind: 'mate', winner: 'w', moves: 2 });
  assert.equal(parseInfo('info depth 9 score cp 90 lowerbound pv e2e4', 'w'), null);
  assert.equal(parseInfo('info depth 9 nodes 1000', 'w'), null);
});

test('PGN validation and PV replay reject invalid data, custom FEN and promotions work', () => {
  assert.throws(() => parseGame(''), /有效/);
  assert.throws(() => parseGame('1. e4 e9'), /格式/);
  assert.throws(() => parseGame('[Event "No moves"]'), /至少/);
  assert.throws(() => legalLine(new Chess().fen(), ['e2e5']));
  assert.deepEqual(legalLine(new Chess().fen(), ['e2e4', 'e7e5']), ['e4', 'e5']);
  const special = '[SetUp "1"]\n[FEN "7k/P7/8/8/8/8/8/7K w - - 0 1"]\n\n1. a8=Q+';
  assert.equal(parseGame(special).initialFen, '7k/P7/8/8/8/8/8/7K w - - 0 1');
  assert.deepEqual(legalLine(parseGame(special).initialFen, ['a7a8q']), ['a8=Q+']);
});

test('pipeline compares the same root, refines candidates and corrects a shallow false positive', async () => {
  const calls: {position: string; nodes: number; move?: string}[] = [];
  const report = await analyzeGame('1. f3 e5 2. g4 Qh4#', 'w', async (position, turn, nodes, move): Promise<Evaluation> => {
    calls.push({ position, nodes, move });
    const played = position.split(' moves ')[1]?.split(' ') ?? [];
    const index = played.length;
    const bestPv = [['e2e4'], ['e7e5'], ['g2g3'], ['d8h4']][index];
    const score = index === 2 && move ? { kind: 'mate' as const, winner: 'b' as const, moves: 1 } : cp(0);
    const adjusted = index === 0 && move && nodes < REVIEW_NODES ? cp(-220) : score;
    return { score: adjusted, pv: move ? [move, ...(index === 2 ? ['d8h4'] : [])] : bestPv, depth: 10 };
  }, () => {});
  assert.equal(report.positions.length, 4);
  assert.equal(report.positions[0].refined, true);
  assert.equal(report.positions[0].finding, null);
  assert.equal(keyMoments(report).length, 1);
  assert.equal(keyMoments(report)[0].san, 'g4');
  assert.deepEqual(report.positions[3].played.score, {kind:'mate',winner:'b',moves:0});
  const bestCall = calls.find(c => c.position.endsWith('moves f2f3 e7e5') && c.nodes === REVIEW_NODES && !c.move);
  const actualCall = calls.find(c => c.position === bestCall?.position && c.nodes === REVIEW_NODES && c.move === 'g2g4');
  assert.ok(bestCall && actualCall);
});

test('engine failures propagate instead of reporting a completed or partial analysis', async () => {
  await assert.rejects(analyzeGame('1. e4', 'w', async () => { throw new Error('stopped'); }, () => {}), /stopped/);
});
