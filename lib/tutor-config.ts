export type Provider = 'openai' | 'gemini' | 'claude';
export const TUTOR_SERVER_TIMEOUT_MS = 90_000;
export const TUTOR_CLIENT_TIMEOUT_MS = TUTOR_SERVER_TIMEOUT_MS + 10_000;
export const providers = {
  openai: { name: 'OpenAI', model: 'gpt-4.1-mini', keyUrl: 'https://platform.openai.com/api-keys' },
  gemini: { name: 'Google Gemini', model: 'gemini-3.8-flash', keyUrl: 'https://aistudio.google.com/api-keys' },
  claude: { name: 'Claude', model: 'claude-haiku-4-5', keyUrl: 'https://platform.claude.com/settings/keys' },
} as const;
export type ConnectionStatus = { available: boolean; source: 'personal' | 'site' | 'none'; provider: Provider | null; model: string | null; expiresAt: number | null };
export function isProvider(value: unknown): value is Provider { return value === 'openai' || value === 'gemini' || value === 'claude'; }
export function validModel(value: unknown, provider: Provider): value is string {
  return typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/.test(value) && (provider !== 'gemini' || value.startsWith('gemini-')) && (provider !== 'claude' || value.startsWith('claude-'));
}
