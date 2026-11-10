import { randomBytes } from 'node:crypto';
import { isProvider, providers, validModel, type ConnectionStatus, type Provider } from './tutor-config.ts';

export const SESSION_COOKIE = 'chessmate_tutor_session';
export const SESSION_TTL = 60 * 60 * 1000;
export type Credential = { key: string; provider: Provider; model: string };
type Session = Credential & { expiresAt: number; timer: ReturnType<typeof setTimeout> };
export class TutorSessions {
  private sessions = new Map<string, Session>();
  private now: () => number;
  constructor(now: () => number = Date.now) { this.now = now; }
  create(credential: Credential) {
    for (const token of this.sessions.keys()) this.get(token);
    if (this.sessions.size >= 100) throw new Error('目前暫存連線已滿，請稍後再試。');
    const token = randomBytes(32).toString('base64url'); const expiresAt = this.now() + SESSION_TTL;
    const timer = setTimeout(() => this.remove(token), SESSION_TTL); timer.unref?.();
    this.sessions.set(token, { ...credential, expiresAt, timer });
    return { token, expiresAt };
  }
  get(token: string | null) {
    const session = token ? this.sessions.get(token) : undefined;
    if (!session) return null;
    if (session.expiresAt <= this.now()) { this.remove(token!); return null; }
    return { key: session.key, provider: session.provider, model: session.model, expiresAt: session.expiresAt };
  }
  remove(token: string | null) {
    const session = token ? this.sessions.get(token) : undefined;
    if (session) { clearTimeout(session.timer); this.sessions.delete(token!); }
  }
}
// Share across Next route bundles in the same Node process. Never serialized or persisted.
const registry = globalThis as typeof globalThis & { __chessmateTutorSessions?: TutorSessions };
export const tutorSessions = registry.__chessmateTutorSessions ??= new TutorSessions();
export function sessionToken(request?: Request) {
  const value = request?.headers.get('cookie')?.split(';').map(v => v.trim()).find(v => v.startsWith(`${SESSION_COOKIE}=`))?.slice(SESSION_COOKIE.length + 1);
  return value && /^[A-Za-z0-9_-]{43}$/.test(value) ? value : null;
}
export function siteCredential(): Credential | null {
  if (!process.env.TUTOR_API_KEY) return null;
  const provider = process.env.TUTOR_PROVIDER ?? 'openai';
  if (!isProvider(provider)) return null;
  const model = process.env.TUTOR_MODEL || providers[provider].model;
  return validModel(model, provider) ? { key: process.env.TUTOR_API_KEY, provider, model } : null;
}
export function resolveCredential(request?: Request, sessions = tutorSessions, site: Credential | null = siteCredential()) {
  const personal = sessions.get(sessionToken(request));
  return personal ? { credential: personal as Credential, source: 'personal' as const, expiresAt: personal.expiresAt }
    : site ? { credential: site, source: 'site' as const, expiresAt: null } : { credential: null, source: 'none' as const, expiresAt: null };
}
export function connectionStatus(request?: Request, sessions = tutorSessions, site: Credential | null = siteCredential()): ConnectionStatus {
  const current = resolveCredential(request, sessions, site);
  return { available: !!current.credential, source: current.source, provider: current.credential?.provider ?? null, model: current.credential?.model ?? null, expiresAt: current.expiresAt };
}
