'use client';
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDownToLine, BookOpen, History, Swords, Upload, X } from 'lucide-react';
import { backupLibrary, emptyLibrary, LIBRARY_KEY, loadLibrary, mergeLibraries, needsPractice, parseLibrary, persistLibrary, practiceItems, removeAnalysis, type Library } from '../../lib/library';
import { keyMoments } from '../../lib/analysis';
import { lessonMarkdown } from '../../lib/teaching';

const date = (value: number) => new Intl.DateTimeFormat('zh-TW', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Taipei' }).format(value);
function download(text: string, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type })); const a = document.createElement('a');
  a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export default function LibraryView() {
  const [library, setLibrary] = useState<Library>(emptyLibrary);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [theme, setTheme] = useState('all');
  const [pendingOnly, setPendingOnly] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [busy, setBusy] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [restore, setRestore] = useState<Library | null>(null);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const refresh = () => { try { setLibrary(loadLibrary()); setError(''); } catch (e) { setError((e as Error).message); } finally { setLoaded(true); } };
    refresh(); const listener = (e: StorageEvent) => { if (e.key === LIBRARY_KEY || e.key === null) refresh(); };
    window.addEventListener('storage', listener); return () => window.removeEventListener('storage', listener);
  }, []);
  const items = useMemo(() => practiceItems(library), [library]);
  const themes = useMemo(() => items.reduce<Record<string, number>>((all, p) => { all[p.theme] = (all[p.theme] ?? 0) + 1; return all; }, {}), [items]);
  const attempts = library.entries.reduce((sum, entry) => sum + Object.values(entry.practice).reduce((s, p) => s + p.attempts, 0), 0);
  const pending = items.filter(p => needsPractice(p.progress)).length;
  const independent = items.filter(p => p.progress.independentSuccesses > 0).length;
  const filtered = items.filter(p => (theme === 'all' || theme === p.theme) && (!pendingOnly || needsPractice(p.progress)));
  const visible = showAll ? filtered : filtered.slice(0, 6);
  async function importFile(file: File | undefined) {
    if (!file) return;
    setBusy(true); setError(''); setNotice('');
    try {
      if (file.size > 8_000_000) throw new Error('備份檔太大，請選擇由本站匯出的 JSON 備份。');
      const incoming = parseLibrary(await file.text());
      let current: Library;
      try { current = loadLibrary(); }
      catch { setRestore(incoming); return; }
      const merged = mergeLibraries(current, incoming); persistLibrary(merged); setLibrary(merged);
      setNotice(`匯入完成，目前共有 ${merged.entries.length} 份報告；相同棋局與棋色不會重複加入。`);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); if (input.current) input.current.value = ''; }
  }
  function backup() { try { download(backupLibrary(), 'chessmate-backup.json', 'application/json'); } catch (e) { setError((e as Error).message); } }
  function confirmRestore() {
    if (!restore) return;
    try { persistLibrary(restore); setLibrary(restore); setError(''); setNotice(`已從備份還原 ${restore.entries.length} 份報告。`); setRestore(null); }
    catch (e) { setError((e as Error).message); setRestore(null); }
  }
  function remove() {
    if (!deleteId) return;
    try { setLibrary(removeAnalysis(deleteId)); setDeleteId(null); setError(''); setNotice('已刪除這份報告與其複習紀錄。'); }
    catch (e) { setError((e as Error).message); setDeleteId(null); }
  }
  return <div className="app-shell">
    <header className="topbar"><Link className="brand" href="/"><span className="brand-icon">♞</span><strong>棋伴<span>Chessmate</span></strong></Link><nav><Link href="/" className="review-nav-link"><Swords size={16}/>對弈練習</Link><Link href="/review" className="review-nav-link"><BookOpen size={16}/>復盤教室</Link><Link href="/library" className="nav-active"><History size={16}/>我的複習</Link></nav></header>
    <main className="library-page"><div className="page-heading"><div><div className="eyebrow"><span/> A LITTLE BETTER, EVERY TIME</div><h1>把進步，留下來<span>。</span></h1><p>從過去的關鍵時刻，找到今天值得練習的一步。</p></div><Link className="review-back" href="/review">＋ 分析一份棋譜</Link></div>
      <div className="library-toolbar"><p>紀錄保存在目前瀏覽器。更換裝置或重建 Codespaces 前，請先匯出備份。</p><div><button disabled={busy || !loaded} onClick={backup}><ArrowDownToLine size={16}/>{error ? '匯出原始備份' : '匯出備份'}</button><button disabled={busy || !loaded} onClick={() => input.current?.click()}><Upload size={16}/>{busy ? '正在匯入…' : '匯入備份'}</button><input ref={input} type="file" accept="application/json,.json" aria-label="選擇複習備份" hidden onChange={e => void importFile(e.target.files?.[0])}/></div></div>
      {error && <div className="error" role="alert">{error}</div>}{notice && <div className="storage-notice" role="status">{notice}</div>}
      {!loaded ? <p className="loading">正在讀取紀錄…</p> : <>
        <div className="learning-stats"><div><span>已存報告</span><strong>{library.entries.length}</strong><small>最多 20 份</small></div><div><span>待加強局面</span><strong>{pending}</strong><small>未獨立答對或最近答錯</small></div><div><span>練習次數</span><strong>{attempts}</strong><small>已完成評估的重走</small></div><div><span>曾獨立答對</span><strong>{independent}</strong><small>局面數，不等於已精通</small></div></div>
        {!library.entries.length && !error ? <section className="library-empty"><BookOpen size={30}/><h2>從第一份復盤開始</h2><p>分析完成後，報告會自動保存在這裡。<br/>你可以隨時回來重走，不用重新等待分析。</p><Link className="primary-button" href="/review">前往復盤教室</Link></section> : <>
          <div className="library-grid"><section className="session-card practice-queue"><div className="section-label">PRACTICE AGAIN <BookOpen size={16}/></div><h2>今天，重走哪一步？</h2><div className="practice-filters"><select aria-label="篩選複習主題" value={theme} onChange={e => { setTheme(e.target.value); setShowAll(false); }}><option value="all">全部主題</option>{Object.keys(themes).map(t => <option key={t}>{t}</option>)}</select><label><input type="checkbox" checked={pendingOnly} onChange={e => { setPendingOnly(e.target.checked); setShowAll(false); }}/>只看待加強</label></div>
            {!visible.length ? <p className="empty-queue">{items.length ? '目前篩選條件下沒有局面，可以改看全部主題。' : '已存報告中沒有達到標記門檻的關鍵時刻。'}</p> : visible.map(p => <article className="practice-item" key={`${p.entryId}:${p.ply}`}><div><span className="practice-theme">{p.theme}</span><h3>第 {p.round} 回合 · {p.player === 'w' ? '白方' : '黑方'}曾走 {p.san}</h3><p>{p.progress.lastOutcome === 'retry' ? '最近一次還有改進空間' : p.progress.independentSuccesses ? '曾獨立答對' : p.progress.successes ? '曾在提示或答案後答對' : p.progress.attempts ? '還有改進空間' : '尚未練習'} · 已練習 {p.progress.attempts} 次</p></div><Link href={`/review?saved=${p.entryId}&ply=${p.ply}`}>開始複習 →</Link></article>)}
            {filtered.length > 6 && <button className="text-button" onClick={() => setShowAll(v => !v)}>{showAll ? '收起局面' : `查看全部 ${filtered.length} 個局面`}</button>}
          </section><section className="session-card theme-summary"><div className="section-label">LEARNING PATTERNS</div><h2>值得多留意的主題</h2>{!items.length ? <p className="analysis-note">有關鍵失誤後，這裡會整理示範線中的主題。</p> : Object.entries(themes).sort((a, b) => b[1] - a[1]).map(([name, count]) => <div className="theme-row" key={name}><div><span>{name}</span><span>{count} 個局面</span></div><meter value={count} min={0} max={items.length} aria-label={`${name}：${count} 個局面`}/></div>)}<p className="analysis-note">只統計每份報告選出的最多三個關鍵時刻，主題來自合法示範線；不是全局錯誤比例或完整戰術診斷。</p></section></div>
          <section className="saved-reports"><div className="saved-reports-heading"><h2>已保存的分析報告</h2><span>{library.entries.length} / 20</span></div>{library.entries.map(entry => <article className="saved-report" key={entry.id}><div><h3>{entry.report.player === 'w' ? '白方' : '黑方'}分析 · {Math.ceil(entry.report.positions.length / 2)} 回合</h3><p>分析時間 {date(entry.updatedAt)} · {keyMoments(entry.report).length} 個關鍵時刻</p></div><div className="saved-report-actions"><Link href={`/review?saved=${entry.id}`}>開啟報告</Link><button aria-label={`刪除${entry.report.player === 'w' ? '白方' : '黑方'}分析報告`} onClick={() => setDeleteId(entry.id)} disabled={busy}>刪除</button><button onClick={() => download(lessonMarkdown(entry.report), 'chessmate-review.md', 'text/markdown;charset=utf-8')}>下載講義</button></div></article>)}</section>
        </>}
      </>}
      <footer><span>棋伴 CHESSMATE</span><p>練習會留下痕跡，進步也會。</p></footer>
    </main>
    {deleteId && <div className="modal-backdrop"><section className="modal" role="dialog" aria-modal="true" aria-labelledby="delete-title"><button className="modal-close" aria-label="取消刪除" onClick={() => setDeleteId(null)}><X size={20}/></button><h2 id="delete-title">刪除這份報告？</h2><p>這會移除這份分析與其複習紀錄。對弈中的棋局仍會保留。若要備份，請先取消並匯出資料。</p><button className="primary-button" onClick={remove}>確認刪除</button><button className="resign-button" onClick={() => setDeleteId(null)}>保留報告</button></section></div>}
    {restore && <div className="modal-backdrop"><section className="modal" role="dialog" aria-modal="true" aria-labelledby="restore-title"><h2 id="restore-title">用備份還原複習紀錄？</h2><p>目前儲存的複習資料無法讀取。你選的備份已通過檢查，包含 {restore.entries.length} 份報告。還原會取代目前的複習資料；建議先匯出原始備份。對弈中的棋局會保留。</p><button className="resign-button" onClick={backup}>先匯出原始備份</button><button className="primary-button" onClick={confirmRestore}>確認還原</button><button className="resign-button" onClick={() => { setRestore(null); setError('未還原備份，原有資料未變更。'); }}>取消還原</button></section></div>}
  </div>;
}
