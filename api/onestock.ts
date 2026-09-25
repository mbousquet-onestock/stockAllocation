import http from 'node:http';
import https from 'node:https';
import { body, HttpError, route } from './_lib/db.js';

/**
 * Proxy to the OneStock API: the browser cannot call it directly (CORS), so it sends
 * { url, path, method, site_id, token } here and this function performs the call server side.
 * Only the paths below are allowed, so this is not an open proxy.
 */
const ALLOWED_PATHS = ['/categories', '/endpoints', '/v3/items', '/stock_export', '/stock_import'];
/** Paths that may be written to (PATCH). */
const WRITE_PATHS = ['/stock_import'];
const MAX_STOCK_RECORDS = 5000;
/** Extra body fields relayed with site_id / token. */
const ALLOWED_PARAMS = ['pagination', 'item_ids', 'request_name', 'item_filter', 'import', 'stocks'];
const TIMEOUT_MS = 15000;

interface ProxyBody {
  url: string;
  path: string;
  method?: 'GET' | 'POST' | 'PATCH';
  site_id: string;
  token: string;
  /** Extra body fields (pagination, item_ids…). */
  params?: Record<string, unknown>;
}

function target(b: ProxyBody): URL {
  if (!ALLOWED_PATHS.includes(b.path)) throw new HttpError(400, `Path not allowed: ${b.path}`);
  let base: URL;
  try {
    base = new URL(b.url);
  } catch {
    throw new HttpError(400, `Invalid API URL: ${b.url}`);
  }
  const local = ['localhost', '127.0.0.1'].includes(base.hostname);
  if (base.protocol !== 'https:' && !(local && base.protocol === 'http:')) throw new HttpError(400, 'The API URL must use https');
  return new URL(base.pathname.replace(/\/+$/, '') + b.path, base);
}

/** JSON call; GET requests may carry a body (the OneStock API expects site_id / token in the body). */
function call(url: URL, method: string, payload: unknown): Promise<{ status: number; data: unknown }> {
  const data = JSON.stringify(payload);
  const lib = url.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    const req = lib.request(
      url,
      {
        method,
        headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'Content-Length': Buffer.byteLength(data) },
        timeout: TIMEOUT_MS,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString();
          let parsed: unknown = text;
          try {
            parsed = text ? JSON.parse(text) : null;
          } catch {
            /* keep text */
          }
          resolve({ status: res.statusCode ?? 502, data: parsed });
        });
      },
    );
    req.on('timeout', () => req.destroy(new Error(`No answer from ${url.host} after ${TIMEOUT_MS / 1000}s`)));
    req.on('error', reject);
    req.end(data);
  });
}

export default route({
  POST: async (req) => {
    const b = body<ProxyBody>(req);
    if (!b.url || !b.site_id || !b.token) throw new HttpError(400, 'url, site_id and token are required');
    const url = target(b);
    const method = b.method === 'PATCH' ? 'PATCH' : b.method === 'POST' ? 'POST' : 'GET';
    if (method === 'PATCH' && !WRITE_PATHS.includes(b.path)) throw new HttpError(400, `PATCH not allowed on ${b.path}`);
    if (Array.isArray(b.params?.stocks) && b.params.stocks.length > MAX_STOCK_RECORDS)
      throw new HttpError(400, `At most ${MAX_STOCK_RECORDS} stock records per call`);
    let result: { status: number; data: unknown };
    try {
      const extra = Object.fromEntries(Object.entries(b.params ?? {}).filter(([k]) => ALLOWED_PARAMS.includes(k)));
      result = await call(url, method, { site_id: b.site_id, token: b.token, ...extra });
    } catch (e) {
      throw new HttpError(502, `OneStock API unreachable: ${(e as Error).message}`);
    }
    if (result.status >= 400) {
      const detail = typeof result.data === 'string' ? result.data.slice(0, 300) : JSON.stringify(result.data).slice(0, 300);
      throw new HttpError(502, `OneStock API answered HTTP ${result.status}: ${detail}`);
    }
    return { data: result.data };
  },
});
