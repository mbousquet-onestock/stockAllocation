import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { HttpError, sql } from './db.js';

/**
 * OneStock UI Extension: the application is loaded by OneStock in an iframe, with its context in the URL
 * (site_id, user_id, extension_id…) and an `extension_signature` sent in the postMessage handshake.
 * The signature is checked here with the secret hash given by OneStock, then a short session (JWT) is issued:
 * the browser sends it as `Authorization: Bearer …`, and the site of the session is the only site it can reach.
 */

export interface Session {
  site_id: string;
  user_id: string;
  extension_id: string;
  /** Expiry, Unix seconds. */
  exp: number;
}

/** Session length; the signature of OneStock is valid 6 hours, the browser renews the session with a new handshake. */
export const SESSION_TTL_S = 2 * 60 * 60;
const SIGNATURE_MAX_AGE_S = 6 * 60 * 60;

let cachedKey: Buffer | undefined;
/** Key of the session tokens: SESSION_SECRET, else a random key generated once and kept in the database. */
async function sessionKey(): Promise<Buffer> {
  if (process.env.SESSION_SECRET) return createHash('sha256').update(process.env.SESSION_SECRET).digest();
  if (cachedKey) return cachedKey;
  await sql()`create table if not exists app_meta (key text primary key, value text not null)`;
  await sql()`insert into app_meta (key, value) values ('session_key', ${randomBytes(32).toString('base64')}) on conflict (key) do nothing`;
  const [row] = await sql()<{ value: string }[]>`select value from app_meta where key = 'session_key'`;
  cachedKey = Buffer.from(row.value, 'base64');
  return cachedKey;
}

const b64url = (b: Buffer | string) => Buffer.from(b).toString('base64url');

export async function signSession(claims: Omit<Session, 'exp'>, ttlSeconds = SESSION_TTL_S): Promise<{ token: string; exp: number }> {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const head = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify({ ...claims, exp }));
  const sig = b64url(createHmac('sha256', await sessionKey()).update(`${head}.${body}`).digest());
  return { token: `${head}.${body}.${sig}`, exp };
}

export async function verifySession(token: string): Promise<Session> {
  const [head, body, sig] = token.split('.');
  if (!head || !body || !sig) throw new HttpError(401, 'Invalid session', 'invalid_session');
  const expected = createHmac('sha256', await sessionKey()).update(`${head}.${body}`).digest();
  const given = Buffer.from(sig, 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) throw new HttpError(401, 'Invalid session', 'invalid_session');
  const claims = JSON.parse(Buffer.from(body, 'base64url').toString()) as Session;
  if (!claims.exp || claims.exp < Date.now() / 1000) throw new HttpError(401, 'Session expired', 'session_expired');
  return claims;
}

/**
 * extension_signature = "t=<unix seconds>,h0=<hex>,h1=<hex>,h2=<hex>": HMAC-SHA256 of `${t}.${extension_id}##${user_id}`
 * with the latest, previous and oldest secret hash of the extension. Valid 6 hours.
 * Secrets: ONESTOCK_EXTENSION_SECRET (several separated by commas, e.g. during a rotation).
 */
export function checkExtensionSignature(signature: string, extensionId: string, userId: string) {
  const secrets = (process.env.ONESTOCK_EXTENSION_SECRET ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (!secrets.length) throw new HttpError(500, 'ONESTOCK_EXTENSION_SECRET is not configured on the server');
  const allowedId = process.env.ONESTOCK_EXTENSION_ID?.trim();
  if (allowedId && allowedId !== extensionId) throw new HttpError(403, 'Unknown extension_id');
  const parts = Object.fromEntries(
    String(signature)
      .split(',')
      .map((p) => p.split('='))
      .filter((kv) => kv.length === 2) as [string, string][],
  );
  const t = Number(parts.t);
  const now = Date.now() / 1000;
  if (!Number.isFinite(t) || now - t > SIGNATURE_MAX_AGE_S || t - now > 300) throw new HttpError(401, 'Extension signature expired or invalid', 'invalid_signature');
  const hashes = Object.entries(parts)
    .filter(([k]) => /^h\d+$/.test(k))
    .map(([, v]) => Buffer.from(v, 'hex'));
  const payload = `${t}.${extensionId}##${userId}`;
  const ok = secrets.some((secret) => {
    const expected = createHmac('sha256', secret).update(payload).digest();
    return hashes.some((h) => h.length === expected.length && timingSafeEqual(h, expected));
  });
  if (!ok) throw new HttpError(401, 'Invalid extension signature', 'invalid_signature');
}
