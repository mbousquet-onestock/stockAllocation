import { connectionString, route, schemaReady, sql } from './_lib/db.js';

/** Connection check used by Settings → Database. */
export default route({
  GET: async () => {
    const url = connectionString();
    if (!url) return { ok: false, configured: false, error: 'DATABASE_URL is not configured on the server' };
    const [info] = await sql()<{ database: string; version: string }[]>`select current_database() as database, version() as version`;
    const ready = await schemaReady();
    const ruleCount = ready ? Number((await sql()`select count(*)::int as n from segmentation_rules`)[0].n) : 0;
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
    };
  },
});
