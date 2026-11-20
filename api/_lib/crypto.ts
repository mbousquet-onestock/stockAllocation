import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { HttpError, sql } from './db.js';

/**
 * Encryption of the secrets saved in the database (OneStock passwords): AES-256-GCM.
 * Key: the CREDENTIALS_SECRET environment variable when it is set (recommended: the key then never is in the database),
 * else a random key generated once and kept in the database (app_meta), so that it follows the database — Neon
 * branches of preview deployments included — and does not depend on the database URL (which Neon may rotate).
 * Changing CREDENTIALS_SECRET makes the saved passwords unreadable: they must be typed again in Settings → OneStock API.
 */
let cachedKey: Buffer | undefined;

async function key(): Promise<Buffer> {
  if (process.env.CREDENTIALS_SECRET) return createHash('sha256').update(process.env.CREDENTIALS_SECRET).digest();
  if (cachedKey) return cachedKey;
  await sql()`create table if not exists app_meta (key text primary key, value text not null)`;
  await sql()`insert into app_meta (key, value) values ('credentials_key', ${randomBytes(32).toString('base64')}) on conflict (key) do nothing`;
  const [row] = await sql()<{ value: string }[]>`select value from app_meta where key = 'credentials_key'`;
  cachedKey = Buffer.from(row.value, 'base64');
  return cachedKey;
}

export async function encrypt(text: string): Promise<string> {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', await key(), iv);
  const data = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), data.toString('base64')].join(':');
}

export async function decrypt(value: string): Promise<string> {
  const [version, iv, tag, data] = value.split(':');
  if (version !== 'v1' || !iv || !tag || !data) throw new HttpError(500, 'Unknown format of a saved secret');
  try {
    const decipher = createDecipheriv('aes-256-gcm', await key(), Buffer.from(iv, 'base64'));
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
  } catch {
    throw new HttpError(400, 'The saved OneStock password cannot be read (encryption key changed): type it again in Settings → OneStock API');
  }
}
