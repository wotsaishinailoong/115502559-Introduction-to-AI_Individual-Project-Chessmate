import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = { title: '棋伴 Chessmate｜每一步，都是進步', description: '與 AI 練棋，在每一局發現進步的機會。' };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-Hant"><body>{children}</body></html>;
}
