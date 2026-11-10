export type Provider = 'openai' | 'gemini';
export const providers = {
  openai: { name: 'OpenAI', model: 'gpt-4.1-mini', keyUrl: 'https://platform.openai.com/api-keys' },
  gemini: { name: 'Google Gemini', model: 'gemini-3.8-flash', keyUrl: 'https://aistudio.google.com/api-keys' },
} as const;
export type ConnectionStatus = { available: boolean; source: 'personal' | 'site' | 'none'; provider: Provider | null; model: string | null; expiresAt: number | null };
export function isProvider(value: unknown): value is Provider { return value === 'openai' || value === 'gemini'; }
export function validModel(value: unknown, provider: Provider): value is string {
  return typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/.test(value) && (provider !== 'gemini' || value.startsWith('gemini-'));
}
