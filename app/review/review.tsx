'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { Chess, type Color, type PieceSymbol, type Square } from 'chess.js';
import { Chessboard } from 'react-chessboard';
import { ArrowDownToLine, BookOpen, Check, ChevronLeft, ChevronRight, History, Lightbulb, RotateCcw, Sparkles, Swords } from 'lucide-react';
import TutorLesson, { type Variation } from './tutor-lesson';
import { buildLesson, evidenceFromPosition, lessonMarkdown } from '../../lib/teaching';
import { analysisKey, loadLibrary, recordPractice, saveAnalysis, type Practice } from '../../lib/library';
import { AnalysisEngine } from '../../lib/analysis-engine';
import { acceptable, analyzeGame, chartValue, cpLoss, keyMoments, legalLine, parseGame, REVIEW_NODES, scoreLabel, type Position, type Report, type Score } from '../../lib/analysis';

const names = { blunder: '重大失誤', mistake: '一般失誤', 'missed-mate': '錯失將殺', 'allows-mate': '允許對方將殺' };
const example = '1. f3 e5 2. g4 Qh4# 0-1';
function moveLabel(p: Position) { return `${p.fen.split(' ')[5]}${p.mover === 'w' ? '.' : '…'} ${p.san}`; }

function Curve({ report, cursor, onSelect }: { report: Report; cursor: number; onSelect: (ply: number) => void }) {
  const values = [report.initialScore, ...report.positions.map(p => p.played.score)];
  const coords = values.map((score, i) => [36 + i / (values.length - 1) * 528, 94 - chartValue(score) * 9]);
  return <section className="evaluation-card" aria-label="局勢評分圖">
    <div className="evaluation-heading"><h2>局勢走勢</h2><span>白方優勢 ＋ ／ 黑方優勢 −</span></div>
    <p className="analysis-note">這是引擎局勢評分，不是勝率。圖形範圍為 ±8，將殺以端點表示。</p>
    <svg viewBox="0 0 600 190" role="img" aria-label="局勢評分曲線，白方優勢向上，黑方優勢向下">
      <title>使用下方走法選單或方向鍵查看每手棋的確切評分</title>
      {[-8, 0, 8].map(v => <g key={v}><line x1="36" x2="564" y1={94 - v * 9} y2={94 - v * 9} stroke="#dce4d5" strokeDasharray={v ? '3 4' : undefined}/><text x="5" y={98 - v * 9} fontSize="10" fill="#75846e">{v > 0 ? '+' : ''}{v}</text></g>)}
      <polyline points={coords.map(c => c.join(',')).join(' ')} fill="none" stroke="#275a48" strokeWidth="2"/>
      {coords.map(([x, y], i) => <circle key={i} cx={x} cy={y} r={i === cursor ? 5 : 2.5} fill={i === cursor ? '#b6842a' : '#275a48'}><title>{i === 0 ? '開局' : moveLabel(report.positions[i - 1])}：{scoreLabel(values[i])}</title></circle>)}
    </svg>
    <div className="chart-controls"><button aria-label="查看上一手評分" onClick={() => onSelect(Math.max(0, cursor - 1))} disabled={!cursor}><ChevronLeft size={18}/></button><select aria-label="選擇評分走法" value={cursor} onChange={e => onSelect(Number(e.target.value))}>{values.map((s, i) => <option key={i} value={i}>{i === 0 ? '開局' : moveLabel(report.positions[i - 1])} · {scoreLabel(s)}</option>)}</select><button aria-label="查看下一手評分" disabled={cursor === values.length - 1} onClick={() => onSelect(Math.min(values.length - 1, cursor + 1))}><ChevronRight size={18}/></button></div>
  </section>;
}

export default function Review() {
  const [pgn, setPgn] = useState('');
  const [player, setPlayer] = useState<Color>('w');
  const [report, setReport] = useState<Report | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState({ percent: 0, text: '' });
  const [error, setError] = useState('');
  const [cursor, setCursor] = useState(0);
  const [moment, setMoment] = useState<number | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [hint, setHint] = useState(false);
  const [variation, setVariation] = useState<Variation | null>(null);
  const [trial, setTrial] = useState<Chess | null>(null);
  const [selected, setSelected] = useState<Square | null>(null);
  const [pendingPromotion, setPendingPromotion] = useState<{ from: string; to: string } | null>(null);
  const [feedback, setFeedback] = useState('');
  const [grading, setGrading] = useState(false);
  const [reportId, setReportId] = useState<string | null>(null);
  const [practice, setPractice] = useState<Record<string, Practice>>({});
  const [storageNotice, setStorageNotice] = useState('');
  const assisted = useRef(new Set<string>());
  const boardSection = useRef<HTMLElement>(null);
  const engine = useRef<AnalysisEngine | null>(null);
  const run = useRef(0);
  useEffect(() => {
    let currentPgn = ''; let currentPlayer: Color = 'w';
    try {
      const stored = JSON.parse(localStorage.getItem('chessmate.game.v1') ?? 'null');
      if (typeof stored?.pgn === 'string') { currentPgn = stored.pgn; setPgn(stored.pgn); }
      if (stored?.player === 'b') { currentPlayer = 'b'; setPlayer('b'); }
    } catch { /* PGN can still be pasted when local storage is unavailable. */ }
    try {
      const library = loadLibrary(); const query = new URLSearchParams(window.location.search);
      let entry = library.entries.find(e => e.id === (query.get('saved') ?? library.activeId));
      if (!query.has('saved') && query.get('current') === '1') {
        entry = undefined;
        try {
          const current = parseGame(currentPgn);
          const key = JSON.stringify([current.initialFen, currentPlayer, current.moves.map(m => m.from + m.to + (m.promotion ?? ''))]);
          entry = library.entries.find(e => analysisKey(e.report) === key);
        } catch { /* A fresh or empty game has no report yet. */ }
      }
      if (query.has('saved') && !entry) setStorageNotice('找不到這份報告，可能已被刪除。請到「我的複習」查看其他紀錄。');
      if (entry) {
        setPgn(entry.pgn); setPlayer(entry.report.player); setReport(entry.report); setReportId(entry.id); setPractice(entry.practice); setCursor(entry.report.positions.length);
        const chosen = keyMoments(entry.report).find(p => p.ply === Number(query.get('ply')));
        if (chosen) openMoment(chosen);
      }
    } catch (e) { setStorageNotice((e as Error).message); }
    return () => { run.current++; engine.current?.close(); };
  }, []);
  function clearTrial() { setHint(false); setVariation(null); setTrial(null); setSelected(null); setPendingPromotion(null); setFeedback(''); setRevealed(false); }
  function cancel() { run.current++; engine.current?.close(); engine.current = null; setBusy(false); setGrading(false); setProgress({ percent: 0, text: '分析已取消，可重新開始。' }); }
  async function start() {
    try { parseGame(pgn); } catch (e) { setError((e as Error).message); return; }
    cancel(); const token = ++run.current;
    setError(''); setReport(null); setReportId(null); setPractice({}); setStorageNotice(''); clearTrial(); setMoment(null); setBusy(true); setProgress({ percent: 0, text: '正在載入分析引擎…' });
    let worker: AnalysisEngine | null = null;
    try {
      worker = new AnalysisEngine(); engine.current = worker;
      await worker.init();
      const result = await analyzeGame(pgn, player, worker.search, (percent, text) => { if (token === run.current) setProgress({ percent, text }); });
      if (token === run.current) { setReport(result); setCursor(result.positions.length); preserve(result, pgn); }
    } catch (e) { if (token === run.current) setError(e instanceof Error ? e.message : '分析失敗，請重新嘗試。'); }
    finally { worker?.close(); if (token === run.current) { engine.current = null; setBusy(false); } }
  }
  function inspect(ply: number) {
    run.current++; engine.current?.close(); engine.current = null; setGrading(false);
    clearTrial(); setMoment(null); setCursor(ply);
  }
  function editPgn(value: string) {
    inspect(0); setPgn(value); setReport(null); setReportId(null); setPractice({}); setStorageNotice(''); setError(''); setProgress({ percent: 0, text: '' });
  }
  function preserve(result: Report, source: string) {
    try { const saved = saveAnalysis(source, result); setReportId(saved.id); setPractice(saved.practice); setStorageNotice(''); }
    catch (e) { setStorageNotice(`這份報告尚未保存：${(e as Error).message}`); }
  }
  function showHint() { if (active) assisted.current.add(`${active.fen}|${active.uci}`); setHint(true); }
  function showAnswer() { if (active) assisted.current.add(`${active.fen}|${active.uci}`); setRevealed(true); }
  function openMoment(p: Position) {
    inspect(p.ply - 1); setMoment(p.ply); setTrial(new Chess(p.fen));
    setFeedback('先不看答案，試著找出更好的走法。');
    boardSection.current?.focus({ preventScroll: true });
    boardSection.current?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' });
  }
  const active = report?.positions.find(p => p.ply === moment) ?? null;
  async function attempt(from: string, to: string, promotion?: PieceSymbol) {
    if (!trial || !active || grading || variation || trial.history().length) return false;
    const moves = trial.moves({ verbose: true }).filter(m => m.from === from && m.to === to);
    if (!moves.length) return false;
    if (moves.some(m => m.promotion) && !promotion) { setPendingPromotion({ from, to }); return false; }
    const next = new Chess(active.fen);
    const move = next.move({ from, to, promotion });
    setTrial(next); setSelected(null); setPendingPromotion(null); setFeedback('正在檢查你的走法…'); setGrading(true); setError('');
    const token = ++run.current;
    let worker: AnalysisEngine | null = null;
    try {
      worker = new AnalysisEngine(); engine.current = worker; await worker.init();
      const best = await worker.search(active.position, active.mover, REVIEW_NODES);
      const tested = await worker.search(active.position, active.mover, REVIEW_NODES, move.from + move.to + (move.promotion ?? ''));
      const line = legalLine(active.fen, tested.pv);
      if (token === run.current) {
        const good = acceptable(best.score, tested.score, active.mover);
        setFeedback(good ? '做得好！這步接近引擎建議，或保留了相同的將殺結果。' : `還有改進空間。${line.length > 1 ? `對手可以回應 ${line[1]}。` : ''}你可以重試，或查看參考答案。`);
        if (reportId) {
          try {
            const updated = recordPractice(reportId, active.ply, good, !assisted.current.has(`${active.fen}|${active.uci}`));
            setPractice(old => ({ ...old, [active.ply]: updated }));
          } catch (e) { setStorageNotice(`走法已評估，但進度尚未保存：${(e as Error).message}`); }
        }
      }
    } catch (e) { if (token === run.current) { setFeedback('暫時無法評估這一步，請重試。'); setError(e instanceof Error ? e.message : '評估失敗。'); } }
    finally { worker?.close(); if (token === run.current) { engine.current = null; setGrading(false); } }
    return true;
  }
  function onSquare(square: string) {
    if (!trial || grading || variation || trial.history().length || !active) return;
    if (selected && trial.moves({ square: selected, verbose: true }).some(m => m.to === square)) { void attempt(selected, square); return; }
    setSelected(trial.get(square as Square)?.color === active.mover ? square as Square : null);
  }
  let variationFen: string | null = null;
  if (variation && active) {
    const board = new Chess(active.fen);
    const line = variation.kind === 'best' ? active.best.pv : active.played.pv.length ? active.played.pv : [active.uci];
    for (const m of line.slice(0, variation.step)) board.move({ from: m.slice(0, 2), to: m.slice(2, 4), promotion: m[4] });
    variationFen = board.fen();
  }
  const fen = variationFen ?? trial?.fen() ?? (report ? cursor === 0 ? report.initialFen : report.positions[cursor - 1].after : new Chess().fen());
  const squareStyles: Record<string, React.CSSProperties> = {};
  if (selected && trial && !variation) {
    squareStyles[selected] = { backgroundColor: '#d6bd65' };
    for (const move of trial.moves({ square: selected, verbose: true })) squareStyles[move.to] = { background: 'radial-gradient(circle, #214e4866 22%, transparent 24%)' };
  }
  function downloadLesson() {
    if (!report) return;
    const url = URL.createObjectURL(new Blob([lessonMarkdown(report)], { type: 'text/markdown;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = 'chessmate-review.md'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const moments = report ? keyMoments(report) : [];
  const atScore: Score | null = report ? cursor === 0 ? report.initialScore : report.positions[cursor - 1].played.score : null;
  return <div className="app-shell">
    <header className="topbar"><Link className="brand" href="/"><span className="brand-icon">♞</span><strong>棋伴<span>Chessmate</span></strong></Link><nav><Link href="/" className="review-nav-link"><Swords size={16}/> 對弈練習</Link><Link href="/review" className="nav-active"><BookOpen size={16}/> 復盤教室</Link><Link href="/library" className="review-nav-link"><History size={16}/>我的複習</Link><Link href="/settings" className="review-nav-link">AI 設定</Link></nav></header>
    <main><div className="page-heading"><div><div className="eyebrow"><span/> LEARN FROM YOUR MOVES</div><h1>回頭看，走得更好<span>。</span></h1><p>找出關鍵時刻，先試著重走，再看引擎的建議。</p></div><Link href="/" className="review-back">← 回到對局</Link></div>
      {storageNotice && <div className="storage-notice storage-warning" role="status"><span>{storageNotice}</span>{report && !busy && !grading && <button onClick={() => preserve(report, pgn)}>重新保存報告</button>}<Link href="/library">管理複習紀錄 →</Link></div>}
      {reportId && !storageNotice && <div className="saved-indicator"><Check size={14}/><span>報告已保存在此瀏覽器</span><Link href="/library">查看我的複習 →</Link></div>}
      <div className="workspace review-workspace"><section className="board-section" ref={boardSection} tabIndex={-1} aria-label="復盤棋盤">
        <div className="review-board-heading"><strong>{variation ? `${variation.kind === 'best' ? '建議變化' : '原走法變化'} · 第 ${variation.step} 手` : active ? trial?.history().length ? `你的重走：${trial.history()[0]}` : `${moveLabel(active)} 之前 · 輪到${active.mover === 'w' ? '白' : '黑'}方` : report ? cursor === 0 ? '開局局面' : `第 ${cursor} 手之後` : '等待匯入棋局'}</strong><span>{trial ? '重走練習' : atScore ? `白方視角 ${scoreLabel(atScore)}` : 'PGN 棋譜分析'}</span></div>
        <div className="board-frame"><Chessboard options={{ id: 'review-board', position: fen, boardOrientation: player === 'w' ? 'white' : 'black', allowDragging: !!trial && !trial.history().length && !grading && !variation, onSquareClick: ({ square }) => onSquare(square), onPieceDrop: ({ sourceSquare, targetSquare }) => { if (targetSquare) void attempt(sourceSquare, targetSquare); return false; }, squareStyles, darkSquareStyle: { backgroundColor: '#79958b' }, lightSquareStyle: { backgroundColor: '#f0eee5' } }}/></div>
        {pendingPromotion && <div className="review-promotion" role="group" aria-label="重試升變選擇"><span>選擇升變：</span>{(['q', 'r', 'b', 'n'] as const).map((p, i) => <button key={p} onClick={() => void attempt(pendingPromotion.from, pendingPromotion.to, p)}>{['后', '車', '象', '馬'][i]}</button>)}<button onClick={() => setPendingPromotion(null)}>取消</button></div>}
        {active && <div className="retry-panel"><p role="status" aria-live="polite">{feedback}</p><div className="retry-actions"><button disabled={grading} onClick={() => openMoment(active)}><RotateCcw size={15}/> 再試一次</button><button disabled={grading} onClick={showHint}><Lightbulb size={15}/> 給我提示</button><button disabled={grading} onClick={showAnswer}><Lightbulb size={15}/> 查看參考答案</button></div>{practice[active.ply] && <p className="practice-summary">練習 {practice[active.ply].attempts} 次 · 答對 {practice[active.ply].successes} 次 · 獨立答對 {practice[active.ply].independentSuccesses} 次</p>}{hint && !revealed && <p className="lesson-hint" role="status">{buildLesson(evidenceFromPosition(active)).hint}</p>}{revealed && <div className="answer"><strong>引擎建議：{legalLine(active.fen, active.best.pv)[0]}</strong><TutorLesson key={active.ply} position={active} variation={variation} onVariation={value => { setVariation(value); setSelected(null); setPendingPromotion(null); }}/></div>}</div>}
        {report && <Curve report={report} cursor={cursor} onSelect={inspect}/>}
      </section><aside className="side-panel">
        <section className="session-card analysis-input"><div className="section-label">GAME REVIEW <Sparkles size={16}/></div><h2>分析你的棋局</h2><p>已帶入此裝置的對局，也可以貼上其他 PGN。分析不會改動原本的棋局。</p><label htmlFor="pgn-input">PGN 棋譜</label><textarea id="pgn-input" value={pgn} maxLength={32000} disabled={busy || grading} onChange={e => editPgn(e.target.value)} placeholder="例如：1. e4 e5 2. Nf3 Nc6" rows={5}/><div className="input-options"><button className="text-button" disabled={busy || grading} onClick={() => { editPgn(example); setPlayer('w'); }}>使用教學範例</button><span>最多 120 回合</span></div><label>分析哪一方的失誤？</label><div className="choice-row" role="group" aria-label="分析棋色">{(['w', 'b'] as const).map(c => <button key={c} aria-pressed={player === c} disabled={busy || grading} className={player === c ? 'chosen' : ''} onClick={() => { setPlayer(c); setReport(null); setReportId(null); setPractice({}); setStorageNotice(''); clearTrial(); setMoment(null); }}>{c === 'w' ? '白方' : '黑方'}{player === c && <Check size={14}/>}</button>)}</div>
          <button className="primary-button analyze-button" onClick={() => void start()} disabled={busy || grading || !pgn.trim()}><Sparkles size={17}/>{report ? '重新分析棋局' : '開始分析棋局'}</button>
          {busy && <div className="analysis-progress" role="status"><progress value={progress.percent} max={100} aria-label="棋局分析進度"/><p>{progress.text} · {progress.percent}%</p><button onClick={cancel}>取消分析</button></div>}
          {!busy && progress.text === '分析已取消，可重新開始。' && <p role="status">{progress.text}</p>}
          {error && <div className="error" role="alert">{error}</div>}
          <p className="analysis-note">在此裝置背景分析；長棋局需要較久，請保持此頁開啟。完成後會自動保存報告，最多 20 份。</p>
        </section>
        <section className="session-card moments-card"><div className="section-label">KEY MOMENTS <BookOpen size={16}/></div><h2>{report ? `${report.player === 'w' ? '白' : '黑'}方的關鍵時刻` : '從失誤中練習'}</h2>{!report ? <p>完成分析後，這裡會挑出最多三個值得重走的局面。</p> : !moments.length ? <div className="no-moments"><Check size={22}/><p>這次搜尋沒有找到達到標記門檻的關鍵失誤。這不代表每一步都是最佳走法。</p></div> : moments.map((p, i) => <button className={'moment-card ' + (moment === p.ply ? 'selected-moment' : '')} key={p.ply} onClick={() => openMoment(p)}><span className="moment-number">0{i + 1}</span><span><strong>{moveLabel(p)}</strong><span>{p.finding ? names[p.finding] : ''}{cpLoss(p.best.score, p.played.score, p.mover) !== null ? ` · 評分損失 ${((cpLoss(p.best.score, p.played.score, p.mover) ?? 0) / 100).toFixed(2)}` : ''}</span></span><span>重走 →</span></button>)}
        {report && <button className="download-lesson" onClick={downloadLesson}><ArrowDownToLine size={16}/>下載復盤講義</button>}{report && <p className="analysis-note">初步掃描後，加強搜尋最多六個候選失誤。一般失誤門檻約 1 分、重大失誤約 2 分；結果會隨搜尋預算改變。</p>}</section>
        <section className="coach-card"><div className="coach-icon"><Lightbulb size={21}/></div><div><div className="coach-heading">先思考，再看答案</div><p>點選關鍵時刻，在棋盤走出你的選擇。接近引擎建議的替代走法也能被接受。</p></div></section>
        <p className="analysis-note review-disclaimer">引擎教學可直接使用；可在「AI 設定」連接自己的 OpenAI 或 Gemini 金鑰。</p>
      </aside></div>
      <footer><span>棋伴 CHESSMATE</span><p>每一個失誤，都是下一次進步的起點。</p></footer>
    </main>
  </div>;
}
