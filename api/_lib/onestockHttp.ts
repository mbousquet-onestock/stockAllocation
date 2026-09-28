import http from 'node:http';
import https from 'node:https';
import { HttpError } from './db.js';

/** OneStock API calls made server side (proxy of the application, stock import function). */
export const ALLOWED_PATHS = ['/categories', '/endpoints', '/v3/items', '/stock_export', '/stock_import'];
/** Paths that may be written to (PATCH). */
export const WRITE_PATHS = ['/stock_import'];
const TIMEOUT_MS = 15000;

/** URL of an allowed OneStock path; https required (http allowed on localhost). */
export function onestockUrl(apiUrl: string, path: string): URL {
  if (!ALLOWED_PATHS.includes(path)) throw new HttpError(400, `Path not allowed: ${path}`);
  let base: URL;
  try {
    base = new URL(apiUrl);
  } catch {
    throw new HttpError(400, `Invalid API URL: ${apiUrl}`);
  }
  const local = ['localhost', '127.0.0.1'].includes(base.hostname);
  if (base.protocol !== 'https:' && !(local && base.protocol === 'http:')) throw new HttpError(400, 'The API URL must use https');
  return new URL(base.pathname.replace(/\/+$/, '') + path, base);
}

/** JSON call; GET requests may carry a body (the OneStock API expects site_id / token in the body). */
export function callJson(url: URL, method: string, payload: unknown): Promise<{ status: number; data: unknown }> {
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

/** Error message of a failed OneStock answer. */
export function answerError(status: number, data: unknown): string {
  const detail = typeof data === 'string' ? data.slice(0, 300) : JSON.stringify(data).slice(0, 300);
  return `OneStock API answered HTTP ${status}: ${detail}`;
}
