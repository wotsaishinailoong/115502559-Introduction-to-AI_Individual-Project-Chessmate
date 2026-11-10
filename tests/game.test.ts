import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Chess } from 'chess.js';
import { gameStatus, undoRound } from '../lib/game.ts';
test('undo removes both completed moves and only the human move while AI thinks', () => {
  const game = new Chess(); const initial = game.fen();
  game.move('e4'); game.move('e5'); undoRound(game, 'w'); assert.equal(game.fen(), initial);
  game.move('d4'); undoRound(game, 'w'); assert.equal(game.fen(), initial);
});
test('black player undo preserves AI opening and returns the turn to black', () => {
  const game = new Chess(); game.move('e4'); const opening = game.fen();
  game.move('e5'); game.move('Nf3'); undoRound(game, 'b'); assert.equal(game.fen(), opening);
});
test('checkmate and threefold repetition are reported correctly', () => {
  const mate = new Chess(); for (const move of ['f3','e5','g4','Qh4#']) mate.move(move);
  assert.equal(gameStatus(mate, false, 'w'), '將死 · AI 獲勝');
  const draw = new Chess(); for (const move of ['Nf3','Nf6','Ng1','Ng8','Nf3','Nf6','Ng1','Ng8']) draw.move(move);
  assert.equal(gameStatus(draw, false, 'w'), '三次重複局面 · 和棋');
  const restored = new Chess(); restored.loadPgn(draw.pgn()); assert.equal(restored.isThreefoldRepetition(), true);
});
test('castling, en passant and all four promotions remain legal', () => {
  const castle = new Chess('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
  assert.equal(castle.move('O-O').san, 'O-O');
  const ep = new Chess(); for (const m of ['e4','a6','e5','d5']) ep.move(m);
  assert.equal(ep.move('exd6').isEnPassant(), true);
  for (const piece of ['q','r','b','n']) {
    const promotion = new Chess('7k/P7/8/8/8/8/8/7K w - - 0 1');
    assert.equal(promotion.move({from:'a7',to:'a8',promotion:piece}).promotion, piece);
  }
});
