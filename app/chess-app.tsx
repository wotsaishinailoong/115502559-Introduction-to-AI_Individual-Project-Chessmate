'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { Chess, type Square, type PieceSymbol } from 'chess.js';
import { Chessboard } from 'react-chessboard';
import { ArrowDownToLine, ArrowLeftRight, ArrowUpRight, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Flag, Lightbulb, RotateCcw, Sparkles, Swords, X, BookOpen, Check, CircleHelp } from 'lucide-react';
import { findMove, levels, type Level } from '../lib/engine';
import { gameStatus, undoRound } from '../lib/game';
const STORE = 'chessmate.game.v1';
type Pending = { from: string; to: string };
export default function ChessApp() {
  const [game, setGame] = useState(() => new Chess());
  const [version, setVersion] = useState(0);
  const [player, setPlayer] = useState<'w' | 'b'>('w');
  const [level, setLevel] = useState<Level>('beginner');
  const [flipped, setFlipped] = useState(false);
  const [selected, setSelected] = useState<Square | null>(null);
  const [promotion, setPromotion] = useState<Pending | null>(null);
  const [resigned, setResigned] = useState(false);
  const [error, setError] = useState('');
  const [ready, setReady] = useState(false);
  const [modal, setModal] = useState<'new' | 'resign' | 'help' | null>(null);
  const [draftColor, setDraftColor] = useState<'w' | 'b'>('w');
  const [draftLevel, setDraftLevel] = useState<Level>('beginner');
  const [tab, setTab] = useState<'moves' | 'guide'>('moves');
  const [review, setReview] = useState<number | null>(null);
  const movesEnd = useRef<HTMLDivElement>(null);
  const history = game.history({ verbose: true });
  const over = resigned || game.isGameOver();
  const thinking = !over && game.turn() !== player;
  const canPlay = ready && !over && !thinking && review === null;
  const changed = () => { setVersion(v => v + 1); setSelected(null); setError(''); };
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORE);
      if (saved) {
        const data = JSON.parse(saved);
        const restored = new Chess(); restored.loadPgn(data.pgn);
        if ((data.player === 'w' || data.player === 'b') && data.level in levels) {
          setGame(restored); setPlayer(data.player); setLevel(data.level); setResigned(data.resigned === true);
        }
      }
    } catch { setError('無法恢復上次對局，已準備新的棋盤。'); }
    setReady(true);
  }, []);
  useEffect(() => {
    if (ready) { try { localStorage.setItem(STORE, JSON.stringify({ pgn: game.pgn(), player, level, resigned })); } catch { /* Play remains available when storage is disabled. */ } }
  }, [ready, game, version, player, level, resigned]);
  useEffect(() => {
    if (!ready || over || game.turn() === player) return;
    setError('');
    return findMove(game.fen(), level, move => {
      try { game.move({ from: move.slice(0, 2), to: move.slice(2, 4), promotion: move[4] }); changed(); }
      catch { setError('引擎回傳的走法無效，請重試。'); }
    }, () => setError('AI 引擎暫時無法運作，請重試。'));
    // The version changes whenever the mutable chess position changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game, version, player, level, ready, over]);
  useEffect(() => { const container = movesEnd.current?.parentElement; if (container) container.scrollTop = container.scrollHeight; }, [version]);
  function play(from: string, to: string, piece?: PieceSymbol): boolean {
    if (!canPlay) return false;
    const choices = game.moves({ verbose: true }).filter(m => m.from === from && m.to === to);
    if (!choices.length) return false;
    if (choices.some(m => m.promotion) && !piece) { setPromotion({ from, to }); return false; }
    try { game.move({ from, to, promotion: piece }); setPromotion(null); changed(); return true; } catch { return false; }
  }
  function click(square: string) {
    if (!canPlay) return;
    if (selected && play(selected, square)) return;
    const piece = game.get(square as Square);
    setSelected(piece?.color === player ? square as Square : null);
  }
  function start() {
    setGame(new Chess()); setPlayer(draftColor); setLevel(draftLevel); setResigned(false); setReview(null); setFlipped(false); setModal(null); setPromotion(null); changed();
  }
  function undo() {
    undoRound(game, player); setResigned(false); setReview(null); setPromotion(null); changed();
  }
  function download() {
    const copy = new Chess(); copy.loadPgn(game.pgn());
    const result = resigned ? (player === 'w' ? '0-1' : '1-0') : game.isCheckmate() ? (game.turn() === 'w' ? '0-1' : '1-0') : game.isDraw() ? '1/2-1/2' : '*';
    copy.header('Event', 'Chessmate Practice', 'White', player === 'w' ? 'Player' : 'Stockfish', 'Black', player === 'b' ? 'Player' : 'Stockfish', 'Result', result);
    const url = URL.createObjectURL(new Blob([copy.pgn()], { type: 'application/x-chess-pgn' }));
    const a = document.createElement('a'); a.href = url; a.download = 'chessmate.pgn'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  let fen = game.fen();
  if (review !== null) { const past = new Chess(); for (const m of history.slice(0, review)) past.move(m.san); fen = past.fen(); }
  const styles: Record<string, React.CSSProperties> = {};
  const last = review === null ? history.at(-1) : history[review - 1];
  if (last) { styles[last.from] = { backgroundColor: '#e8ce7680' }; styles[last.to] = { backgroundColor: '#e8ce7699' }; }
  if (selected && canPlay) {
    styles[selected] = { backgroundColor: '#d6bd65' };
    for (const move of game.moves({ square: selected, verbose: true })) styles[move.to] = { background: 'radial-gradient(circle, #214e4866 22%, transparent 24%)' };
  }
  const status = gameStatus(game, resigned, player);
  const reviewAt = review ?? history.length;
  return <div className="app-shell">
    <header className="topbar"><a className="brand" href="/" aria-label="棋伴首頁"><span className="brand-icon">♞</span><strong>棋伴<span>Chessmate</span></strong></a><nav><span className="nav-active"><Swords size={16}/> 對弈練習</span><Link href="/review" className="review-nav-link"><BookOpen size={16}/> 復盤教室</Link></nav><button className="help-button" onClick={() => setModal('help')}><CircleHelp size={18}/><span>使用指南</span></button></header>
    <main><div className="page-heading"><div><div className="eyebrow"><span/> YOUR NEXT MOVE MATTERS</div><h1>每一步，都是進步<span>。</span></h1><p>與 AI 下盤棋，慢慢找到屬於你的節奏。</p></div><div className="practice-badge"><span/> 自由練習模式</div></div>
    <div className="workspace"><section className="board-section" aria-label="對弈棋盤">
      <div className="player-row"><div className="avatar ai-avatar"><Sparkles size={23}/></div><div className="player-info"><strong>棋伴 AI <span className="tag">STOCKFISH</span></strong><span>{levels[level].label}難度 · {player === 'w' ? '黑方' : '白方'}</span></div><span className={'presence ' + (thinking ? 'thinking' : '')}><i/>{over ? '對局結束' : error ? '等待重試' : thinking ? '思考中' : '準備就緒'}</span></div>
      <div className="board-frame"><Chessboard options={{ id: 'practice-board', position: fen, boardOrientation: (player === 'w') !== flipped ? 'white' : 'black', onPieceDrop: ({sourceSquare, targetSquare}) => targetSquare ? play(sourceSquare, targetSquare) : false, onSquareClick: ({ square }) => click(square), allowDragging: canPlay, squareStyles: styles, darkSquareStyle: { backgroundColor: '#79958b' }, lightSquareStyle: { backgroundColor: '#f0eee5' }, animationDurationInMs: 180 }}/></div>
      <div className="player-row user-row"><div className="avatar user-avatar">你</div><div className="player-info"><strong>你的棋局 <span className="tag light-tag">{player === 'w' ? '白方' : '黑方'}</span></strong><span>{over ? '每一局都有新的收穫' : '不計時，專心走好每一步'}</span></div><span className="turn-indicator">{review !== null ? '回放中' : status}</span></div>
      <div className="board-toolbar"><span><span className="live-dot"/>{review !== null ? `回放 · 第 ${review} 手` : '對局自動儲存在此裝置'}</span><div><button aria-label="悔棋" title="悔棋" onClick={undo} disabled={!history.length}><RotateCcw size={17}/></button><button aria-label="翻轉棋盤" title="翻轉棋盤" onClick={() => setFlipped(v => !v)}><ArrowLeftRight size={17}/></button><button aria-label="匯出 PGN" title="匯出 PGN" onClick={download}><ArrowDownToLine size={17}/></button></div></div>
      {error && <div className="error" role="alert">{error}<button onClick={changed}>重試</button></div>}
    </section>
    <aside className="side-panel"><section className="session-card"><div className="section-label">LET’S PLAY <Swords size={16}/></div><h2>練習，從這一局開始</h2><p>不用急著找到最佳走法。<br/>先觀察、再思考，享受下棋的樂趣。</p><div className="session-details"><div><span>對戰模式</span><strong>玩家 vs AI</strong></div><div><span>目前難度</span><strong><i className="difficulty-bars">▂▅▇</i> {levels[level].label}</strong></div></div><button className="primary-button" onClick={() => { setDraftColor(player); setDraftLevel(level); setModal('new'); }}><Swords size={18}/> 開始新對局 <ArrowUpRight size={18}/></button><button className="resign-button" disabled={over || !history.length} onClick={() => setModal('resign')}><Flag size={14}/> 認輸並結束對局</button></section>
    <section className="history-card"><div className="tabs" role="tablist" aria-label="對局資訊"><button role="tab" aria-selected={tab === 'moves'} className={tab === 'moves' ? 'active' : ''} onClick={() => setTab('moves')}>走法紀錄 <span>{history.length}</span></button><button role="tab" aria-selected={tab === 'guide'} className={tab === 'guide' ? 'active' : ''} onClick={() => setTab('guide')}>練習指南</button></div>
    {tab === 'moves' ? <><div className="move-table"><div className="move-table-head"><span>回合</span><span>白方</span><span>黑方</span></div><div className="move-scroll">{!history.length ? <div className="empty-history"><span>♙</span><strong>故事，從第一步開始</strong><p>點選棋子與目的格，或直接拖曳棋子。<br/>你的每一步都會記錄在這裡。</p></div> : Array.from({ length: Math.ceil(history.length / 2) }, (_, i) => <div className="move-row" key={i}><span>{i + 1}.</span>{[i * 2, i * 2 + 1].map(j => <button key={j} disabled={!history[j]} className={reviewAt === j + 1 ? 'current-move' : ''} onClick={() => { setReview(j + 1); setSelected(null); }}>{history[j]?.san ?? '—'}</button>)}</div>)}<div ref={movesEnd}/></div></div><div className="replay-controls"><button aria-label="回到開局" disabled={!history.length} onClick={() => setReview(0)}><ChevronsLeft size={19}/></button><button aria-label="上一步" disabled={!reviewAt} onClick={() => setReview(Math.max(0, reviewAt - 1))}><ChevronLeft size={19}/></button><button className="back-live" disabled={review === null} onClick={() => setReview(null)}>回到對局</button><button aria-label="下一步" disabled={reviewAt >= history.length} onClick={() => setReview(reviewAt + 1)}><ChevronRight size={19}/></button><button aria-label="最新局面" disabled={review === null} onClick={() => setReview(null)}><ChevronsRight size={19}/></button></div></> : <div className="guide-content"><strong>落子前，給自己三個問題</strong><p>① 對手正在威脅什麼？</p><p>② 我的棋子安全嗎？</p><p>③ 有沒有將軍、吃子或進攻機會？</p><small>點選走法可回放棋局。按「回到對局」繼續下棋；悔棋會回到你上次落子前。</small></div>}</section>
    <section className="coach-card"><div className="coach-icon"><Lightbulb size={21}/></div><div><div className="coach-heading">今天的小提醒 <span>開局觀念</span></div><p>先讓馬和象參與戰局，並找機會王車易位，讓國王住進安全的家。</p></div></section>
    <Link href="/review" className="review-entry"><BookOpen size={18}/><span>前往復盤教室，分析棋局與重走練習 →</span></Link>
    </aside></div><footer><span>棋伴 CHESSMATE</span><p>不只下一盤棋，更學會下一步。</p><span>用好奇心，換一點點進步 <Sparkles size={13}/></span></footer></main>
    {(modal || promotion) && <div className="modal-backdrop"><section role="dialog" aria-modal="true" aria-labelledby="dialog-title" className="modal"><button className="modal-close" aria-label="關閉" onClick={() => { setModal(null); setPromotion(null); }}><X size={20}/></button>{promotion ? <><h2 id="dialog-title">選擇升變棋子</h2><p>你的兵抵達底線了，想讓它成為哪個棋子？</p><div className="promotion-options">{([{piece:'q',name:'后',icon:'♛'},{piece:'r',name:'車',icon:'♜'},{piece:'b',name:'象',icon:'♝'},{piece:'n',name:'馬',icon:'♞'}] as const).map(p => <button key={p.piece} onClick={() => play(promotion.from, promotion.to, p.piece)}><span>{p.icon}</span>{p.name}</button>)}</div></> : modal === 'new' ? <><div className="eyebrow">A FRESH START</div><h2 id="dialog-title">開啟你的下一局</h2><p>{history.length && !over ? '開始後將取代目前對局，建議先匯出棋譜。' : '選好棋色與難度，帶著好奇心出發。'}</p><label>你的棋色</label><div className="choice-row">{(['w','b'] as const).map(c => <button className={draftColor === c ? 'chosen' : ''} key={c} onClick={() => setDraftColor(c)}>{c === 'w' ? '♔ 執白先行' : '♚ 執黑後行'}{draftColor === c && <Check size={15}/>}</button>)}</div><label>AI 難度</label><div className="choice-row">{(Object.keys(levels) as Level[]).map(l => <button key={l} className={draftLevel === l ? 'chosen' : ''} onClick={() => setDraftLevel(l)}>{levels[l].label}</button>)}</div><p className="modal-note">難度為相對強度設定，並非正式 Elo 評級。</p><button className="primary-button" onClick={start}>開始對弈 <ArrowUpRight size={18}/></button></> : modal === 'resign' ? <><h2 id="dialog-title">結束這一局？</h2><p>這局將記錄為認輸。你仍可回放走法、匯出棋譜，或開始新的一局。</p><button className="primary-button" onClick={() => { setResigned(true); setModal(null); }}>確認認輸</button><button className="resign-button" onClick={() => setModal(null)}>繼續練習</button></> : <><h2 id="dialog-title">歡迎來到棋伴</h2><p>你預設執白先行。點選自己的棋子查看合法目的格，再點選目的格落子，也可以拖曳。</p><p>在「開始新對局」選擇棋色與難度。走法紀錄可點選回放；下方工具提供悔棋、翻轉棋盤與 PGN 匯出。</p><p>此版本採三次重複局面與五十步規則自動和棋。對局保存在此瀏覽器；清除瀏覽器資料會移除紀錄。</p><p>前往「復盤教室」可分析此裝置的對局或貼上 PGN，查看關鍵失誤並重走練習。分析採 Stockfish 與規則式說明，個人化 AI 教學將在後續加入。</p><button className="primary-button" onClick={() => setModal(null)}>開始練習</button></>}</section></div>}
  </div>;
}
