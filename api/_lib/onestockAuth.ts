import { decrypt } from './crypto.js';
import { HttpError, sql } from './db.js';
import { answerError, callJson, onestockUrl } from './onestockHttp.js';

/**
 * OneStock authentication: the only way to reach the OneStock API.
 * The user / password of a context (site ID × environment, i.e. API URL) are saved in the database
 * (site_settings.secrets.onestockLogin, password encrypted, never sent back to the browser). A token is obtained with POST {{url}}/login,
 * kept in memory and in the database (secrets.onestockSession), and renewed when OneStock refuses it.
 */

export interface Credentials {
  user: string;
  password: string;
}

/** Key of an environment: the API URL, without trailing slash, lower case. */
export const envKey = (apiUrl: string) => apiUrl.trim().replace(/\/+$/, '').toLowerCase();

const memory = new Map<string, { token: string; at: number }>();
const memoryKey = (site: string, apiUrl: string) => `${site}|${envKey(apiUrl)}`;
/** A token older than this is renewed before use (OneStock also answers 401 when it expires). */
const TOKEN_MAX_AGE_MS = 50 * 60 * 1000;

/** User / password saved for the site and environment. */
export async function savedCredentials(site: string, apiUrl: string): Promise<Credentials | undefined> {
  const [row] = await sql()<{ login: { user?: string; password?: string } | null }[]>`
    select secrets->'onestockLogin'->${envKey(apiUrl)} as login from site_settings where site_id = ${site}`;
  const login = row?.login;
  // The password is saved encrypted (see crypto.ts).
  return login?.user && login.password ? { user: login.user, password: await decrypt(login.password) } : undefined;
}

/** POST {{url}}/login → token. */
export async function login(site: string, apiUrl: string, credentials: Credentials): Promise<string> {
  let result: { status: number; data: unknown };
  try {
    result = await callJson(onestockUrl(apiUrl, '/login'), 'POST', { site_id: site, user_id: credentials.user, password: credentials.password });
  } catch (e) {
    throw new HttpError(502, `OneStock API unreachable: ${(e as Error).message}`);
  }
  if (result.status >= 400) throw new HttpError(502, `OneStock login refused — ${answerError(result.status, result.data)}`);
  const d = result.data as { token?: string; access_token?: string; data?: { token?: string } } | null;
  const token = d?.token ?? d?.access_token ?? d?.data?.token;
  if (!token || typeof token !== 'string') throw new HttpError(502, 'OneStock login answered without token');
  return token;
}

/** Token of the site and environment: memory, then database, then a new login with the saved user / password. */
export async function siteToken(site: string, apiUrl: string, renew = false): Promise<string> {
  const key = memoryKey(site, apiUrl);
  const now = Date.now();
  if (!renew) {
    const cached = memory.get(key);
    if (cached && now - cached.at < TOKEN_MAX_AGE_MS) return cached.token;
    const [row] = await sql()<{ session: { token: string; at: number } | null }[]>`
      select secrets->'onestockSession'->${envKey(apiUrl)} as session from site_settings where site_id = ${site}`;
    const session = row?.session;
    if (session?.token && now - session.at < TOKEN_MAX_AGE_MS) {
      memory.set(key, session);
      return session.token;
    }
  }
  const credentials = await savedCredentials(site, apiUrl);
  if (!credentials)
    throw new HttpError(400, `No OneStock user / password saved for site ${site} on ${envKey(apiUrl)}: set them in Settings → OneStock API`);
  const token = await login(site, apiUrl, credentials);
  const session = { token, at: now };
  memory.set(key, session);
  await sql()`
    update site_settings
    set secrets = jsonb_set(jsonb_set(secrets, '{onestockSession}', coalesce(secrets->'onestockSession', '{}'::jsonb)),
                            ${sql().array(['onestockSession', envKey(apiUrl)])}::text[], ${sql().json(session)})
    where site_id = ${site}`;
  return token;
}

/** Forgets the token of a context (credentials changed). */
export function forgetToken(site: string, apiUrl: string) {
  memory.delete(memoryKey(site, apiUrl));
}

/**
 * OneStock call with the token of the site: when OneStock refuses the token (401 / 403), a new login is made and
 * the call is sent once more.
 */
export async function callOnestockApi(
  site: string,
  apiUrl: string,
  path: string,
  method: string,
  params: Record<string, unknown>,
): Promise<{ status: number; data: unknown }> {
  const url = onestockUrl(apiUrl, path);
  const send = async (token: string) => {
    try {
      return await callJson(url, method, { site_id: site, token, ...params });
    } catch (e) {
      throw new HttpError(502, `OneStock API unreachable: ${(e as Error).message}`);
    }
  };
  let result = await send(await siteToken(site, apiUrl));
  if (result.status === 401 || result.status === 403) result = await send(await siteToken(site, apiUrl, true));
  return result;
}
