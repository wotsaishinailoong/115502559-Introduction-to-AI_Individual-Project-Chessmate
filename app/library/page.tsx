'use client';
import dynamic from 'next/dynamic';
const Library = dynamic(() => import('./library-view'), { ssr: false, loading: () => <main className="loading">正在讀取複習紀錄…</main> });
export default function LibraryPage() { return <Library />; }
