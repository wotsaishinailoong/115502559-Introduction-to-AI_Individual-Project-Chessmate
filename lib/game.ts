import { Chess } from 'chess.js';
export function gameStatus(game: Chess, resigned: boolean, player: 'w' | 'b') {
  if (resigned) return '你已認輸 · 對局結束';
  if (game.isCheckmate()) return game.turn() === player ? '將死 · AI 獲勝' : '將死 · 你獲勝了！';
  if (game.isStalemate()) return '逼和 · 對局結束';
  if (game.isThreefoldRepetition()) return '三次重複局面 · 和棋';
  if (game.isInsufficientMaterial()) return '子力不足 · 和棋';
  if (game.isDraw()) return '和棋 · 對局結束';
  if (game.isCheck()) return game.turn() === player ? '你被將軍了' : 'AI 被將軍了';
  return game.turn() === player ? '輪到你了' : 'AI 思考中';
}
export function undoRound(game: Chess, player: 'w' | 'b') {
  if (!game.history().length) return;
  game.undo();
  if (game.turn() !== player && game.history().length) game.undo();
}
