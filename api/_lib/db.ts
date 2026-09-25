import postgres from 'postgres';

/**
 * Postgres access for the Vercel functions.
 * The connection string comes from the environment (set by the Vercel Postgres / Neon integration):
 * DATABASE_URL, or POSTGRES_URL as a fallback. Credentials never reach the browser.
 */
let client: postgres.Sql | undefined;

export function connectionString(): string | undefined {
  return process.env.DATABASE_URL || process.env.POSTGRES_URL;
}

export function sql(): postgres.Sql {
  const url = connectionString();
  if (!url) throw new HttpError(500, 'DATABASE_URL is not configured on the server');
  if (!client) {
    const local = /@(localhost|127\.0\.0\.1)[:/]/.test(url);
    client = postgres(url, { max: 1, idle_timeout: 20, ssl: local ? false : 'require', prepare: false });
  }
  return client;
}

export async function ensureSchema() {
  await sql()`
    create table if not exists segmentation_rules (
      site_id text not null default '',
      id text not null,
      priority integer not null,
      data jsonb not null,
      updated_at timestamptz not null default now(),
      primary key (site_id, id)
    )`;
  // Tables created before the site scoping: add site_id and make the key (site_id, id).
  await sql()`alter table segmentation_rules add column if not exists site_id text not null default ''`;
  await sql().unsafe(`
    do $$ begin
      if exists (select 1 from pg_constraint where conname = 'segmentation_rules_pkey' and array_length(conkey, 1) = 1) then
        alter table segmentation_rules drop constraint segmentation_rules_pkey;
        alter table segmentation_rules add primary key (site_id, id);
      end if;
    end $$`);
  await sql()`create index if not exists segmentation_rules_priority_idx on segmentation_rules (site_id, priority)`;
  await sql()`
    create table if not exists api_calls (
      id bigserial primary key,
      site_id text not null default '',
      at timestamptz not null,
      target text not null,
      method text not null,
      path text not null,
      status integer,
      ok boolean not null,
      duration_ms integer not null default 0,
      summary text,
      error text,
      request jsonb,
      response jsonb,
      truncated boolean not null default false
    )`;
  await sql()`alter table api_calls add column if not exists site_id text not null default ''`;
  await sql()`create index if not exists api_calls_site_at_idx on api_calls (site_id, at desc)`;
  await sql()`
    create table if not exists site_settings (
      site_id text primary key,
      data jsonb not null,
      updated_at timestamptz not null default now()
    )`;
}

let schemaChecked = false;
/** Schema created / migrated once per function instance. */
export async function ensureSchemaOnce() {
  if (schemaChecked) return;
  await ensureSchema();
  schemaChecked = true;
}

export async function schemaReady(): Promise<boolean> {
  const [row] = await sql()`select to_regclass('public.segmentation_rules') is not null as ready`;
  return Boolean(row?.ready);
}

// ---------------------------------------------------------------------------
// Minimal request / response types, compatible with Vercel Node functions.
// ---------------------------------------------------------------------------

export interface ApiRequest {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  query: Record<string, string | string[] | undefined>;
  body?: unknown;
}

export interface ApiResponse {
  status(code: number): ApiResponse;
  json(body: unknown): void;
  setHeader(name: string, value: string): void;
}

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Shared secret: when API_KEY is set on the server, every call must send it in the x-api-key header. */
function checkApiKey(req: ApiRequest) {
  const expected = process.env.API_KEY;
  if (!expected) return;
  const given = req.headers['x-api-key'];
  if (given !== expected) throw new HttpError(401, 'Invalid or missing API key');
}

type Handler = (req: ApiRequest, res: ApiResponse) => Promise<unknown>;

/** Wraps a handler: API key check, method routing, JSON errors. */
export function route(handlers: Partial<Record<'GET' | 'POST' | 'PUT' | 'DELETE', Handler>>, options: { schema?: boolean } = {}) {
  return async (req: ApiRequest, res: ApiResponse) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      checkApiKey(req);
      if (options.schema !== false) await ensureSchemaOnce();
      const handler = handlers[(req.method ?? 'GET') as keyof typeof handlers];
      if (!handler) throw new HttpError(405, `Method ${req.method} not allowed`);
      const result = await handler(req, res);
      res.status(200).json(result ?? { ok: true });
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 500;
      const message = e instanceof Error ? e.message : String(e);
      if (status === 500) console.error(e);
      res.status(status).json({ error: message });
    }
  };
}

/** Site the data belongs to (OneStock site_id), sent by the application in the x-site-id header. */
export function siteOf(req: ApiRequest): string {
  const v = req.headers['x-site-id'];
  return (Array.isArray(v) ? v[0] : v ?? '').trim();
}

export const param = (req: ApiRequest, name: string): string => {
  const v = req.query[name];
  return Array.isArray(v) ? v[0] : v ?? '';
};

export function body<T>(req: ApiRequest): T {
  const b = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  if (!b || typeof b !== 'object') throw new HttpError(400, 'A JSON body is required');
  return b as T;
}
