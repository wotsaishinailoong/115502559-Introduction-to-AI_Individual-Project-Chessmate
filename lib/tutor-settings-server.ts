import { HttpError, privateHeaders, readJson, requestOrigin, sameOrigin, secureOrLocal } from './http-server.ts';
import { credentialFromInput, verifyCredential } from './tutor-provider.ts';
import { connectionStatus, SESSION_COOKIE, SESSION_TTL, sessionToken, siteCredential, tutorSessions, type Credential, type TutorSessions } from './tutor-sessions.ts';

type Dependencies = { sessions?: TutorSessions; verify?: typeof verifyCredential; site?: () => Credential | null };
export function settingsHandlers(deps: Dependencies = {}) {
  const sessions = deps.sessions ?? tutorSessions, verify = deps.verify ?? verifyCredential, site = deps.site ?? siteCredential;
  let checking = 0, used = 0, resetAt = 0;
  function cookie(request: Request, token: string, age: number) {
    return `${SESSION_COOKIE}=${token}; Path=/api/tutor; HttpOnly; SameSite=Strict; Max-Age=${age}${new URL(request.headers.get('origin') ?? requestOrigin(request)).protocol === 'https:' ? '; Secure' : ''}`;
  }
  return {
    GET(request: Request) { return Response.json(connectionStatus(request, sessions, site()), { headers: privateHeaders }); },
    async POST(request: Request) {
      if (!sameOrigin(request)) return Response.json({ error: '請從本站開啟 AI 設定。' }, { status: 403, headers: privateHeaders });
      if (!secureOrLocal(request)) return Response.json({ error: '金鑰設定需要 HTTPS 連線，或使用 localhost 開發。' }, { status: 400, headers: privateHeaders });
      if (Date.now() >= resetAt) { used = 0; resetAt = Date.now() + 10 * 60 * 1000; }
      if (checking >= 2 || used >= 30) return Response.json({ error: '連線測試次數較多，請稍後再試。' }, { status: 429, headers: privateHeaders });
      let credential: Credential;
      try { credential = credentialFromInput(await readJson(request, 2048)); }
      catch (e) { return Response.json({ error: e instanceof HttpError ? e.message : '資料格式不正確。' }, { status: e instanceof HttpError ? e.status : 400, headers: privateHeaders }); }
      checking++; used++;
      try {
        await verify(credential, undefined, request.signal);
        if (request.signal.aborted) throw new HttpError(400, '連線測試已取消。');
        const created = sessions.create(credential); sessions.remove(sessionToken(request));
        const status = { available: true, source: 'personal', provider: credential.provider, model: credential.model, expiresAt: created.expiresAt };
        return Response.json(status, { headers: { ...privateHeaders, 'Set-Cookie': cookie(request, created.token, SESSION_TTL / 1000) } });
      } catch (e) { return Response.json({ error: e instanceof HttpError ? e.message : '無法儲存連線，請稍後重試；原有連線未變更。' }, { status: e instanceof HttpError ? e.status : 503, headers: privateHeaders }); }
      finally { checking--; }
    },
    DELETE(request: Request) {
      if (!sameOrigin(request)) return Response.json({ error: '請從本站移除連線。' }, { status: 403, headers: privateHeaders });
      sessions.remove(sessionToken(request));
      return Response.json(connectionStatus(undefined, sessions, site()), { headers: { ...privateHeaders, 'Set-Cookie': cookie(request, '', 0) } });
    },
  };
}
