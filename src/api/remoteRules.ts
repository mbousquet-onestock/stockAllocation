import type { SegmentationRule } from '../types';
import { getDbConfig, type DbConfig } from './dbConfig';

export interface DbHealth {
  ok: boolean;
  configured: boolean;
  error?: string;
  host?: string;
  database?: string;
  version?: string;
  schemaReady?: boolean;
  ruleCount?: number;
  apiKeyRequired?: boolean;
}

/** HTTP client of the rule endpoints (Vercel functions in /api). */
async function call<T>(path: string, init: RequestInit = {}, config: DbConfig = getDbConfig()): Promise<T> {
  const base = config.apiUrl.replace(/\/+$/, '');
  let res: Response;
  try {
    res = await fetch(`${base}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(config.apiKey ? { 'x-api-key': config.apiKey } : {}),
        ...init.headers,
      },
    });
  } catch {
    throw new Error(`Database API unreachable (${base})`);
  }
  const text = await res.text();
  let payload: unknown;
  try {
    payload = text ? JSON.parse(text) : undefined;
  } catch {
    throw new Error(`Unexpected answer from ${base}${path} (HTTP ${res.status}): is the API deployed?`);
  }
  if (!res.ok) throw new Error((payload as { error?: string })?.error ?? `HTTP ${res.status}`);
  return payload as T;
}

const json = (method: string, body: unknown): RequestInit => ({ method, body: JSON.stringify(body) });

export const remoteRules = {
  health: (config?: DbConfig) => call<DbHealth>('/health', {}, config),
  setup: (config?: DbConfig) => call<{ ok: boolean }>('/setup', { method: 'POST' }, config),
  list: () => call<SegmentationRule[]>('/rules'),
  create: (rule: Omit<SegmentationRule, 'id' | 'priority' | 'updatedAt'>) => call<SegmentationRule>('/rules', json('POST', rule)),
  update: (id: string, rule: Partial<SegmentationRule>) => call<SegmentationRule>(`/rules/${encodeURIComponent(id)}`, json('PUT', rule)),
  remove: (id: string) => call<{ ok: boolean }>(`/rules/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  reorder: (order: string[]) => call<SegmentationRule[]>('/rules', json('PUT', { order })),
  replaceAll: (rules: SegmentationRule[], config?: DbConfig) => call<SegmentationRule[]>('/rules', json('PUT', { rules }), config),
};
