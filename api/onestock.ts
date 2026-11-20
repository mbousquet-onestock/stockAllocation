import { body, connectionString, ensureSchemaOnce, HttpError, route } from './_lib/db.js';
import { answerError, WRITE_PATHS } from './_lib/onestockHttp.js';
import { callOnestockApi, login, savedCredentials } from './_lib/onestockAuth.js';

/**
 * Proxy to the OneStock API: the browser cannot call it directly (CORS), so it sends { url, path, method, site_id }
 * here and this function performs the call server side, authenticated with the user / password saved in the database
 * for the site and environment (POST /login, see _lib/onestockAuth). The browser never sees a token.
 * Only the paths of ALLOWED_PATHS (_lib/onestockHttp) are allowed, so this is not an open proxy.
 *
 * path "/login" tests a login: with { user, password } (before saving them) or with the saved ones; no token is returned.
 */
const MAX_STOCK_RECORDS = 5000;
/** Extra body fields relayed with site_id / token. */
const ALLOWED_PARAMS = ['pagination', 'item_ids', 'request_name', 'item_filter', 'import', 'stocks'];

interface ProxyBody {
  url: string;
  path: string;
  method?: 'GET' | 'POST' | 'PATCH';
  site_id: string;
  /** Login test only. */
  user?: string;
  password?: string;
  /** Extra body fields (pagination, item_ids…). */
  params?: Record<string, unknown>;
}

export default route(
  {
    POST: async (req) => {
      const b = body<ProxyBody>(req);
      if (!b.url || !b.site_id) throw new HttpError(400, 'url and site_id are required');
      if (!connectionString()) throw new HttpError(400, 'The OneStock connection needs the database (user / password saved per site)');
      await ensureSchemaOnce();

      if (b.path === '/login') {
        const credentials = b.user && b.password ? { user: b.user, password: b.password } : await savedCredentials(b.site_id, b.url);
        if (!credentials) throw new HttpError(400, `No OneStock user / password for site ${b.site_id} on ${b.url}`);
        await login(b.site_id, b.url, credentials);
        return { data: { ok: true, user: credentials.user } };
      }

      const method = b.method === 'PATCH' ? 'PATCH' : b.method === 'POST' ? 'POST' : 'GET';
      if (method === 'PATCH' && !WRITE_PATHS.includes(b.path)) throw new HttpError(400, `PATCH not allowed on ${b.path}`);
      if (Array.isArray(b.params?.stocks) && b.params.stocks.length > MAX_STOCK_RECORDS)
        throw new HttpError(400, `At most ${MAX_STOCK_RECORDS} stock records per call`);
      const extra = Object.fromEntries(Object.entries(b.params ?? {}).filter(([k]) => ALLOWED_PARAMS.includes(k)));
      const result = await callOnestockApi(b.site_id, b.url, b.path, method, extra);
      if (result.status >= 400) throw new HttpError(502, answerError(result.status, result.data));
      return { data: result.data };
    },
  },
  { schema: false },
);
