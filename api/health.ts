import { connectionString, ensureSchemaOnce, optionalSiteOf, route, schemaReady, sql } from './_lib/db.js';

/** Connection check used by Settings → Database. */
export default route({
  GET: async (req) => {
    const url = connectionString();
    if (!url) return { ok: false, configured: false, error: 'DATABASE_URL is not configured on the server' };
    const [info] = await sql()<{ database: string; version: string }[]>`select current_database() as database, version() as version`;
    const ready = await schemaReady();
    // Existing tables: bring them to the current schema (site_id…) before counting.
    if (ready) await ensureSchemaOnce();
    const site = optionalSiteOf(req);
    const ruleCount = ready ? Number((await sql()`select count(*)::int as n from segmentation_rules where site_id = ${site}`)[0].n) : 0;
    let host = '';
    try {
      host = new URL(url).hostname;
    } catch {
      /* not a URL */
    }
    return {
      ok: true,
      configured: true,
      host,
      database: info.database,
      version: info.version.split(' ').slice(0, 2).join(' '),
      schemaReady: ready,
      ruleCount,
      apiKeyRequired: Boolean(process.env.API_KEY),
      siteId: site,
    };
  },
  // Must answer even when the schema is missing or DATABASE_URL is not set.
}, { schema: false });
