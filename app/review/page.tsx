'use client';
import dynamic from 'next/dynamic';
const Review = dynamic(() => import('./review'), { ssr: false, loading: () => <main className="loading">正在準備復盤教室…</main> });
export default function ReviewPage() { return <Review />; }
