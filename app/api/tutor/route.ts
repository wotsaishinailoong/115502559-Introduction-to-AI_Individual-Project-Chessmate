import { tutorReply } from '../../../lib/tutor-server.ts';
import { validateEvidence } from '../../../lib/teaching.ts';
import { HttpError, privateHeaders, readJson, sameOrigin } from '../../../lib/http-server.ts';
import { resolveCredential } from '../../../lib/tutor-sessions.ts';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export function GET(request?: Request) { return Response.json({ available: !!resolveCredential(request).credential }, { headers: privateHeaders }); }
export async function POST(request: Request) {
  if (!sameOrigin(request)) return Response.json({ error: '請從本站開啟 AI 教學。' }, { status: 403, headers: privateHeaders });
  let evidence;
  try { evidence = validateEvidence(await readJson(request, 12000)); }
  catch (e) { return Response.json({ error: e instanceof HttpError ? e.message : '局面、走法或分析資料不正確，請重新分析棋局。' }, { status: e instanceof HttpError ? e.status : 400, headers: privateHeaders }); }
  const current = resolveCredential(request).credential;
  const result = await tutorReply(evidence, { ...current, signal: request.signal });
  return Response.json(result, { headers: privateHeaders });
}
