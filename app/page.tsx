'use client';
import dynamic from 'next/dynamic';
const ChessApp = dynamic(() => import('./chess-app'), { ssr: false, loading: () => <main className="loading">棋伴正在準備棋盤…</main> });
export default function Home() { return <ChessApp />; }
