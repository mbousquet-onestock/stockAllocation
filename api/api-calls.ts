import { body, HttpError, param, route, siteOf, sql } from './_lib/db.js';

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
    const limit = Math.min(500, Math.max(1, Number(param(req, 'limit')) || 100));
    const offset = Math.max(0, Number(param(req, 'offset')) || 0);
    const target = param(req, 'target');
    const errors = param(req, 'errors') === 'true';
    const q = param(req, 'q').trim();
    const like = `%${q}%`;
    const site = siteOf(req);
    const where = sql()`
      where site_id = ${site}
        and (${target} = '' or target = ${target})
        and (${!errors} or not ok)
        and (${q} = '' or path ilike ${like} or coalesce(summary, '') ilike ${like} or coalesce(error, '') ilike ${like}
             or method ilike ${like} or request::text ilike ${like})`;
    const rows = await sql()<Row[]>`select * from api_calls ${where} order by at desc, id desc limit ${limit} offset ${offset}`;
    const [{ total, errors: errorCount }] = await sql()<{ total: number; errors: number }[]>`
      select count(*)::int as total, count(*) filter (where not ok)::int as errors from api_calls ${where}`;
    const [{ all }] = await sql()<{ all: number }[]>`select count(*)::int as "all" from api_calls where site_id = ${site}`;
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
    const site = siteOf(req);
    const calls = body<{ calls?: CallInput[] }>(req).calls;
    if (!Array.isArray(calls)) throw new HttpError(400, 'calls must be an array');
    if (calls.length > MAX_BATCH) throw new HttpError(400, `At most ${MAX_BATCH} calls per request`);
    for (const c of calls) {
      await sql()`
        insert into api_calls (site_id, at, target, method, path, status, ok, duration_ms, summary, error, request, response, truncated)
        values (${site}, ${new Date(c.at)}, ${String(c.target)}, ${String(c.method)}, ${String(c.path)}, ${c.status ?? null}, ${!!c.ok},
                ${Math.round(c.durationMs) || 0}, ${c.summary ?? null}, ${c.error ?? null},
                ${c.request === undefined ? null : sql().json(c.request as never)},
                ${c.response === undefined ? null : sql().json(c.response as never)}, ${!!c.truncated})`;
    }
    return { ok: true, inserted: calls.length };
  },
  /** Purges the history of the site. */
  DELETE: async (req) => {
    const site = siteOf(req);
    const [{ n }] = await sql()<{ n: number }[]>`
      with d as (delete from api_calls where site_id = ${site} returning 1) select count(*)::int as n from d`;
    return { ok: true, deleted: n };
  },
});
