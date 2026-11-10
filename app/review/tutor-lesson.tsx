'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Sparkles } from 'lucide-react';
import type { Position } from '../../lib/analysis';
import { buildLesson, evidenceFromPosition, validateTutorText, type TutorText } from '../../lib/teaching';

export type Variation = { kind: 'best' | 'played'; step: number };
export default function TutorLesson({ position, variation, onVariation }: { position: Position; variation: Variation | null; onVariation: (value: Variation | null) => void }) {
  const evidence = useMemo(() => evidenceFromPosition(position), [position]);
  const lesson = useMemo(() => buildLesson(evidence), [evidence]);
  const [available, setAvailable] = useState(false);
  const [checking, setChecking] = useState(true);
  const [working, setWorking] = useState(false);
  const [text, setText] = useState<TutorText>(lesson);
  const [source, setSource] = useState<'engine' | 'ai'>('engine');
  const [notice, setNotice] = useState('');
  const pending = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/tutor', { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(8000)]), cache: 'no-store' })
      .then(r => r.ok ? r.json() : null).then(data => { if (!controller.signal.aborted) setAvailable(data?.available === true); })
      .catch(() => {}).finally(() => { if (!controller.signal.aborted) setChecking(false); });
    return () => { controller.abort(); pending.current?.abort(); };
  }, []);
  async function explain() {
    if (pending.current) return;
    const controller = new AbortController(); pending.current = controller; setWorking(true); setNotice('');
    try {
      const response = await fetch('/api/tutor', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(evidence), signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20000)]) });
      if (!response.ok) throw new Error('Tutor unavailable');
      const data = await response.json();
      if (data.source !== 'engine' && data.source !== 'ai') throw new Error('Unexpected response');
      const checked = validateTutorText(data.text, lesson, evidence);
      if (!controller.signal.aborted) { setText(checked); setSource(data.source); setNotice(typeof data.notice === 'string' ? data.notice.slice(0, 200) : ''); }
    } catch {
      if (!controller.signal.aborted) { setText(lesson); setSource('engine'); setNotice('AI 教練暫時無法回應，先使用下方的引擎教學。'); }
    } finally { if (!controller.signal.aborted) setWorking(false); if (pending.current === controller) pending.current = null; }
  }
  const kind = variation?.kind ?? 'best';
  const labels = kind === 'best' ? lesson.bestLine : lesson.playedLine;
  const step = variation?.step ?? 0;
  return <div className="tutor-lesson">
    <div className="lesson-label"><span>{lesson.theme}</span><span>{source === 'ai' ? 'AI 教練解說' : '引擎教學'}</span></div>
    <h3>{text.title}</h3><h4>為什麼值得改進？</h4><ul>{text.why.map((s, i) => <li key={i}>{s}</li>)}</ul>
    <h4>可以怎麼比較？</h4><p>{text.better}</p>
    <div className="takeaway"><span>下次記得</span><p>{text.takeaway}</p></div>
    <div className="ai-explanation"><button className="ai-tutor-button" disabled={checking || !available || working || source === 'ai'} onClick={() => void explain()}><Sparkles size={16}/>{working ? '教練正在整理…' : source === 'ai' ? '已取得 AI 解說' : checking ? '正在確認教練狀態…' : available ? '請 AI 教練解說這一步' : 'AI 教練尚未啟用'}</button>
      {available && source !== 'ai' && <p className="analysis-note">點選後，會把這個局面與分析資料傳送給 AI 服務產生解說。</p>}
      {!available && !checking && <p className="analysis-note">本站尚未開啟 AI 教練，你仍可使用完整的引擎教學與重走功能。</p>}
      {working && <p role="status">正在根據這一步的引擎資料整理教學…</p>}
      {notice && <p className="tutor-notice" role="status">{notice}</p>}
    </div>
    <details className="lesson-evidence"><summary>查看分析依據</summary><ul>{lesson.facts.filter(f => text.factIds.includes(f.id)).map(f => <li key={f.id}>{f.text}</li>)}</ul></details>
    <div className="reference-lines"><h4>在棋盤上比較變化</h4><p>建議變化：{lesson.bestLine.join(' → ')}</p><p>原走法變化：{lesson.playedLine.join(' → ')}</p><div className="variation-tabs"><button aria-pressed={variation?.kind === 'best'} onClick={() => onVariation({ kind: 'best', step: 0 })}>播放建議變化</button><button aria-pressed={variation?.kind === 'played'} onClick={() => onVariation({ kind: 'played', step: 0 })}>播放原走法</button></div>
      {variation && <div className="variation-player"><div className="variation-moves">{labels.map((san, i) => <button className={step === i + 1 ? 'selected-step' : ''} key={i} onClick={() => onVariation({ kind, step: i + 1 })}>{i + 1}. {san}</button>)}</div><div className="variation-controls"><button disabled={!step} aria-label="變化線上一步" onClick={() => onVariation({ kind, step: step - 1 })}><ChevronLeft size={16}/></button><span>{step} / {labels.length}</span><button aria-label="變化線下一步" disabled={step >= labels.length} onClick={() => onVariation({ kind, step: step + 1 })}><ChevronRight size={16}/></button><button onClick={() => onVariation(null)}>回到重走</button></div></div>}
      <small>這些是引擎預測的合法變化，對手也可能選擇其他走法。</small>
    </div>
  </div>;
}
