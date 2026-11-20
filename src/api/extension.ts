import { getDbConfig } from './dbConfig';

/**
 * OneStock UI Extension (https://onestock.atlassian.net/wiki/spaces/DOCUMENTAT/pages/1691418644).
 * OneStock loads the application in an iframe: GET {url}{path}?extension_id, user_id, site_id, lang, timezone, locale,
 * parent_url, injection_point_path, host_app. The application then sends `extension_ready` to the parent window and
 * receives `onestock_data` (api_url = environment of the OneStock API, extension_signature…). The signature opens a
 * short session on the server (/api/extension-session), sent with every /api call.
 * The context (site, environment, user, language) therefore comes from OneStock, not from the settings.
 */
export interface ExtensionContext {
  extension_id: string;
  user_id: string;
  site_id: string;
  lang: string;
  timezone: string;
  locale: string;
  parent_url: string;
  injection_point_path: string;
  host_app: string;
  /** From the handshake: URL of the OneStock API of the environment. */
  api_url?: string;
}

interface OnestockData {
  api_url?: string;
  extension_signature?: string;
  [key: string]: unknown;
}

const CONTEXT_KEY = 'stock-allocation:extension-context';
const PARAMS = ['extension_id', 'user_id', 'site_id', 'lang', 'timezone', 'locale', 'parent_url', 'injection_point_path', 'host_app'] as const;
const HANDSHAKE_TIMEOUT_MS = 8000;

let context: ExtensionContext | undefined;
let session: { token: string; exp: number } | undefined;
let renewing: Promise<void> | undefined;

/**
 * Context of the call: URL parameters when OneStock loads the application (kept for the session of the tab, as the
 * navigation inside the application drops them), else the one kept for this tab. Undefined outside OneStock.
 */
export function readExtensionContext(): ExtensionContext | undefined {
  if (context) return context;
  const params = new URLSearchParams(window.location.search);
  if (params.get('extension_id') && params.get('site_id')) {
    context = Object.fromEntries(PARAMS.map((k) => [k, params.get(k) ?? ''])) as unknown as ExtensionContext;
    try {
      sessionStorage.setItem(CONTEXT_KEY, JSON.stringify(context));
    } catch {
      /* ignore */
    }
    // The parameters are not kept in the address (they stay in the context).
    PARAMS.forEach((k) => params.delete(k));
    const rest = params.toString();
    window.history.replaceState(window.history.state, '', `${window.location.pathname}${rest ? `?${rest}` : ''}${window.location.hash}`);
    return context;
  }
  try {
    const saved = sessionStorage.getItem(CONTEXT_KEY);
    if (saved) context = JSON.parse(saved) as ExtensionContext;
  } catch {
    /* ignore */
  }
  return context;
}

export const extensionContext = () => context;
export const inExtension = () => !!context;
/** A session was opened (it can then be renewed when it expires). */
export const hasSession = () => !!session;

/** Origin of the OneStock page that embeds the application (postMessage target and check). */
function parentOrigin(): string {
  try {
    return new URL(context!.parent_url).origin;
  } catch {
    throw new Error('parent_url missing or invalid in the extension context');
  }
}

/** extension_ready → onestock_data (only from the parent origin). */
function handshake(): Promise<OnestockData> {
  const origin = parentOrigin();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      window.removeEventListener('message', onMessage);
      reject(new Error('OneStock did not answer the extension handshake'));
    }, HANDSHAKE_TIMEOUT_MS);
    function onMessage(event: MessageEvent) {
      if (event.origin !== origin || event.data?.type !== 'onestock_data') return;
      clearTimeout(timer);
      window.removeEventListener('message', onMessage);
      resolve((event.data.data ?? {}) as OnestockData);
    }
    window.addEventListener('message', onMessage);
    window.parent.postMessage({ type: 'extension_ready' }, origin);
  });
}

/** Handshake, then session opened with the signature of OneStock. */
async function openSession() {
  const data = await handshake();
  if (data.api_url) context = { ...context!, api_url: String(data.api_url) };
  try {
    sessionStorage.setItem(CONTEXT_KEY, JSON.stringify(context));
  } catch {
    /* ignore */
  }
  const base = getDbConfig().apiUrl.replace(/\/+$/, '') || '/api';
  const res = await fetch(`${base}/extension-session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      extension_id: context!.extension_id,
      user_id: context!.user_id,
      site_id: context!.site_id,
      extension_signature: data.extension_signature,
    }),
  });
  const payload = (await res.json().catch(() => ({}))) as { token?: string; exp?: number; error?: string };
  if (!res.ok || !payload.token) throw new Error(payload.error ?? `Extension session refused (HTTP ${res.status})`);
  session = { token: payload.token, exp: payload.exp ?? 0 };
}

/** Opens (or renews) the session; concurrent calls share one handshake. */
export function renewSession(): Promise<void> {
  if (!context) return Promise.resolve();
  renewing ??= openSession().finally(() => (renewing = undefined));
  return renewing;
}

/** Authorization of the /api calls: the extension session, else the API key of Settings → Database. */
export function authHeaders(apiKey = getDbConfig().apiKey): Record<string, string> {
  if (session) return { Authorization: `Bearer ${session.token}` };
  return apiKey ? { 'x-api-key': apiKey } : {};
}

/** Reports the height of the content to the back office (extension_resize), so that the iframe fits it. */
export function startResizeReporting() {
  if (!context || context.host_app === 'store-app') return;
  const origin = parentOrigin();
  let last = 0;
  const report = () => {
    const height = Math.ceil(document.documentElement.scrollHeight);
    if (height > 0 && height !== last) {
      last = height;
      window.parent.postMessage({ type: 'extension_resize', height }, origin);
    }
  };
  new ResizeObserver(report).observe(document.body);
  report();
}
