import type { SegmentationRule, StockType } from '../types';
import { logApiCall } from './apiLog';
import { getDbConfig, type DbConfig } from './dbConfig';
import { siteHeader } from './site';

export interface SiteSettings {
  stockTypes?: StockType[];
  onestock?: Record<string, unknown>;
  /** Write only: secrets of the site ('' removes). Never sent back, see `hasToken`. */
  secrets?: { onestockToken?: string };
}

export interface DbHealth {
  siteId?: string;
  /** Sites known by the database. */
  sites?: string[];
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

/** Alert threshold of a group of a stock line (null = no threshold). */
export interface ThresholdEntry {
  item_id: string;
  endpoint_id: string;
  /** Id of the group stock type. */
  stock_type: string;
  purchase_order: string | null;
  threshold: number | null;
}

/** Answer of POST /api/stock-import. */
export interface StockImportAnswer {
  site_id: string;
  mode: 'import' | 'items' | 'catalog';
  dry_run: boolean;
  /** Import mode: quantities read as variations (true) or as the new stock (false). */
  incremental?: boolean;
  items_scanned?: number;
  items_matched: number;
  lines: number;
  changed: number;
  blocked: number;
  unchanged: number;
  without_rule: number;
  records_sent: number;
  stock_import_calls: number;
  next_cursor?: unknown[] | null;
  duration_ms: number;
  errors: string[];
  changes: Array<{
    item_id: string;
    endpoint_id: string;
    stock_type: string;
    purchase_order_number: string | null;
    rule: string | null;
    before: Record<string, number>;
    after: Record<string, number>;
    blocked?: string;
  }>;
  records: unknown[];
}

/** HTTP client of the rule endpoints (Vercel functions in /api). */
async function call<T>(path: string, init: RequestInit = {}, config: DbConfig = getDbConfig()): Promise<T> {
  const base = config.apiUrl.replace(/\/+$/, '');
  const started = performance.now();
  const method = init.method ?? 'GET';
  let request: unknown;
  try {
    request = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
  } catch {
    request = init.body;
  }
  const log = (entry: { ok: boolean; status?: number; response?: unknown; error?: string }) =>
    logApiCall({ at: Date.now(), target: 'Database', method, path: `${base}${path}`, request, durationMs: Math.round(performance.now() - started), ...entry });
  let res: Response;
  try {
    res = await fetch(`${base}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        ...(config.apiKey ? { 'x-api-key': config.apiKey } : {}),
        ...siteHeader(),
        ...init.headers,
      },
    });
  } catch {
    const error = `Database API unreachable (${base})`;
    log({ ok: false, error });
    throw new Error(error);
  }
  const text = await res.text();
  let payload: unknown;
  try {
    payload = text ? JSON.parse(text) : undefined;
  } catch {
    const error = `Unexpected answer from ${base}${path} (HTTP ${res.status}): is the API deployed?`;
    log({ ok: false, status: res.status, error, response: text.slice(0, 2000) });
    throw new Error(error);
  }
  if (!res.ok) {
    const error = (payload as { error?: string })?.error ?? `HTTP ${res.status}`;
    log({ ok: false, status: res.status, error, response: payload });
    throw new Error(error);
  }
  log({ ok: true, status: res.status, response: payload });
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
  /** Settings shared by the users of the site (stock types, OneStock options — no secrets). */
  getSiteSettings: () => call<{ siteId: string; settings: SiteSettings | null; hasToken: boolean; updatedAt: string | null }>('/settings'),
  /** Alert thresholds of the stock lines of these items (api/thresholds). */
  getThresholds: (itemIds: string[]) =>
    call<{ thresholds: ThresholdEntry[] }>(`/thresholds?item_ids=${encodeURIComponent(itemIds.join(','))}`),
  allThresholds: () => call<{ thresholds: ThresholdEntry[] }>('/thresholds?all=1'),
  saveThresholds: (thresholds: ThresholdEntry[]) => call<{ ok: boolean; saved: number }>('/thresholds', json('PUT', { thresholds })),
  /** Server side stock import with the segmentation rules (api/stock-import). */
  stockImport: (body: Record<string, unknown>) => call<StockImportAnswer>('/stock-import', json('POST', body)),
  saveSiteSettings: (patch: SiteSettings) => call<{ siteId: string; settings: SiteSettings }>('/settings', json('PUT', patch)),
};
