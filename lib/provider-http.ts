import { EnvHttpProxyAgent, fetch as proxyFetch } from 'undici';
let transport: EnvHttpProxyAgent | undefined;
export type Fetcher = typeof fetch;
export async function providerFetch(url: string, init: { method: string; headers: Record<string, string>; body?: string; signal: AbortSignal }, fetcher?: Fetcher) {
  return fetcher ? fetcher(url, init) : proxyFetch(url, { ...init, dispatcher: transport ??= new EnvHttpProxyAgent() });
}
