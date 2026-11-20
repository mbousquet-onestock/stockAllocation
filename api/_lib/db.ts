import postgres from 'postgres';
import { verifySession, type Session } from './session.js';

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
  await sql()`drop index if exists segmentation_rules_priority_idx`;
  await sql()`create index if not exists segmentation_rules_site_priority_idx on segmentation_rules (site_id, priority)`;
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
  await sql()`drop index if exists api_calls_at_idx`;
  await sql()`create index if not exists api_calls_site_at_idx on api_calls (site_id, at desc)`;
  // Every insert must give its site: no default value any more (legacy rows keep '' until a site adopts them).
  await sql()`alter table segmentation_rules alter column site_id drop default`;
  await sql()`alter table api_calls alter column site_id drop default`;
  await sql()`
    create table if not exists site_settings (
      site_id text primary key,
      data jsonb not null,
      updated_at timestamptz not null default now()
    )`;
  // Secrets of the site (OneStock user / password and session, by environment): never returned to the browser.
  await sql()`alter table site_settings add column if not exists secrets jsonb not null default '{}'::jsonb`;
  // The token typed by hand is not used any more (authentication through /login only).
  await sql()`update site_settings set secrets = secrets - 'onestockToken' where secrets ? 'onestockToken'`;
  // Alert thresholds of the stock lines (OneStock has none): by item × endpoint × group stock type × purchase order.
  // A row is a threshold set on the line, replacing the threshold of the rule; no row = threshold of the rule.
  await sql()`
    create table if not exists stock_thresholds (
      site_id text not null,
      item_id text not null,
      endpoint_id text not null,
      stock_type text not null,
      purchase_order text not null default '',
      threshold integer,
      updated_at timestamptz not null default now(),
      primary key (site_id, item_id, endpoint_id, stock_type, purchase_order)
    )`;
  // Former "no threshold" rows hid the threshold of the rule (alerts lost): removed.
  await sql()`delete from stock_thresholds where threshold is null`;
}

/** Version of ensureSchema: increase it when ensureSchema changes, so that existing databases are migrated. */
const SCHEMA_VERSION = '8';
let schemaChecked = false;

/**
 * Schema created / migrated once per function instance, and only when the database is not at SCHEMA_VERSION yet:
 * a cold start costs 2 small queries instead of the whole migration.
 */
export async function ensureSchemaOnce() {
  if (schemaChecked) return;
  const [{ exists }] = await sql()<{ exists: boolean }[]>`select to_regclass('public.app_meta') is not null as exists`;
  const version = exists ? (await sql()<{ value: string }[]>`select value from app_meta where key = 'schema'`)[0]?.value : undefined;
  if (version !== SCHEMA_VERSION) {
    await ensureSchema();
    await sql()`create table if not exists app_meta (key text primary key, value text not null)`;
    await sql()`insert into app_meta (key, value) values ('schema', ${SCHEMA_VERSION}) on conflict (key) do update set value = excluded.value`;
  }
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
  /** OneStock UI Extension session (Authorization: Bearer), set by route(). */
  session?: Session;
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
    /** Machine-readable reason (e.g. session_expired), sent with the message. */
    public code?: string,
  ) {
    super(message);
  }
}

/**
 * Access control: a OneStock UI Extension session (`Authorization: Bearer`, see session.ts), or the shared secret
 * API_KEY in the x-api-key header (other callers: ERP, scripts, the application opened outside OneStock).
 * No API_KEY on the server and no session: open access, as before.
 */
async function authenticate(req: ApiRequest) {
  const auth = req.headers.authorization;
  const bearer = typeof auth === 'string' && auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  if (bearer) {
    req.session = await verifySession(bearer);
    return;
  }
  const expected = process.env.API_KEY;
  if (!expected) return;
  const given = req.headers['x-api-key'];
  if (given !== expected) throw new HttpError(401, 'Invalid or missing API key');
}

type Handler = (req: ApiRequest, res: ApiResponse) => Promise<unknown>;

/** Wraps a handler: API key check, method routing, JSON errors. */
export function route(
  handlers: Partial<Record<'GET' | 'POST' | 'PUT' | 'DELETE', Handler>>,
  options: { schema?: boolean; /** false: no access control (e.g. the endpoint that opens a session). */ auth?: boolean } = {},
) {
  return async (req: ApiRequest, res: ApiResponse) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      if (options.auth !== false) await authenticate(req);
      if (options.schema !== false) await ensureSchemaOnce();
      const handler = handlers[(req.method ?? 'GET') as keyof typeof handlers];
      if (!handler) throw new HttpError(405, `Method ${req.method} not allowed`);
      const result = await handler(req, res);
      res.status(200).json(result ?? { ok: true });
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 500;
      const message = e instanceof Error ? e.message : String(e);
      if (status === 500) console.error(e);
      res.status(status).json({ error: message, ...(e instanceof HttpError && e.code ? { code: e.code } : {}) });
    }
  };
}

/**
 * Site the data belongs to (OneStock site_id): x-site-id header, or site_id query parameter.
 * Required for the site scoped data (rules, API calls, site settings).
 */
export function siteOf(req: ApiRequest): string {
  // OneStock extension session: its site only (the header cannot switch to another site).
  if (req.session) return req.session.site_id;
  const header = req.headers['x-site-id'];
  const query = req.query.site_id;
  const site = String((Array.isArray(header) ? header[0] : header) ?? (Array.isArray(query) ? query[0] : query) ?? '').trim();
  if (!site) throw new HttpError(400, 'Site ID missing: set the OneStock site ID in Settings → OneStock API');
  return site;
}

/** Site of the request when given (health, setup). */
export function optionalSiteOf(req: ApiRequest): string {
  try {
    return siteOf(req);
  } catch {
    return '';
  }
}

/** Rows stored before the site scoping (site_id '') go to the first site that uses the table. */
export async function adoptLegacyRows(table: 'segmentation_rules' | 'api_calls', site: string) {
  const adopted = (adoptedTables[site] ??= new Set());
  if (adopted.has(table)) return;
  if (table === 'segmentation_rules') {
    const [{ own }] = await sql()<{ own: number }[]>`select count(*)::int as own from segmentation_rules where site_id = ${site}`;
    // A site that already has rules does not take the legacy ones (they may belong to another site).
    if (own === 0) await sql()`update segmentation_rules set site_id = ${site} where site_id = ''`;
  } else await sql()`update api_calls set site_id = ${site} where site_id = ''`;
  adopted.add(table);
}
const adoptedTables: Record<string, Set<string>> = {};

export const param = (req: ApiRequest, name: string): string => {
  const v = req.query[name];
  return Array.isArray(v) ? v[0] : v ?? '';
};

export function body<T>(req: ApiRequest): T {
  const b = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  if (!b || typeof b !== 'object') throw new HttpError(400, 'A JSON body is required');
  return b as T;
}

