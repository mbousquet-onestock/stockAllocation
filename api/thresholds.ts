import { body, HttpError, param, route, siteOf, sql } from './_lib/db.js';

/**
 * Alert thresholds of the stock lines, per site (Item allocation → edit a stock line). OneStock does not store them:
 * they are kept here and read back when the items are displayed.
 * GET ?item_ids=a,b,c → thresholds of these items · PUT { thresholds: [...] } → upsert.
 * stock_type is the id of the group stock type (Settings → Stock types); threshold null = no threshold.
 */
interface ThresholdInput {
  item_id: string;
  endpoint_id: string;
  stock_type: string;
  purchase_order?: string | null;
  threshold: number | null;
}

const MAX_ITEMS = 500;
const MAX_ROWS = 2000;

type Row = { item_id: string; endpoint_id: string; stock_type: string; purchase_order: string; threshold: number | null; updated_at: Date };

export default route({
  GET: async (req) => {
    const site = siteOf(req);
    const ids = [...new Set(param(req, 'item_ids').split(',').map((s) => s.trim()).filter(Boolean))];
    if (ids.length > MAX_ITEMS) throw new HttpError(400, `At most ${MAX_ITEMS} item ids`);
    if (!ids.length) return { thresholds: [] };
    const rows = await sql()<Row[]>`
      select item_id, endpoint_id, stock_type, purchase_order, threshold, updated_at from stock_thresholds
      where site_id = ${site} and item_id = any(${ids})`;
    return {
      thresholds: rows.map((r) => ({
        item_id: r.item_id,
        endpoint_id: r.endpoint_id,
        stock_type: r.stock_type,
        purchase_order: r.purchase_order || null,
        threshold: r.threshold,
        updated_at: r.updated_at.toISOString(),
      })),
    };
  },
  PUT: async (req) => {
    const site = siteOf(req);
    const list = body<{ thresholds?: ThresholdInput[] }>(req).thresholds;
    if (!Array.isArray(list) || list.length > MAX_ROWS) throw new HttpError(400, `thresholds must be a list of at most ${MAX_ROWS} entries`);
    for (const [i, t] of list.entries()) {
      if (!t?.item_id || !t.endpoint_id || !t.stock_type) throw new HttpError(400, `thresholds[${i}]: item_id, endpoint_id and stock_type are required`);
      if (t.threshold !== null && !(Number.isInteger(t.threshold) && t.threshold >= 0))
        throw new HttpError(400, `thresholds[${i}]: threshold must be a positive integer or null`);
    }
    for (const t of list)
      await sql()`
        insert into stock_thresholds (site_id, item_id, endpoint_id, stock_type, purchase_order, threshold)
        values (${site}, ${String(t.item_id)}, ${String(t.endpoint_id)}, ${String(t.stock_type)}, ${t.purchase_order ?? ''}, ${t.threshold})
        on conflict (site_id, item_id, endpoint_id, stock_type, purchase_order)
        do update set threshold = excluded.threshold, updated_at = now()`;
    return { ok: true, saved: list.length };
  },
});
