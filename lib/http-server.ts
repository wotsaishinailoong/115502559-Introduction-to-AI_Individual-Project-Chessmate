export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}
export const privateHeaders = { 'Cache-Control': 'no-store', Vary: 'Cookie' };
export function requestOrigin(request: Request) {
  const url = new URL(request.url);
  const forwarded = request.headers.get('x-forwarded-proto')?.split(',')[0].trim();
  const protocol = forwarded === 'https' || forwarded === 'http' ? `${forwarded}:` : url.protocol;
  return new URL(`${protocol}//${request.headers.get('host') ?? url.host}`).origin;
}
export function sameOrigin(request: Request) {
  try {
    const origin = request.headers.get('origin');
    if (origin === requestOrigin(request)) return true;
    // Codespaces may forward its public HTTPS hostname to an internal Host.
    // Only trust a hostname derived from server-owned Codespaces metadata.
    const name = process.env.CODESPACE_NAME;
    const domain = process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN ?? 'app.github.dev';
    if (name && /^[a-z0-9-]+$/.test(name) && /^[a-z0-9.-]+$/.test(domain)) {
      const port = new URL(request.url).port || process.env.PORT || '3000';
      if (/^\d{1,5}$/.test(port)) return origin === `https://${name}-${port}.${domain}`;
    }
    return false;
  } catch { return false; }
}
export function secureOrLocal(request: Request) {
  try { const url = new URL(request.headers.get('origin') ?? requestOrigin(request)); return url.protocol === 'https:' || ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname); } catch { return false; }
}
export async function readJson(request: Request, limit: number): Promise<unknown> {
  if (!request.headers.get('content-type')?.startsWith('application/json')) throw new HttpError(415, '請使用 JSON 格式。');
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, '缺少必要資料。');
  let bytes = 0; const chunks: Uint8Array[] = [];
  while (true) {
    const { value, done } = await reader.read(); if (done) break;
    bytes += value.byteLength;
    if (bytes > limit) { await reader.cancel(); throw new HttpError(413, '傳送的資料太長。'); }
    chunks.push(value);
  }
  const content = new Uint8Array(bytes); let offset = 0;
  for (const chunk of chunks) { content.set(chunk, offset); offset += chunk.length; }
  try { return JSON.parse(new TextDecoder().decode(content)); } catch { throw new HttpError(400, '資料格式不正確。'); }
}
