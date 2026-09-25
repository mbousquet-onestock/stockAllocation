import { body, ensureSchema, HttpError, param, route, sql } from './_lib/db.js';

/** Creates the table on the first call of an instance (databases initialized before this table existed). */
let schemaChecked = false;
async function ready() {
  if (!schemaChecked) await ensureSchema();
  schemaChecked = true;
}

/**
 * History of the API calls made by the application (Settings → API calls).
 * GET: latest calls (filters: target, errors, q; limit / offset) · POST: { calls: [...] } appends · DELETE: purges.
 */
interface CallInput {
  at: number;
  target: string;
  method: string;
  path: string;
  status?: number;
  ok: boolean;
  durationMs: number;
  summary?: string;
  error?: string;
  request?: unknown;
  response?: unknown;
  truncated?: boolean;
}

const MAX_BATCH = 200;

type Row = {
  id: string;
  at: Date;
  target: string;
  method: string;
  path: string;
  status: number | null;
  ok: boolean;
  duration_ms: number;
  summary: string | null;
  error: string | null;
  request: unknown;
  response: unknown;
  truncated: boolean;
};

export default route({
  GET: async (req) => {
    await ready();
    const limit = Math.min(500, Math.max(1, Number(param(req, 'limit')) || 100));
    const offset = Math.max(0, Number(param(req, 'offset')) || 0);
    const target = param(req, 'target');
    const errors = param(req, 'errors') === 'true';
    const q = param(req, 'q').trim();
    const like = `%${q}%`;
    const where = sql()`
      where (${target} = '' or target = ${target})
        and (${!errors} or not ok)
        and (${q} = '' or path ilike ${like} or coalesce(summary, '') ilike ${like} or coalesce(error, '') ilike ${like}
             or method ilike ${like} or request::text ilike ${like})`;
    const rows = await sql()<Row[]>`select * from api_calls ${where} order by at desc, id desc limit ${limit} offset ${offset}`;
    const [{ total, errors: errorCount }] = await sql()<{ total: number; errors: number }[]>`
      select count(*)::int as total, count(*) filter (where not ok)::int as errors from api_calls ${where}`;
    const [{ all }] = await sql()<{ all: number }[]>`select count(*)::int as "all" from api_calls`;
    return {
      total,
      all,
      errors: errorCount,
      calls: rows.map((r) => ({
        id: Number(r.id),
        at: r.at.getTime(),
        target: r.target,
        method: r.method,
        path: r.path,
        status: r.status ?? undefined,
        ok: r.ok,
        durationMs: r.duration_ms,
        summary: r.summary ?? undefined,
        error: r.error ?? undefined,
        request: r.request ?? undefined,
        response: r.response ?? undefined,
        truncated: r.truncated,
      })),
    };
  },
  POST: async (req) => {
    await ready();
    const calls = body<{ calls?: CallInput[] }>(req).calls;
    if (!Array.isArray(calls)) throw new HttpError(400, 'calls must be an array');
    if (calls.length > MAX_BATCH) throw new HttpError(400, `At most ${MAX_BATCH} calls per request`);
    for (const c of calls) {
      await sql()`
        insert into api_calls (at, target, method, path, status, ok, duration_ms, summary, error, request, response, truncated)
        values (${new Date(c.at)}, ${String(c.target)}, ${String(c.method)}, ${String(c.path)}, ${c.status ?? null}, ${!!c.ok},
                ${Math.round(c.durationMs) || 0}, ${c.summary ?? null}, ${c.error ?? null},
                ${c.request === undefined ? null : sql().json(c.request as never)},
                ${c.response === undefined ? null : sql().json(c.response as never)}, ${!!c.truncated})`;
    }
    return { ok: true, inserted: calls.length };
  },
  DELETE: async () => {
    await ready();
    const [{ n }] = await sql()<{ n: number }[]>`with d as (delete from api_calls returning 1) select count(*)::int as n from d`;
    return { ok: true, deleted: n };
  },
});
