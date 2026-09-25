import { body, HttpError, route, siteOf, sql } from './_lib/db.js';

/**
 * Settings shared by every user of a site (x-site-id header): stock types and OneStock options.
 * Secrets (token, API key) are never stored here.
 */
const SECRET_KEYS = /token|api_?key|password|secret/i;

function withoutSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutSecrets);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).filter(([k]) => !SECRET_KEYS.test(k)).map(([k, v]) => [k, withoutSecrets(v)]),
    );
  return value;
}

export default route({
  GET: async (req) => {
    const site = siteOf(req);
    if (!site) throw new HttpError(400, 'x-site-id header is required');
    const [row] = await sql()<{ data: Record<string, unknown>; updated_at: Date }[]>`
      select data, updated_at from site_settings where site_id = ${site}`;
    return { siteId: site, settings: row?.data ?? null, updatedAt: row?.updated_at.toISOString() ?? null };
  },
  /** Merges the given sections (e.g. { stockTypes: [...] } or { onestock: {...} }) into the site settings. */
  PUT: async (req) => {
    const site = siteOf(req);
    if (!site) throw new HttpError(400, 'x-site-id header is required');
    const patch = withoutSecrets(body<Record<string, unknown>>(req)) as Record<string, unknown>;
    const [row] = await sql()<{ data: Record<string, unknown>; updated_at: Date }[]>`
      insert into site_settings (site_id, data) values (${site}, ${sql().json(patch as never)})
      on conflict (site_id) do update set data = site_settings.data || excluded.data, updated_at = now()
      returning data, updated_at`;
    return { siteId: site, settings: row.data, updatedAt: row.updated_at.toISOString() };
  },
});
