import { body, connectionString, ensureSchemaOnce, HttpError, route, siteToken } from './_lib/db.js';
import { answerError, callJson, onestockUrl, WRITE_PATHS } from './_lib/onestockHttp.js';

/**
 * Proxy to the OneStock API: the browser cannot call it directly (CORS), so it sends
 * { url, path, method, site_id, token } here and this function performs the call server side.
 * Only the paths of ALLOWED_PATHS (_lib/onestockHttp) are allowed, so this is not an open proxy.
 */
const MAX_STOCK_RECORDS = 5000;
/** Extra body fields relayed with site_id / token. */
const ALLOWED_PARAMS = ['pagination', 'item_ids', 'request_name', 'item_filter', 'import', 'stocks'];

interface ProxyBody {
  url: string;
  path: string;
  method?: 'GET' | 'POST' | 'PATCH';
  site_id: string;
  token?: string;
  /** Extra body fields (pagination, item_ids…). */
  params?: Record<string, unknown>;
}

export default route({
  POST: async (req) => {
    const b = body<ProxyBody>(req);
    if (!b.url || !b.site_id) throw new HttpError(400, 'url and site_id are required');
    // No token from the browser: use the one stored in the database for the site.
    let token: string | undefined = b.token;
    if (!token) {
      if (!connectionString()) throw new HttpError(400, 'token is required (no database to read the stored token from)');
      await ensureSchemaOnce();
      token = await siteToken(b.site_id);
      if (!token) throw new HttpError(400, `No OneStock token given nor stored in the database for site ${b.site_id}`);
    }
    const url = onestockUrl(b.url, b.path);
    const method = b.method === 'PATCH' ? 'PATCH' : b.method === 'POST' ? 'POST' : 'GET';
    if (method === 'PATCH' && !WRITE_PATHS.includes(b.path)) throw new HttpError(400, `PATCH not allowed on ${b.path}`);
    if (Array.isArray(b.params?.stocks) && b.params.stocks.length > MAX_STOCK_RECORDS)
      throw new HttpError(400, `At most ${MAX_STOCK_RECORDS} stock records per call`);
    let result: { status: number; data: unknown };
    try {
      const extra = Object.fromEntries(Object.entries(b.params ?? {}).filter(([k]) => ALLOWED_PARAMS.includes(k)));
      result = await callJson(url, method, { site_id: b.site_id, token, ...extra });
    } catch (e) {
      throw new HttpError(502, `OneStock API unreachable: ${(e as Error).message}`);
    }
    if (result.status >= 400) throw new HttpError(502, answerError(result.status, result.data));
    return { data: result.data };
  },
}, { schema: false });
