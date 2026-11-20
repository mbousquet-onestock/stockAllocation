import { body, HttpError, route, siteOf, sql } from './_lib/db.js';
import { encrypt } from './_lib/crypto.js';
import { envKey, forgetToken } from './_lib/onestockAuth.js';

/**
 * Settings shared by every user of a site (x-site-id header): stock types and OneStock options.
 * Secrets are kept in a separate column and never sent back:
 * - `secrets.onestockLogin`: OneStock user / password by environment (API URL) — the GET returns the users only;
 * - `secrets.onestockSession`: the token obtained with them (server side only).
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
  logins: Record<string, { user?: string }> | null;
}

const answer = (site: string, row: Row | undefined) => ({
  siteId: site,
  settings: row?.data ?? null,
  /** Environments with a saved OneStock login (users only, never the passwords). */
  logins: Object.entries(row?.logins ?? {}).map(([url, l]) => ({ url, user: l?.user ?? '' })),
  updatedAt: row?.updated_at.toISOString() ?? null,
});

interface LoginInput {
  url?: string;
  user?: string;
  /** Empty: keeps the saved password. */
  password?: string;
  /** Removes the login of this environment. */
  remove?: boolean;
}

export default route({
  GET: async (req) => {
    const site = siteOf(req);
    const [row] = await sql()<Row[]>`
      select data, updated_at, secrets->'onestockLogin' as logins from site_settings where site_id = ${site}`;
    return answer(site, row);
  },
  /**
   * Merges the given sections (e.g. { stockTypes: [...] } or { onestock: {...} }) into the site settings.
   * `secrets: { onestockLogin: { url, user, password } }` saves the OneStock login of an environment
   * (`password` empty keeps the saved one, `remove: true` deletes it).
   */
  PUT: async (req) => {
    const site = siteOf(req);
    const { secrets, ...rest } = body<Record<string, unknown>>(req);
    const patch = withoutSecrets(rest) as Record<string, unknown>;
    await sql()`
      insert into site_settings (site_id, data) values (${site}, ${sql().json(patch as never)})
      on conflict (site_id) do update set data = site_settings.data || excluded.data, updated_at = now()`;

    const loginInput = (secrets as { onestockLogin?: LoginInput } | undefined)?.onestockLogin;
    if (loginInput !== undefined) {
      if (!loginInput || typeof loginInput !== 'object' || !loginInput.url) throw new HttpError(400, 'secrets.onestockLogin needs the API url');
      const env = envKey(loginInput.url);
      forgetToken(site, loginInput.url);
      if (loginInput.remove) {
        await sql()`
          update site_settings set secrets = (secrets #- ${sql().array(['onestockLogin', env])}::text[]) #- ${sql().array(['onestockSession', env])}::text[]
          where site_id = ${site}`;
      } else {
        const user = String(loginInput.user ?? '').trim();
        if (!user) throw new HttpError(400, 'The OneStock user is required');
        const [current] = await sql()<{ password: string | null }[]>`
          select secrets->'onestockLogin'->${env}->>'password' as password from site_settings where site_id = ${site}`;
        // Password saved encrypted; an empty password keeps the saved (encrypted) one.
        const password = loginInput.password ? await encrypt(String(loginInput.password)) : current?.password || '';
        if (!password) throw new HttpError(400, 'The OneStock password is required');
        await sql()`
          update site_settings
          set secrets = jsonb_set(
                jsonb_set(secrets, '{onestockLogin}', coalesce(secrets->'onestockLogin', '{}'::jsonb)),
                ${sql().array(['onestockLogin', env])}::text[], ${sql().json({ user, password })}
              ) #- ${sql().array(['onestockSession', env])}::text[]
          where site_id = ${site}`;
      }
    }
    const [row] = await sql()<Row[]>`
      select data, updated_at, secrets->'onestockLogin' as logins from site_settings where site_id = ${site}`;
    return answer(site, row);
  },
});
