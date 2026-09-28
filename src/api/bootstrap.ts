import { getDbConfig, hasSavedDbConfig, setDbConfig, type DbConfig } from './dbConfig';
import { getOnestockConfig, setOnestockConfig } from './onestock';

/**
 * Connection of a new computer to the shared database, without typing anything:
 * 1. setup link (`?setup=…`, Settings → Database → "Copy the setup link"): API URL, API key and site ID;
 * 2. otherwise, when this browser has no database configuration yet: the database of the deployment (/api) is used
 *    when it answers without API key;
 * 3. the site ID is taken from the database when it knows a single site.
 * The OneStock options (and the token, when stored in the database) of the site are then loaded from the database.
 */
export interface SetupLink {
  apiUrl: string;
  apiKey?: string;
  siteId?: string;
}

const NOTICE_KEY = 'stock-allocation:connection-notice';
const TIMEOUT_MS = 4000;

export type ConnectionNotice = 'setup-applied' | 'auto-detected' | 'key-required';

/** Message to show once after the start (read and cleared). */
export function takeConnectionNotice(): ConnectionNotice | undefined {
  try {
    const v = sessionStorage.getItem(NOTICE_KEY) as ConnectionNotice | null;
    if (v && v !== 'key-required') sessionStorage.removeItem(NOTICE_KEY);
    return v ?? undefined;
  } catch {
    return undefined;
  }
}

export function dismissConnectionNotice() {
  try {
    sessionStorage.removeItem(NOTICE_KEY);
  } catch {
    /* ignore */
  }
}

function notice(n: ConnectionNotice) {
  try {
    sessionStorage.setItem(NOTICE_KEY, n);
  } catch {
    /* ignore */
  }
}

const toBase64Url = (s: string) => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromBase64Url = (s: string) => decodeURIComponent(escape(atob(s.replace(/-/g, '+').replace(/_/g, '/'))));

/** Link that configures another computer (contains the API key when given). */
export function setupLink(link: SetupLink): string {
  const url = new URL(import.meta.env.BASE_URL, window.location.origin);
  url.searchParams.set('setup', toBase64Url(JSON.stringify({ v: 1, ...link })));
  return url.toString();
}

function setSite(siteId: string) {
  const c = getOnestockConfig();
  if (c.siteId.trim() !== siteId) setOnestockConfig({ ...c, siteId });
}

async function health(config: DbConfig): Promise<{ status: number; body?: { configured?: boolean; schemaReady?: boolean; sites?: string[] } }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${config.apiUrl.replace(/\/+$/, '')}/health`, {
      headers: config.apiKey ? { 'x-api-key': config.apiKey } : {},
      signal: controller.signal,
    });
    const body = res.headers.get('content-type')?.includes('json') ? await res.json() : undefined;
    return { status: res.status, body };
  } catch {
    return { status: 0 };
  } finally {
    clearTimeout(timer);
  }
}

export async function bootstrapConnection(): Promise<void> {
  // 1. Setup link
  const params = new URLSearchParams(window.location.search);
  const setup = params.get('setup');
  if (setup) {
    try {
      const link = JSON.parse(fromBase64Url(setup)) as SetupLink;
      if (link.apiUrl) {
        setDbConfig({ mode: 'remote', apiUrl: link.apiUrl, apiKey: link.apiKey ?? '' });
        if (link.siteId) setSite(link.siteId);
        notice('setup-applied');
      }
    } catch {
      /* invalid link: ignored */
    }
    params.delete('setup');
    const rest = params.toString();
    window.history.replaceState(window.history.state, '', `${window.location.pathname}${rest ? `?${rest}` : ''}${window.location.hash}`);
  }

  // 2. Database of the deployment
  if (!hasSavedDbConfig()) {
    const candidate: DbConfig = { mode: 'remote', apiUrl: '/api', apiKey: '' };
    const h = await health(candidate);
    if (h.status === 200 && h.body?.configured && h.body.schemaReady) {
      setDbConfig(candidate);
      notice('auto-detected');
    } else if (h.status === 401) notice('key-required');
  }

  // 3. Site of the database
  const db = getDbConfig();
  if (db.mode === 'remote' && !getOnestockConfig().siteId.trim()) {
    const h = await health(db);
    const sites = h.body?.sites ?? [];
    if (sites.length === 1) setSite(sites[0]);
  }
}
