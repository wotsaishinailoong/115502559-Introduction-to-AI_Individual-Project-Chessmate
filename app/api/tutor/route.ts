import { tutorReply } from '../../../lib/tutor-server.ts';
import { validateEvidence } from '../../../lib/teaching.ts';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'no-store' };
export function GET() { return Response.json({ available: !!process.env.TUTOR_API_KEY }, { headers }); }

export async function POST(request: Request) {
  // Next may normalize request.url to its internal hostname. Match the incoming
  // Host instead, without trusting an arbitrary forwarded-host header.
  let sameOrigin = false;
  try {
    const url = new URL(request.url);
    const expected = new URL(`${url.protocol}//${request.headers.get('host') ?? url.host}`).origin;
    sameOrigin = request.headers.get('origin') === expected;
  } catch { /* Invalid authority is rejected below. */ }
  if (!sameOrigin) return Response.json({ error: '請從本站開啟 AI 教學。' }, { status: 403, headers });
  if (!request.headers.get('content-type')?.startsWith('application/json')) return Response.json({ error: '請使用 JSON 教學資料。' }, { status: 415, headers });
  const reader = request.body?.getReader();
  if (!reader) return Response.json({ error: '缺少教學資料。' }, { status: 400, headers });
  let evidence;
  try {
    let bytes = 0; const chunks: Uint8Array[] = [];
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 12000) { await reader.cancel(); return Response.json({ error: '教學資料太長。' }, { status: 413, headers }); }
      chunks.push(value);
    }
    const content = new Uint8Array(bytes); let offset = 0;
    for (const chunk of chunks) { content.set(chunk, offset); offset += chunk.length; }
    evidence = validateEvidence(JSON.parse(new TextDecoder().decode(content)));
  } catch { return Response.json({ error: '局面、走法或分析資料不正確，請重新分析棋局。' }, { status: 400, headers }); }
  const result = await tutorReply(evidence, { key: process.env.TUTOR_API_KEY, model: process.env.TUTOR_MODEL, signal: request.signal });
  return Response.json(result, { headers });
}
