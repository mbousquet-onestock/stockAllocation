/**
 * Journal of the API calls made by the application (OneStock through the proxy, Vercel database),
 * shown in Settings → API calls. Kept in memory and in the browser (last MAX_ENTRIES calls).
 */
export interface ApiLogEntry {
  id: number;
  at: number; // ms
  target: 'OneStock' | 'Database';
  method: string;
  path: string;
  /** Request body, secrets masked. */
  request?: unknown;
  status?: number;
  ok: boolean;
  durationMs: number;
  /** Response (possibly truncated), or error message. */
  response?: unknown;
  error?: string;
  /** Short description of the result (e.g. "25 items"). */
  summary?: string;
  truncated?: boolean;
}

const KEY = 'stock-allocation:api-log';
const MAX_ENTRIES = 300;
const MAX_RESPONSE_CHARS = 30000;

let entries: ApiLogEntry[] = load();
let nextId = entries.reduce((m, e) => Math.max(m, e.id), 0) + 1;
const listeners = new Set<() => void>();

function load(): ApiLogEntry[] {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as ApiLogEntry[]) : [];
  } catch {
    return [];
  }
}

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(entries));
  } catch {
    // Quota exceeded: keep fewer entries.
    entries = entries.slice(0, Math.floor(entries.length / 2));
    try {
      localStorage.setItem(KEY, JSON.stringify(entries));
    } catch {
      /* ignore */
    }
  }
}

const emit = () => listeners.forEach((l) => l());

export const getApiLog = () => entries;
export function subscribeApiLog(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
export function clearApiLog() {
  entries = [];
  save();
  emit();
}

/** Masks secrets (token, api key) in a request body. */
export function maskSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(maskSecrets);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) =>
        /token|api_?key|password|secret/i.test(k) && typeof v === 'string' && v ? [k, `${v.slice(0, 3)}••••`] : [k, maskSecrets(v)],
      ),
    );
  return value;
}

/** Short description of an answer: array lengths of the main keys. */
function summarize(response: unknown): string | undefined {
  if (Array.isArray(response)) return `${response.length} entries`;
  if (!response || typeof response !== 'object') return undefined;
  const parts = Object.entries(response as Record<string, unknown>)
    .filter(([, v]) => Array.isArray(v))
    .map(([k, v]) => `${(v as unknown[]).length} ${k}`);
  if ((response as { category?: { sub_category?: unknown[] } }).category?.sub_category)
    parts.push(`${(response as { category: { sub_category: unknown[] } }).category.sub_category.length} categories`);
  return parts.join(', ') || undefined;
}

function limit(response: unknown): { value: unknown; truncated: boolean } {
  let text: string;
  try {
    text = JSON.stringify(response);
  } catch {
    return { value: String(response), truncated: false };
  }
  if (text === undefined || text.length <= MAX_RESPONSE_CHARS) return { value: response, truncated: false };
  return { value: `${text.slice(0, MAX_RESPONSE_CHARS)}…`, truncated: true };
}

export function logApiCall(entry: Omit<ApiLogEntry, 'id' | 'summary' | 'truncated'>) {
  const { value, truncated } = limit(entry.response);
  entries = [
    { ...entry, id: nextId++, request: maskSecrets(entry.request), response: value, truncated, summary: entry.ok ? summarize(entry.response) : undefined },
    ...entries,
  ].slice(0, MAX_ENTRIES);
  save();
  emit();
}
