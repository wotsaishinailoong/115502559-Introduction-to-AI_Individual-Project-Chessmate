'use client';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { BookOpen, Check, Eye, EyeOff, History, KeyRound, Swords } from 'lucide-react';
import { isProvider, providers, type ConnectionStatus, type Provider } from '../../lib/tutor-config';

const emptyStatus: ConnectionStatus = { available: false, source: 'none', provider: null, model: null, expiresAt: null };
function safeStatus(value: unknown): ConnectionStatus {
  const data = value as ConnectionStatus | null;
  if (!data || typeof data.available !== 'boolean' || !['personal', 'site', 'none'].includes(data.source) || data.provider !== null && !isProvider(data.provider) || data.model !== null && typeof data.model !== 'string' || data.expiresAt !== null && !Number.isFinite(data.expiresAt)) throw new Error('無法讀取連線狀態，請重新整理。');
  return { available: data.available, source: data.source, provider: data.provider, model: data.model, expiresAt: data.expiresAt };
}
export default function Settings() {
  const [status, setStatus] = useState<ConnectionStatus>(emptyStatus);
  const [loaded, setLoaded] = useState(false);
  const [provider, setProvider] = useState<Provider>('openai');
  const [model, setModel] = useState<string>(providers.openai.model);
  const [key, setKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const pending = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/tutor/settings', { cache: 'no-store', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(8000)]) })
      .then(async response => { if (!response.ok) throw new Error('讀取連線失敗，請確認預覽仍已登入，再重新整理。'); return safeStatus(await response.json()); })
      .then(data => { if (!controller.signal.aborted) { setStatus(data); if (data.provider) { setProvider(data.provider); setModel(data.model ?? providers[data.provider].model); } } })
      .catch(e => { if (!controller.signal.aborted) setError(e.message); }).finally(() => { if (!controller.signal.aborted) setLoaded(true); });
    return () => { controller.abort(); pending.current?.abort(); };
  }, []);
  useEffect(() => {
    if (!status.expiresAt) return;
    const timer = setTimeout(() => {
      fetch('/api/tutor/settings', { cache: 'no-store', signal: AbortSignal.timeout(8000) }).then(r => r.ok ? r.json() : null).then(data => { if (data) { setStatus(safeStatus(data)); setNotice('個人連線已到期，若要繼續使用，請重新測試並暫存金鑰。'); } }).catch(() => setError('個人連線可能已到期，請重新整理確認狀態。'));
    }, Math.max(0, status.expiresAt - Date.now()) + 200);
    return () => clearTimeout(timer);
  }, [status.expiresAt]);
  function choose(next: Provider) { setProvider(next); setModel(providers[next].model); setKey(''); setShowKey(false); setError(''); setNotice(''); }
  async function change(method: 'POST' | 'DELETE') {
    if (pending.current) return;
    const controller = new AbortController(); pending.current = controller; setBusy(true); setError(''); setNotice('');
    try {
      const response = await fetch('/api/tutor/settings', { method, headers: method === 'POST' ? { 'Content-Type': 'application/json' } : undefined,
        body: method === 'POST' ? JSON.stringify({ provider, model, key }) : undefined, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(15000)]) });
      if (response.status === 401) throw new Error('預覽登入可能已過期，請從 Codespaces 的 Ports 重新開啟網站後再試。');
      const data = await response.json();
      if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : '無法更新連線，請稍後重試。');
      if (!controller.signal.aborted) {
        let checked = safeStatus(data); setKey(''); setShowKey(false);
        if (method === 'POST') {
          const confirmation = await fetch('/api/tutor/settings', { cache: 'no-store', signal: AbortSignal.any([controller.signal, AbortSignal.timeout(8000)]) });
          if (!confirmation.ok) throw new Error('連線測試已通過，但無法確認暫存狀態，請重新整理查看。');
          checked = safeStatus(await confirmation.json()); setStatus(checked);
          if (checked.source !== 'personal' || checked.provider !== provider || checked.model !== model.trim()) throw new Error('測試成功，但暫存連線未能保留。請用新分頁開啟網站，確認允許本站 Cookie 後，再輸入金鑰重試。');
        }
        if (controller.signal.aborted) return;
        setStatus(checked);
        setNotice(method === 'POST' ? '連線成功，個人金鑰已暫存一小時。回到復盤教室即可使用 AI 解說。' : checked.available ? '個人連線已移除，現在使用站方提供的 AI 連線。' : '個人連線已移除，仍可使用引擎教學。');
      }
    } catch (e) { if (!controller.signal.aborted) setError(e instanceof Error && e.name !== 'TimeoutError' ? e.message : '連線測試逾時，原有連線未變更，請稍後重試。'); }
    finally { if (!controller.signal.aborted) setBusy(false); if (pending.current === controller) pending.current = null; }
  }
  return <div className="app-shell">
    <header className="topbar"><Link className="brand" href="/"><span className="brand-icon">♞</span><strong>棋伴<span>Chessmate</span></strong></Link><nav><Link href="/" className="review-nav-link"><Swords size={16}/>對弈練習</Link><Link href="/review" className="review-nav-link"><BookOpen size={16}/>復盤教室</Link><Link href="/library" className="review-nav-link"><History size={16}/>我的複習</Link><Link href="/settings" className="nav-active"><KeyRound size={16}/>AI 設定</Link></nav></header>
    <main className="settings-page"><div className="page-heading"><div><div className="eyebrow"><span/> YOUR PERSONAL AI COACH</div><h1>連接你的 AI 教練<span>。</span></h1><p>選擇服務、測試連線，再讓教練幫你整理關鍵走法。</p></div></div>
      <div className="settings-grid"><section className="session-card settings-form"><div className="section-label">API CONNECTION <KeyRound size={17}/></div><h2>設定個人金鑰</h2><p>支援 OpenAI 與 Google Gemini。切換服務時，請輸入該服務的金鑰。</p>
        <form onSubmit={e => { e.preventDefault(); void change('POST'); }}><fieldset disabled={busy || !loaded}><legend>選擇 AI 服務</legend><div className="choice-row provider-choices">{(['openai', 'gemini'] as const).map(p => <button key={p} type="button" aria-pressed={provider === p} className={provider === p ? 'chosen' : ''} onClick={() => choose(p)}>{providers[p].name}{provider === p && <Check size={14}/>}</button>)}</div>
          <label htmlFor="tutor-model">模型 ID</label><input id="tutor-model" value={model} required maxLength={100} onChange={e => setModel(e.target.value)} autoComplete="off" spellCheck={false}/><p className="analysis-note">預設：{providers[provider].model}。也可填入你帳號可用且支援 JSON 輸出的文字模型 ID。</p>
          <label htmlFor="tutor-api-key">{providers[provider].name} API 金鑰</label><div className="key-input"><input id="tutor-api-key" name="tutor-key" type={showKey ? 'text' : 'password'} value={key} required minLength={10} maxLength={512} onChange={e => setKey(e.target.value)} autoComplete="off" spellCheck={false} placeholder="請在此貼上金鑰"/><button type="button" aria-label={showKey ? '隱藏金鑰' : '顯示金鑰'} onClick={() => setShowKey(v => !v)}>{showKey ? <EyeOff size={17}/> : <Eye size={17}/>}</button></div>
          <a className="get-key-link" href={providers[provider].keyUrl} target="_blank" rel="noreferrer">到 {providers[provider].name} 取得金鑰 ↗</a>
          <button className="primary-button connect-button" type="submit" disabled={!key.trim() || !model.trim()}>{busy ? '正在測試連線…' : '測試連線並暫存'}</button>
        </fieldset></form>
        <p className="analysis-note">測試只查詢金鑰是否可存取模型，不產生教學內容；真正的 AI 解說會依服務商的額度與計費規則使用。</p>
        {error && <div className="error" role="alert">{error}</div>}{notice && <div className="storage-notice" role="status">{notice}</div>}
      </section><aside className="settings-aside"><section className="session-card connection-status"><div className="section-label">CURRENT CONNECTION</div><h2>目前連線</h2><div className={'connection-badge ' + (status.available ? 'connected' : '')}><span/>{!loaded ? '正在讀取…' : status.source === 'personal' ? '已使用個人金鑰連線' : status.source === 'site' ? '使用站方連線' : '尚未連線'}</div>
        {status.available && <dl><div><dt>服務</dt><dd>{status.provider ? providers[status.provider].name : '—'}</dd></div><div><dt>模型</dt><dd>{status.model}</dd></div>{status.expiresAt && <div><dt>暫存至</dt><dd>{new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', hour: '2-digit', minute: '2-digit', hour12: false }).format(status.expiresAt)}（台北時間）</dd></div>}</dl>}
        <button className="disconnect-button" disabled={busy || status.source !== 'personal'} onClick={() => void change('DELETE')}>移除個人連線</button><p className="analysis-note">移除只會清除本站暫存，不會撤銷服務商的金鑰。</p>
      </section><section className="coach-card"><div><div className="coach-heading">金鑰如何保存？</div><p>個人金鑰只在本站伺服器暫存一小時，重啟網站後需重新連線。不會寫入瀏覽器的 localStorage，也不會加入棋譜或複習備份。</p></div></section><section className="settings-next"><h3>連線後怎麼使用？</h3><p>前往復盤教室 → 分析棋局 → 選擇關鍵時刻 → 查看參考答案 → 請 AI 教練解說。</p><Link href="/review">回到復盤教室 →</Link><p className="analysis-note">沒有設定金鑰，對戰、引擎分析、重走與講義下載仍可正常使用。</p></section></aside></div>
      <footer><span>棋伴 CHESSMATE</span><p>讓每一次解說，都有具體的棋局依據。</p></footer>
    </main>
  </div>;
}
