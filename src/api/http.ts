import { getDbConfig, type DbConfig } from './dbConfig';
import { authHeaders, hasSession, inExtension, renewSession } from './extension';

/**
 * Call of the application API (/api…): adds the authorization (OneStock extension session or API key); in a OneStock
 * extension, an expired session is renewed (new handshake) and the call sent once more.
 */
export async function apiFetch(url: string, init: RequestInit = {}, config: DbConfig = getDbConfig()): Promise<Response> {
  const send = () => fetch(url, { ...init, headers: { ...(init.headers as Record<string, string>), ...authHeaders(config.apiKey) } });
  const res = await send();
  if (res.status !== 401 || !inExtension() || !hasSession()) return res;
  try {
    await renewSession();
  } catch {
    return res;
  }
  return send();
}
