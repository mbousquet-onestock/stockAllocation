import { body, HttpError, route, siteOf, sql } from './_lib/db.js';

/**
 * Settings shared by every user of a site (x-site-id header): stock types and OneStock options.
 * Secrets (OneStock token) are kept in a separate column: they can be written (`secrets`) but are
 * never sent back, the GET only says whether a token is stored (`hasToken`).
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

interface Row {
  data: Record<string, unknown>;
  updated_at: Date;
  has_token: boolean;
}

const answer = (site: string, row: Row | undefined) => ({
  siteId: site,
  settings: row?.data ?? null,
  hasToken: Boolean(row?.has_token),
  updatedAt: row?.updated_at.toISOString() ?? null,
});

export default route({
  GET: async (req) => {
    const site = siteOf(req);
    const [row] = await sql()<Row[]>`
      select data, updated_at, coalesce(secrets->>'onestockToken', '') <> '' as has_token
      from site_settings where site_id = ${site}`;
    return answer(site, row);
  },
  /**
   * Merges the given sections (e.g. { stockTypes: [...] } or { onestock: {...} }) into the site settings.
   * `secrets: { onestockToken }` stores the token ('' or null removes it).
   */
  PUT: async (req) => {
    const site = siteOf(req);
    const { secrets, ...rest } = body<Record<string, unknown>>(req);
    const patch = withoutSecrets(rest) as Record<string, unknown>;
    let secretPatch: Record<string, string> = {};
    let secretRemove: string[] = [];
    if (secrets !== undefined) {
      if (!secrets || typeof secrets !== 'object') throw new HttpError(400, 'secrets must be an object');
      const token = (secrets as Record<string, unknown>).onestockToken;
      if (token !== undefined) {
        if (token === null || token === '') secretRemove = ['onestockToken'];
        else if (typeof token === 'string') secretPatch = { onestockToken: token.trim() };
        else throw new HttpError(400, 'secrets.onestockToken must be a string');
      }
    }
    const [row] = await sql()<Row[]>`
      insert into site_settings (site_id, data, secrets)
      values (${site}, ${sql().json(patch as never)}, ${sql().json(secretPatch)})
      on conflict (site_id) do update set
        data = site_settings.data || excluded.data,
        secrets = (site_settings.secrets || excluded.secrets) - ${secretRemove}::text[],
        updated_at = now()
      returning data, updated_at, coalesce(secrets->>'onestockToken', '') <> '' as has_token`;
    return answer(site, row);
  },
});
