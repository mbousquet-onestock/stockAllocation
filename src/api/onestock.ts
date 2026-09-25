import type { Item, StockLocation } from '../types';
import { getDbConfig } from './dbConfig';

/**
 * OneStock API settings (Settings → OneStock API) and calls through the application proxy (/api/onestock).
 * The browser cannot call the OneStock API directly (CORS): the proxy function does it server side.
 */
export interface OnestockConfig {
  /** {{url}}, e.g. https://api.onestock-retail.com */
  url: string;
  /** {{site_id}} */
  siteId: string;
  /** {{token}} */
  token: string;
  method: 'GET' | 'POST';
  /** Default language of the labels (display_info), e.g. "fr". */
  language: string;
  /** Use the API for the category values of the rule criteria. */
  useForCategories: boolean;
  /** Use the API (endpoints) for the stock locations of the rules. */
  useForLocations: boolean;
  /** Use the API (v3/items) for the items (search, allocation pages, SKU criteria). */
  useForItems: boolean;
  /** {{stock_request}}: request_name of the stock_export call. */
  stockRequest: string;
  /** Read the item stock from the API (stock_export). */
  useForStock: boolean;
}

const KEY = 'stock-allocation:onestock-config';
export const DEFAULT_ONESTOCK_CONFIG: OnestockConfig = { url: '', siteId: '', token: '', method: 'GET', language: 'fr', useForCategories: true, useForLocations: true, useForItems: true, stockRequest: '', useForStock: true };

export function getOnestockConfig(): OnestockConfig {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULT_ONESTOCK_CONFIG, ...(JSON.parse(raw) as Partial<OnestockConfig>) };
  } catch {
    /* ignore */
  }
  return DEFAULT_ONESTOCK_CONFIG;
}

export function setOnestockConfig(config: OnestockConfig) {
  try {
    localStorage.setItem(KEY, JSON.stringify(config));
  } catch {
    /* ignore */
  }
  categoriesCache = undefined;
  endpointsCache = undefined;
  itemIndex = undefined;
  itemDetails.clear();
  stockCache.clear();
  stockTotals = undefined;
}

export const isOnestockConfigured = (c = getOnestockConfig()) => !!(c.url.trim() && c.siteId.trim() && c.token.trim());

/** Calls an OneStock endpoint through the proxy function. */
export async function callOnestock<T = unknown>(
  path: string,
  config = getOnestockConfig(),
  params?: Record<string, unknown>,
  method: 'GET' | 'POST' | 'PATCH' = config.method,
): Promise<T> {
  const proxy = getDbConfig();
  const base = proxy.apiUrl.replace(/\/+$/, '') || '/api';
  let res: Response;
  try {
    res = await fetch(`${base}/onestock`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(proxy.apiKey ? { 'x-api-key': proxy.apiKey } : {}) },
      body: JSON.stringify({ url: config.url.trim(), path, method, site_id: config.siteId.trim(), token: config.token.trim(), params }),
    });
  } catch {
    throw new Error(`Proxy unreachable (${base}/onestock)`);
  }
  const text = await res.text();
  let payload: { data?: T; error?: string } | undefined;
  try {
    payload = text ? JSON.parse(text) : undefined;
  } catch {
    throw new Error(`Unexpected answer from the proxy (HTTP ${res.status}): is the application API deployed?`);
  }
  if (!res.ok) throw new Error(payload?.error ?? `HTTP ${res.status}`);
  return payload?.data as T;
}

export interface Category {
  /** Value stored in the rule criteria. */
  id: string;
  label: string;
}

interface CategoryNode {
  id?: string | number;
  display_info?: Record<string, { name?: string } | undefined>;
  sub_category?: CategoryNode[];
}

/** Name in the default language, else the first available language, else the id. */
function nodeLabel(node: CategoryNode, language: string): string {
  const info = node.display_info ?? {};
  const name = info[language]?.name || Object.values(info).find((i) => i?.name)?.name;
  return name || String(node.id);
}

/**
 * Reads the OneStock category tree: { category: { id: "0", sub_category: [{ id, display_info: { fr: { name } }, sub_category? }] } }.
 * Every node below the root becomes a category; nested ones are labelled "Parent › Child".
 * Plain arrays of strings or of { id, name } objects are accepted too.
 */
export function parseCategories(data: unknown, language = getOnestockConfig().language): Category[] {
  const result: Category[] = [];
  const walk = (nodes: CategoryNode[] | undefined, parents: string[]) =>
    (nodes ?? []).forEach((node) => {
      if (node?.id === undefined) return;
      const label = nodeLabel(node, language);
      result.push({ id: String(node.id), label: [...parents, label].join(' › ') });
      walk(node.sub_category, [...parents, label]);
    });

  const root = (data as { category?: CategoryNode } | null)?.category;
  if (root && typeof root === 'object') walk(root.sub_category, []);
  else if (Array.isArray(data))
    data.forEach((c) => {
      if (typeof c === 'string' || typeof c === 'number') result.push({ id: String(c), label: String(c) });
      else if (c && typeof c === 'object') {
        const o = c as CategoryNode & { name?: string };
        if (o.id !== undefined) result.push({ id: String(o.id), label: o.name ?? nodeLabel(o, language) });
        walk(o.sub_category, [o.name ?? nodeLabel(o, language)]);
      }
    });
  else throw new Error('No category tree found in the answer (expected { category: { sub_category: [...] } })');

  const unique = new Map(result.map((c) => [c.id, c]));
  return [...unique.values()].sort((a, b) => a.label.localeCompare(b.label));
}

let categoriesCache: { at: number; list: Category[] } | undefined;
const CACHE_MS = 5 * 60 * 1000;

/** Categories from the OneStock API, cached 5 minutes. */
export async function fetchCategories(force = false): Promise<Category[]> {
  if (!force && categoriesCache && Date.now() - categoriesCache.at < CACHE_MS) return categoriesCache.list;
  const list = parseCategories(await callOnestock('/categories'));
  categoriesCache = { at: Date.now(), list };
  return list;
}

/** Label of a category value, from the last loaded list. */
export const categoryLabel = (id: string) => categoriesCache?.list.find((c) => c.id === id)?.label ?? id;

interface EndpointNode {
  id?: string;
  name?: string;
  address?: { city?: string; regions?: { country?: { code?: string } } };
}

/** Reads the stock locations of { endpoints: [{ id, name, address: { city, regions: { country: { code } } } }] }. */
export function parseEndpoints(data: unknown): StockLocation[] {
  const list = Array.isArray(data) ? data : (data as { endpoints?: unknown } | null)?.endpoints;
  if (!Array.isArray(list)) throw new Error('No endpoint list found in the answer (expected { endpoints: [...] })');
  const locations = (list as EndpointNode[])
    .filter((e) => e && e.id)
    .map((e) => ({
      id: String(e.id),
      code: String(e.id),
      name: e.name || String(e.id),
      city: e.address?.city || undefined,
      country: e.address?.regions?.country?.code || undefined,
    }));
  return [...new Map(locations.map((l) => [l.id, l])).values()].sort((a, b) => a.name.localeCompare(b.name));
}

let endpointsCache: { at: number; list: StockLocation[] } | undefined;

/** Stock locations (OneStock endpoints), cached 5 minutes. */
export async function fetchEndpoints(force = false): Promise<StockLocation[]> {
  if (!force && endpointsCache && Date.now() - endpointsCache.at < CACHE_MS) return endpointsCache.list;
  const list = parseEndpoints(await callOnestock('/endpoints'));
  endpointsCache = { at: Date.now(), list };
  return list;
}

// ---------------------------------------------------------------------------
// Items (v3/items)
// ---------------------------------------------------------------------------

const PAGE_SIZE = 25;
/** Upper bound of the item index loaded for the search completion. */
export const MAX_INDEXED_ITEMS = 5000;

interface ItemsPage {
  items?: Array<{ id?: string } & Record<string, unknown>>;
  pagination?: { limit?: number; search_after?: unknown[]; scroll_id?: string };
}

/** One page of item ids: { pagination: { limit, start } } or, when start is not honoured, { limit, search_after }. */
export async function fetchItemsPage(
  pagination: { limit: number; start?: number; search_after?: unknown[] },
  config = getOnestockConfig(),
): Promise<ItemsPage> {
  return callOnestock<ItemsPage>('/v3/items', config, { pagination });
}

let itemIndex: { at: number; ids: string[]; complete: boolean } | undefined;
let indexLoading: Promise<string[]> | undefined;
const INDEX_CACHE_MS = 10 * 60 * 1000;

/**
 * Every item id of the site (up to MAX_INDEXED_ITEMS), loaded page by page and cached 10 minutes.
 * Pages are requested with `start`; if the API ignores it (same ids again), `search_after` is used instead.
 */
export function fetchItemIndex(force = false): Promise<string[]> {
  if (!force && itemIndex && Date.now() - itemIndex.at < INDEX_CACHE_MS) return Promise.resolve(itemIndex.ids);
  if (indexLoading) return indexLoading;
  indexLoading = (async () => {
    const ids: string[] = [];
    const seen = new Set<string>();
    let start = 0;
    let searchAfter: unknown[] | undefined;
    let complete = false;
    while (ids.length < MAX_INDEXED_ITEMS) {
      const page = await fetchItemsPage(searchAfter ? { limit: PAGE_SIZE, search_after: searchAfter } : { limit: PAGE_SIZE, start });
      const pageIds = (page.items ?? []).map((i) => i.id).filter((id): id is string => !!id);
      const fresh = pageIds.filter((id) => !seen.has(id));
      if (pageIds.length && !fresh.length && !searchAfter && page.pagination?.search_after) {
        // `start` not honoured: continue from the last known id.
        searchAfter = [ids[ids.length - 1]];
        continue;
      }
      fresh.forEach((id) => {
        seen.add(id);
        ids.push(id);
      });
      if (pageIds.length < PAGE_SIZE || !fresh.length) {
        complete = true;
        break;
      }
      start += PAGE_SIZE;
      if (searchAfter) searchAfter = page.pagination?.search_after ?? [pageIds[pageIds.length - 1]];
    }
    itemIndex = { at: Date.now(), ids, complete };
    return ids;
  })().finally(() => (indexLoading = undefined));
  return indexLoading;
}

export const itemIndexComplete = () => itemIndex?.complete ?? false;

type FeatureValue = string | number | boolean | null;
interface ItemNode {
  id?: string;
  features?: Record<string, Record<string, FeatureValue[] | FeatureValue> | undefined>;
}

const firstValue = (v: FeatureValue[] | FeatureValue | undefined): string => {
  const x = Array.isArray(v) ? v[0] : v;
  return x === null || x === undefined ? '' : String(x).trim();
};

/** Maps a v3/items entry to an Item, features read in the default language (fallback: first language). */
export function parseItem(node: ItemNode, language = getOnestockConfig().language): Item {
  const id = String(node.id);
  const byLang = node.features ?? {};
  const f = byLang[language] ?? Object.values(byLang).find(Boolean) ?? {};
  const features = Object.fromEntries(
    Object.entries(f)
      .map(([k, v]) => [k, Array.isArray(v) ? v.map((x) => String(x ?? '').trim()).filter(Boolean).join(', ') : firstValue(v)] as const)
      .filter(([, v]) => v !== ''),
  );
  const get = (...keys: string[]) => keys.map((k) => firstValue(f[k])).find(Boolean) ?? '';
  return {
    id,
    sku: id,
    name: get('name', 'title', 'designation') || id,
    category: get('category', 'categories'),
    brand: get('brand', 'marque'),
    season: get('season', 'season_code'),
    price: Number(get('price')) || 0,
    specs: [get('designation', 'size')].filter(Boolean),
    imageUrl: get('image', 'big_images') || undefined,
    description: get('description') || undefined,
    features,
    source: 'onestock',
  };
}

const itemDetails = new Map<string, Item>();

/** Item details by id (item_ids), cached; unknown ids come back as minimal items. */
export async function fetchItemDetails(ids: string[]): Promise<Item[]> {
  const missing = [...new Set(ids.filter((id) => !itemDetails.has(id)))];
  for (let i = 0; i < missing.length; i += PAGE_SIZE) {
    const batch = missing.slice(i, i + PAGE_SIZE);
    const page = await callOnestock<ItemsPage>('/v3/items', getOnestockConfig(), {
      item_ids: batch,
      pagination: { limit: batch.length, start: 0 },
    });
    (page.items ?? []).forEach((node) => node.id && itemDetails.set(String(node.id), parseItem(node as ItemNode)));
  }
  return ids.map((id) => itemDetails.get(id) ?? minimalItem(id));
}

/** Item known only by its id (details not loaded, or not found). */
export const minimalItem = (id: string): Item => ({
  id,
  sku: id,
  name: id,
  category: '',
  brand: '',
  season: '',
  price: 0,
  specs: [],
  source: 'onestock',
});

export const cachedItem = (id: string) => itemDetails.get(id);

export const useOnestockItems = (c = getOnestockConfig()) => c.useForItems && isOnestockConfigured(c);

// ---------------------------------------------------------------------------
// Stock (stock_export)
// ---------------------------------------------------------------------------

/** One record of stock_export: quantity of an item, in an endpoint, on a stock type (segment). */
export interface StockRecord {
  item_id: string;
  endpoint_id: string;
  quantity: number;
  /** Stock type code, main type (on_hand, Container…) or group (on_hand_A, Container_B…). */
  type: string;
  eta_start?: number;
  eta_end?: number;
  purchase_order_number?: string;
}

const STOCK_BATCH = 50;
const STOCK_CACHE_MS = 2 * 60 * 1000;
const stockCache = new Map<string, { at: number; records: StockRecord[] }>();

export const useOnestockStock = (c = getOnestockConfig()) => c.useForStock && isOnestockConfigured(c);

/** stock_export for some items: { request_name, item_filter: { ids } }, by batches, cached 2 minutes per item. */
export async function fetchStock(itemIds: string[], config = getOnestockConfig(), force = false): Promise<StockRecord[]> {
  const now = Date.now();
  const missing = [...new Set(itemIds)].filter((id) => force || !stockCache.has(id) || now - stockCache.get(id)!.at > STOCK_CACHE_MS);
  for (let i = 0; i < missing.length; i += STOCK_BATCH) {
    const batch = missing.slice(i, i + STOCK_BATCH);
    const data = await callOnestock<{ stocks?: StockRecord[] }>('/stock_export', config, {
      ...(config.stockRequest.trim() ? { request_name: config.stockRequest.trim() } : {}),
      item_filter: { ids: batch },
    });
    const byItem = new Map<string, StockRecord[]>(batch.map((id) => [id, []]));
    (data?.stocks ?? []).forEach((r) => {
      if (!r || !r.item_id) return;
      if (!byItem.has(r.item_id)) byItem.set(r.item_id, []);
      byItem.get(r.item_id)!.push({ ...r, quantity: Number(r.quantity) || 0 });
    });
    byItem.forEach((records, id) => stockCache.set(id, { at: now, records }));
  }
  return itemIds.flatMap((id) => stockCache.get(id)?.records ?? []);
}

let stockTotals: { at: number; totals: Map<string, number>; key: string } | undefined;

/**
 * Total stock by item, for ordering the item list (items with stock first).
 * One stock_export call without item_filter (the whole export of {{stock_request}}); if the API refuses it,
 * falls back to item_filter batches over the given ids. Results also fill the per-item stock cache.
 */
export async function fetchStockTotals(itemIds: string[], config = getOnestockConfig()): Promise<Map<string, number>> {
  const key = [config.url, config.siteId, config.stockRequest].join('|');
  if (stockTotals && stockTotals.key === key && Date.now() - stockTotals.at < STOCK_CACHE_MS) return stockTotals.totals;
  let records: StockRecord[];
  try {
    const data = await callOnestock<{ stocks?: StockRecord[] }>('/stock_export', config, {
      ...(config.stockRequest.trim() ? { request_name: config.stockRequest.trim() } : {}),
    });
    if (!Array.isArray(data?.stocks)) throw new Error('No stocks in the answer');
    records = data.stocks.map((r) => ({ ...r, quantity: Number(r.quantity) || 0 }));
    const now = Date.now();
    const byItem = new Map<string, StockRecord[]>(itemIds.map((id) => [id, []]));
    records.forEach((r) => r.item_id && (byItem.get(r.item_id) ?? byItem.set(r.item_id, []).get(r.item_id)!).push(r));
    byItem.forEach((list, id) => stockCache.set(id, { at: now, records: list }));
  } catch {
    records = await fetchStock(itemIds, config);
  }
  const totals = new Map<string, number>();
  records.forEach((r) => totals.set(r.item_id, (totals.get(r.item_id) ?? 0) + r.quantity));
  stockTotals = { at: Date.now(), totals, key };
  return totals;
}

/** One line of stock_import: absolute quantity of an item, in an endpoint, on a stock type (segment). */
export interface StockImportRecord {
  item_id: string;
  endpoint_id: string;
  quantity: number;
  type: string;
  purchase_order_number?: string;
  eta_start?: number;
  eta_end?: number;
}

const IMPORT_BATCH = 500;

/** PATCH stock_import by batches, then forgets the cached stock of these items. */
export async function pushStock(records: StockImportRecord[], config = getOnestockConfig()): Promise<{ sent: number; calls: number }> {
  let calls = 0;
  for (let i = 0; i < records.length; i += IMPORT_BATCH) {
    await callOnestock(
      '/stock_import',
      config,
      // Always a non incremental import: the quantities sent are absolute.
      { import: { incremental: false }, stocks: records.slice(i, i + IMPORT_BATCH) },
      'PATCH',
    );
    calls++;
  }
  invalidateStock(records.map((r) => r.item_id));
  return { sent: records.length, calls };
}

export function invalidateStock(itemIds: string[]) {
  itemIds.forEach((id) => stockCache.delete(id));
  stockTotals = undefined;
}
