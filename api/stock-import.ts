import { body, HttpError, route, siteOf, siteToken, sql } from './_lib/db.js';
import { answerError, callJson, onestockUrl } from './_lib/onestockHttp.js';
import { listRules } from './_lib/rules.js';
import {
  applyRuleToLine,
  categoryParentMap,
  DEFAULT_STOCK_TYPE,
  effectiveRule,
  emptyLine,
  lineDeltaRecords,
  lineKey,
  matchesCriteria,
  parseCategories,
  parseItemNode,
  recordsToLines,
  setCategoryParents,
  StockTypeTree,
  type ItemNode,
  type StockImportRecord,
  type StockRecord,
} from './_lib/segmentation.js';
import type { Item, SegmentationRule, StockLine, StockType } from '../src/types.js';

/**
 * Stock import with the segmentation rules of the site, run server side (Vercel function):
 *
 *   POST /api/stock-import   (headers x-api-key, x-site-id)
 *
 * 1. `stocks` given → import: each record is the new quantity of an item × endpoint × main stock type
 *    (× purchase order for future stock). The quantity is split onto the groups with the rule of the item.
 * 2. `item_ids` given → re-segmentation of the current OneStock stock of these items with the rules.
 * 3. Nothing given → re-segmentation of the catalog, page by page: the items are read with v3/items
 *    (`limit` ids from `cursor`), those matched by a rule are segmented; call again with `next_cursor`.
 *
 * Items (criteria: category_ids, brand, season…) are read with v3/items, the current stock with stock_export, and the
 * changes are sent with PATCH stock_import `incremental: true` (variation of each stock type). `dry_run: true` only
 * computes them. The OneStock URL, options, token and stock types are the ones stored for the site
 * (Settings → OneStock API, with "Store the token in the database").
 */

interface IncomingRecord {
  item_id: string;
  endpoint_id: string;
  quantity: number;
  /** Main stock type code (on_hand, container…); absent = on_hand. */
  type?: string;
  purchase_order_number?: string;
  eta_start?: number;
  eta_end?: number;
}

interface ImportBody {
  stocks?: IncomingRecord[];
  item_ids?: string[];
  cursor?: unknown[];
  limit?: number;
  dry_run?: boolean;
}

interface Change {
  item_id: string;
  endpoint_id: string;
  stock_type: string;
  purchase_order_number: string | null;
  rule: string | null;
  before: Record<string, number>;
  after: Record<string, number>;
  blocked?: string;
}

const MAX_STOCKS = 5000;
const MAX_ITEMS = 500;
const DETAIL_BATCH = 25;
const STOCK_BATCH = 50;
const IMPORT_BATCH = 500;
const CONCURRENCY = 4;
/** Stop scanning the catalog before the function time limit (the rest is left for the next call). */
const SCAN_BUDGET_MS = 40_000;

interface OnestockSettings {
  url?: string;
  method?: 'GET' | 'POST';
  language?: string;
  stockRequest?: string;
}

/** Everything the import needs for the site: OneStock access, stock types, rules. */
async function siteContext(site: string) {
  const [row] = await sql()<{ data: { onestock?: OnestockSettings; stockTypes?: StockType[] } }[]>`
    select data from site_settings where site_id = ${site}`;
  const onestock = row?.data.onestock ?? {};
  if (!onestock.url) throw new HttpError(400, `No OneStock URL stored for site ${site}: save Settings → OneStock API with the database`);
  const token = await siteToken(site);
  if (!token) throw new HttpError(400, `No OneStock token stored for site ${site}: check "Store the token in the database" in Settings → OneStock API`);
  const types = row?.data.stockTypes ?? [];
  if (!types.length) throw new HttpError(400, `No stock types stored for site ${site}: open Settings → Stock types once`);
  const rules = (await listRules(site)) as unknown as SegmentationRule[];
  return { onestock, token, tree: new StockTypeTree(types), rules: rules.filter((r) => r.enabled) };
}

type Context = Awaited<ReturnType<typeof siteContext>>;

/** OneStock call with the stored access of the site, logged in the API calls of the site (Settings → API calls). */
function onestockClient(site: string, ctx: Context) {
  const logs: Array<Record<string, unknown>> = [];
  const call = async <T>(path: string, params: Record<string, unknown>, method: string = ctx.onestock.method ?? 'GET'): Promise<T> => {
    const started = Date.now();
    const entry = (extra: Record<string, unknown>) =>
      logs.push({ at: new Date(started), method, path: `${ctx.onestock.url!.replace(/\/+$/, '')}${path}`, request: { site_id: site, token: '•••', ...summarize(params) }, duration: Date.now() - started, ...extra });
    let result: { status: number; data: unknown };
    try {
      result = await callJson(onestockUrl(ctx.onestock.url!, path), method, { site_id: site, token: ctx.token, ...params });
    } catch (e) {
      const error = e instanceof HttpError ? e.message : `OneStock API unreachable: ${(e as Error).message}`;
      entry({ ok: false, error });
      throw new HttpError(502, error);
    }
    if (result.status >= 400) {
      const error = answerError(result.status, result.data);
      entry({ ok: false, status: result.status, error });
      throw new HttpError(502, error);
    }
    entry({ ok: true, status: result.status, summary: answerSummary(result.data) });
    return result.data as T;
  };
  /** Writes the calls in api_calls (target "OneStock (server)"). */
  const flush = async () => {
    for (const l of logs)
      await sql()`
        insert into api_calls (site_id, at, target, method, path, status, ok, duration_ms, summary, error, request, response, truncated)
        values (${site}, ${l.at as Date}, 'OneStock (server)', ${String(l.method)}, ${String(l.path)}, ${(l.status as number) ?? null},
                ${!!l.ok}, ${Number(l.duration) || 0}, ${(l.summary as string) ?? null}, ${(l.error as string) ?? null},
                ${sql().json(l.request as never)}, null, true)`.catch(() => undefined);
  };
  return { call, flush };
}

/** Request body as logged: long lists are cut. */
function summarize(params: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(params).map(([k, v]) => [k, Array.isArray(v) && v.length > 20 ? [...v.slice(0, 20), `… ${v.length - 20} more`] : v]),
  );
}

function answerSummary(data: unknown): string | undefined {
  const d = data as { items?: unknown[]; stocks?: unknown[] } | null;
  if (Array.isArray(d?.items)) return `${d!.items.length} items`;
  if (Array.isArray(d?.stocks)) return `${d!.stocks.length} stock records`;
  return undefined;
}

/** Runs `worker` on the batches, CONCURRENCY at a time. */
async function inBatches<T>(values: T[], size: number, worker: (batch: T[]) => Promise<void>) {
  const batches: T[][] = [];
  for (let i = 0; i < values.length; i += size) batches.push(values.slice(i, i + size));
  const run = async () => {
    for (let b = batches.shift(); b; b = batches.shift()) await worker(b);
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, batches.length) }, run));
}

const quantities = (line: StockLine, tree: StockTypeTree): Record<string, number> => {
  const groups = tree.groupsOf(line.stockTypeId);
  const split = groups.reduce((s, g) => s + (line.split[g.id]?.quantity ?? 0), 0);
  return Object.fromEntries([
    [tree.code(line.stockTypeId), line.quantity - split],
    ...groups.map((g) => [g.code, line.split[g.id]?.quantity ?? 0] as const),
  ]);
};

/** No rule for the item: the groups keep their quantity (reduced from the last one if the stock is lower). */
function withoutRule(line: StockLine, tree: StockTypeTree): StockLine {
  const groups = tree.groupsOf(line.stockTypeId);
  let left = line.quantity;
  const kept = groups.map((g) => {
    const q = Math.max(0, Math.min(left, line.split[g.id]?.quantity ?? 0));
    left -= q;
    return [g.id, { quantity: q, threshold: line.split[g.id]?.threshold ?? null }] as const;
  });
  return { ...line, split: Object.fromEntries(kept) };
}

export default route({
  POST: async (req) => {
    const site = siteOf(req);
    const b = body<ImportBody>(req);
    const started = Date.now();
    const ctx = await siteContext(site);
    const { call, flush } = onestockClient(site, ctx);
    const { tree, rules } = ctx;
    const language = ctx.onestock.language || 'fr';
    const errors: string[] = [];

    try {
      const stocks = b.stocks;
      if (stocks !== undefined && (!Array.isArray(stocks) || stocks.length > MAX_STOCKS))
        throw new HttpError(400, `stocks must be a list of at most ${MAX_STOCKS} records`);
      if (b.item_ids !== undefined && (!Array.isArray(b.item_ids) || b.item_ids.length > MAX_ITEMS))
        throw new HttpError(400, `item_ids must be a list of at most ${MAX_ITEMS} ids`);

      // Category tree: a rule on a category also matches its sub-categories.
      if (rules.some((r) => r.criteria.some((c) => c.attribute === 'category')))
        setCategoryParents(categoryParentMap(parseCategories(await call('/categories', {}), language)));

      // --- Items to look at
      let itemIds: string[];
      let nextCursor: unknown[] | null = null;
      let scanned = 0;
      if (stocks) itemIds = [...new Set(stocks.map((s) => String(s?.item_id ?? '')).filter(Boolean))];
      else if (b.item_ids) itemIds = [...new Set(b.item_ids.map(String))];
      else {
        // Catalog scan: ids of v3/items from the cursor.
        const limit = Math.min(MAX_ITEMS, Math.max(1, Number(b.limit) || 200));
        const pageSize = Math.min(100, limit);
        itemIds = [];
        let cursor = Array.isArray(b.cursor) && b.cursor.length ? b.cursor : undefined;
        for (;;) {
          const page = await call<{ items?: Array<{ id?: string }>; pagination?: { search_after?: unknown[] } }>('/v3/items', {
            pagination: cursor ? { limit: pageSize, search_after: cursor } : { limit: pageSize, start: 0 },
          });
          const ids = (page.items ?? []).map((i) => i.id).filter((id): id is string => !!id);
          itemIds.push(...ids.filter((id) => !itemIds.includes(id)));
          const full = ids.length === pageSize;
          cursor = full ? (page.pagination?.search_after?.length ? page.pagination.search_after : [ids[ids.length - 1]]) : undefined;
          if (!cursor || itemIds.length >= limit || Date.now() - started > SCAN_BUDGET_MS / 2) break;
        }
        nextCursor = cursor ?? null;
        scanned = itemIds.length;
      }

      // --- Item details (criteria), then the items that need a segmentation
      const items = new Map<string, Item>();
      await inBatches(itemIds, DETAIL_BATCH, async (batch) => {
        const page = await call<{ items?: ItemNode[] }>('/v3/items', { item_ids: batch });
        (page.items ?? []).forEach((node) => node.id && items.set(String(node.id), parseItemNode(node, language)));
      });
      const unknownItems = itemIds.filter((id) => !items.has(id));
      if (unknownItems.length) errors.push(`Items not found in OneStock: ${unknownItems.slice(0, 20).join(', ')}${unknownItems.length > 20 ? '…' : ''}`);
      const matched = [...items.values()].filter((i) => rules.some((r) => matchesCriteria(i, r.criteria)));
      // An import updates every item it receives; a re-segmentation only the items matched by a rule.
      const targets = stocks ? [...items.keys()] : matched.map((i) => i.id);

      // --- Current stock
      const records: StockRecord[] = [];
      await inBatches(targets, STOCK_BATCH, async (batch) => {
        const data = await call<{ stocks?: StockRecord[] }>('/stock_export', {
          ...(ctx.onestock.stockRequest?.trim() ? { request_name: ctx.onestock.stockRequest.trim() } : {}),
          item_filter: { ids: batch },
        });
        records.push(...(data?.stocks ?? []).filter((r) => r?.item_id && targets.includes(r.item_id)));
      });
      const current = recordsToLines(records, tree);
      if (current.unknownTypes.length) errors.push(`Stock types not configured in Settings → Stock types, ignored: ${current.unknownTypes.join(', ')}`);
      const byKey = new Map(current.lines.map((l) => [l.id, l]));

      // --- New lines
      const pairs: Array<{ before: StockLine; after: StockLine }> = [];
      if (stocks) {
        const incoming = new Map<string, StockLine>();
        stocks.forEach((s, i) => {
          const where = `stocks[${i}]`;
          const code = s?.type?.trim() || DEFAULT_STOCK_TYPE;
          const type = tree.byCode(code);
          if (!s?.item_id || !s.endpoint_id) return void errors.push(`${where}: item_id and endpoint_id are required`);
          if (!items.has(String(s.item_id))) return;
          if (!type) return void errors.push(`${where}: unknown stock type "${code}"`);
          if (type.parentId) return void errors.push(`${where}: "${code}" is a group, send the main stock type (${tree.code(type.parentId)}): it is split by the rules`);
          const quantity = Number(s.quantity);
          if (!Number.isFinite(quantity) || quantity < 0) return void errors.push(`${where}: invalid quantity`);
          const po = type.future ? s.purchase_order_number?.trim() || null : null;
          if (type.future && !po) return void errors.push(`${where}: purchase_order_number is required on future stock (${type.code})`);
          const key = lineKey(String(s.item_id), String(s.endpoint_id), type.id, po);
          const before = byKey.get(key) ?? emptyLine(String(s.item_id), String(s.endpoint_id), type.id, po, tree);
          const line = incoming.get(key) ?? { ...before, remoteTypes: { ...before.remoteTypes }, quantity: 0 };
          line.quantity += Math.round(quantity);
          // Code as sent (casing of OneStock), when not read yet.
          if (!(type.id in line.remoteTypes!)) line.remoteTypes![type.id] = s.type?.trim() ?? '';
          if (s.eta_start || s.eta_end) line.eta = { start: s.eta_start ?? s.eta_end!, end: s.eta_end ?? s.eta_start! };
          incoming.set(key, line);
        });
        incoming.forEach((line, key) => pairs.push({ before: byKey.get(key) ?? emptyLine(line.itemId, line.locationId, line.stockTypeId, line.purchaseOrder, tree), after: line }));
      } else current.lines.forEach((l) => pairs.push({ before: l, after: l }));

      // --- Segmentation and variations
      const changes: Change[] = [];
      const deltas: StockImportRecord[] = [];
      let unchanged = 0;
      let withoutRuleCount = 0;
      pairs.forEach(({ before, after: base }) => {
        const item = items.get(base.itemId)!;
        const rule = effectiveRule(rules, item, base);
        if (!rule) withoutRuleCount++;
        const after = rule ? applyRuleToLine(base, rule, tree) : withoutRule(base, tree);
        const records = lineDeltaRecords(before, after, tree);
        if (!records.length) return void unchanged++;
        const blocked = tree.byId(after.stockTypeId)?.future && !after.eta ? 'Future stock without ETA (eta_start / eta_end): not sent' : undefined;
        changes.push({
          item_id: after.itemId,
          endpoint_id: after.locationId,
          stock_type: tree.code(after.stockTypeId),
          purchase_order_number: after.purchaseOrder,
          rule: rule?.name ?? null,
          before: quantities(before, tree),
          after: quantities(after, tree),
          ...(blocked ? { blocked } : {}),
        });
        if (!blocked) deltas.push(...records);
      });

      // --- stock_import
      let calls = 0;
      if (!b.dry_run)
        for (let i = 0; i < deltas.length; i += IMPORT_BATCH) {
          await call('/stock_import', { import: { incremental: true }, stocks: deltas.slice(i, i + IMPORT_BATCH) }, 'PATCH');
          calls++;
        }

      return {
        site_id: site,
        mode: stocks ? 'import' : b.item_ids ? 'items' : 'catalog',
        dry_run: !!b.dry_run,
        ...(stocks ? {} : { items_scanned: scanned || itemIds.length }),
        items_matched: matched.length,
        lines: pairs.length,
        changed: changes.filter((c) => !c.blocked).length,
        blocked: changes.filter((c) => c.blocked).length,
        unchanged,
        without_rule: withoutRuleCount,
        records_sent: b.dry_run ? 0 : deltas.length,
        stock_import_calls: calls,
        ...(stocks || b.item_ids ? {} : { next_cursor: nextCursor }),
        duration_ms: Date.now() - started,
        errors,
        changes,
        records: deltas,
      };
    } finally {
      await flush();
    }
  },
});
