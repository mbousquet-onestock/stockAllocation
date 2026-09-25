/**
 * Where the segmentation rules are stored, configured in Settings → Database.
 * Kept in the browser (localStorage). The database credentials themselves stay on the server
 * (Vercel environment variables): the browser only knows the API URL and the optional API key.
 */
export interface DbConfig {
  mode: 'local' | 'remote';
  /** Base URL of the Vercel functions ("/api" when the app is deployed with them). */
  apiUrl: string;
  /** Shared secret, required when API_KEY is set on the server. */
  apiKey: string;
}

const KEY = 'stock-allocation:db-config';
export const DEFAULT_DB_CONFIG: DbConfig = { mode: 'local', apiUrl: '/api', apiKey: '' };

export function getDbConfig(): DbConfig {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULT_DB_CONFIG, ...(JSON.parse(raw) as Partial<DbConfig>) };
  } catch {
    /* ignore */
  }
  return DEFAULT_DB_CONFIG;
}

export function setDbConfig(config: DbConfig) {
  try {
    localStorage.setItem(KEY, JSON.stringify(config));
  } catch {
    /* ignore */
  }
}
