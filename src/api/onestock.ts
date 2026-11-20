import type { Item, StockLocation } from '../types';
import { logApiCall } from './apiLog';
import { notifyBackgroundUpdate, persisted } from './background';
import { getDbConfig } from './dbConfig';
import { remoteRules } from './remoteRules';
import {
  categoryParentMap,
  parseCategories as parseCategoryTree,
  parseItemNode,
  setCategoryParents,
  type Category,
  type ItemNode as SharedItemNode,
  type StockImportRecord,
  type StockRecord,
} from '../../api/_lib/segmentation.js';

/**
 * OneStock API settings (Settings → OneStock API) and calls through the application proxy (/api/onestock).
 * The browser cannot call the OneStock API directly (CORS): the proxy function does it server side.
 */
export interface OnestockConfig {
  /** {{url}}, e.g. https://api.onestock-retail.com */
  url: string;
  /** {{site_id}} */
  siteId: string;
  /**
   * OneStock user of the context (site ID × environment URL), saved in the database with its password: the proxy
   * logs in with them (POST /login) to get the token. Read from the database, the password never comes back.
   */
  loginUser: string;
  /** A user / password is saved in the database for this site and environment. */
  loginSaved: boolean;
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
export const DEFAULT_ONESTOCK_CONFIG: OnestockConfig = { url: '', siteId: '', loginUser: '', loginSaved: false, method: 'GET', language: 'fr', useForCategories: true, useForLocations: true, useForItems: true, stockRequest: '', useForStock: true };

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
  try {
    localStorage.removeItem(DETAILS_KEY);
  } catch {
    /* ignore */
  }
  stockCache.clear();
  stockTotals = undefined;
}

/** The OneStock API can be called: environment, site and a login saved in the database for them. */
export const isOnestockConfigured = (c = getOnestockConfig()) =>
  !!(c.url.trim() && c.siteId.trim() && c.loginSaved && getDbConfig().mode === 'remote');

/** Key of an environment (same as the server): API URL without trailing slash, lower case. */
export const envKey = (url: string) => url.trim().replace(/\/+$/, '').toLowerCase();

/** Calls an OneStock endpoint through the proxy function. */
export async function callOnestock<T = unknown>(
  path: string,
  config = getOnestockConfig(),
  params?: Record<string, unknown>,
  method: 'GET' | 'POST' | 'PATCH' = config.method,
): Promise<T> {
  const proxy = getDbConfig();
  const base = proxy.apiUrl.replace(/\/+$/, '') || '/api';
  const started = performance.now();
  const request = { site_id: config.siteId.trim(), ...(params ?? {}) };
  const log = (entry: { ok: boolean; status?: number; response?: unknown; error?: string }) =>
    logApiCall({
      at: Date.now(),
      target: 'OneStock',
      method,
      path: `${config.url.trim().replace(/\/+$/, '')}${path}`,
      request,
      durationMs: Math.round(performance.now() - started),
      ...entry,
    });
  let res: Response;
  try {
    res = await fetch(`${base}/onestock`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(proxy.apiKey ? { 'x-api-key': proxy.apiKey } : {}) },
      body: JSON.stringify({ url: config.url.trim(), path, method, site_id: config.siteId.trim(), params }),
    });
  } catch {
    const error = `Proxy unreachable (${base}/onestock)`;
    log({ ok: false, error });
    throw new Error(error);
  }
  const text = await res.text();
  let payload: { data?: T; error?: string } | undefined;
  try {
    payload = text ? JSON.parse(text) : undefined;
  } catch {
    const error = `Unexpected answer from the proxy (HTTP ${res.status}): is the application API deployed?`;
    log({ ok: false, status: res.status, error, response: text.slice(0, 2000) });
    throw new Error(error);
  }
  if (!res.ok) {
    const error = payload?.error ?? `HTTP ${res.status}`;
    log({ ok: false, status: res.status, error });
    throw new Error(error);
  }
  log({ ok: true, status: res.status, response: payload?.data });
  return payload?.data as T;
}

export type { Category } from '../../api/_lib/segmentation.js';

/** Reads the OneStock category tree (labels in the default language). */
export const parseCategories = (data: unknown, language = getOnestockConfig().language): Category[] => parseCategoryTree(data, language);

let categoriesCache: { at: number; list: Category[] } | undefined;
const CACHE_MS = 5 * 60 * 1000;

/** Categories from the OneStock API, cached 5 minutes. */
/** Context of the cached OneStock data: environment, site, language. */
const cacheContext = (c = getOnestockConfig()) => [envKey(c.url), c.siteId.trim(), c.language].join('|');

/**
 * Stale-while-revalidate: the value in memory or kept in the browser is returned at once; when it is older than
 * maxAge it is refreshed in the background, and the screens reload if it changed.
 * Nothing known yet: the value is loaded (the only case where the caller waits for OneStock).
 */
async function swr<T>(
  name: string,
  memory: { get: () => { at: number; value: T } | undefined; set: (v: { at: number; value: T }) => void },
  maxAge: number,
  load: () => Promise<T>,
  force = false,
): Promise<T> {
  const store = persisted<T>(name);
  const context = cacheContext();
  let current = memory.get();
  if (!current) {
    current = store.get(context);
    if (current) memory.set(current);
  }
  const refresh = () =>
    shared(name, async () => {
      const value = await load();
      const next = { at: Date.now(), value };
      memory.set(next);
      store.set(context, value, next.at);
      return value;
    });
  if (force || !current) return refresh();
  if (Date.now() - current.at > maxAge) {
    const before = JSON.stringify(current.value);
    refresh()
      .then((v) => JSON.stringify(v) !== before && notifyBackgroundUpdate())
      .catch(() => undefined);
  }
  return current.value;
}

/** Same call already running: its promise is shared instead of calling OneStock twice. */
const inflight = new Map<string, Promise<unknown>>();
function shared<T>(key: string, load: () => Promise<T>): Promise<T> {
  const running = inflight.get(key) as Promise<T> | undefined;
  if (running) return running;
  const p = load().finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

export async function fetchCategories(force = false): Promise<Category[]> {
  return swr(
    'categories',
    {
      get: () => (categoriesCache ? { at: categoriesCache.at, value: categoriesCache.list } : undefined),
      set: (v) => {
        categoriesCache = { at: v.at, list: v.value };
        // A rule on a category also matches the items of its sub-categories.
        setCategoryParents(categoryParentMap(v.value));
      },
    },
    CACHE_MS,
    async () => parseCategories(await callOnestock('/categories')),
    force,
  );
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
  return swr(
    'endpoints',
    {
      get: () => (endpointsCache ? { at: endpointsCache.at, value: endpointsCache.list } : undefined),
      set: (v) => (endpointsCache = { at: v.at, list: v.value }),
    },
    CACHE_MS,
    async () => parseEndpoints(await callOnestock('/endpoints')),
    force,
  );
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
const INDEX_CACHE_MS = 10 * 60 * 1000;

/**
 * Every item id of the site (up to MAX_INDEXED_ITEMS), loaded page by page and cached 10 minutes.
 * Pages are requested with `start`; if the API ignores it (same ids again), `search_after` is used instead.
 */
export function fetchItemIndex(force = false): Promise<string[]> {
  return swr(
    'item-index',
    {
      get: () => (itemIndex ? { at: itemIndex.at, value: { ids: itemIndex.ids, complete: itemIndex.complete } } : undefined),
      set: (v) => (itemIndex = { at: v.at, ...v.value }),
    },
    INDEX_CACHE_MS,
    loadItemIndex,
    force,
  ).then((v) => v.ids);
}

/** Ids read so far by the index being loaded (first visit: the list can be shown before the end). */
let indexSoFar: string[] = [];

/** Item ids known now: the whole index, or the pages read so far while it is loading. */
export const itemIndexSoFar = (): string[] => itemIndex?.ids ?? indexSoFar;

/** Every item id of the site, page by page. */
async function loadItemIndex(): Promise<{ ids: string[]; complete: boolean }> {
  const ids: string[] = [];
  indexSoFar = ids;
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
  return { ids, complete };
}

export const itemIndexComplete = () => itemIndex?.complete ?? false;

type ItemNode = SharedItemNode;

/** Maps a v3/items entry to an Item (category_ids, features in the default language). */
export const parseItem = (node: ItemNode, language = getOnestockConfig().language): Item => parseItemNode(node, language);

const itemDetails = new Map<string, Item>();
const DETAIL_BATCH = 25;
const DETAIL_CONCURRENCY = 4;
const DETAILS_KEY = 'stock-allocation:onestock-items:v2';
const DETAILS_CACHE_MS = 60 * 60 * 1000;

/** Compact details kept in the browser (1 hour) so that the whole catalog is not reloaded at each visit. */
function loadCompactDetails() {
  try {
    const raw = localStorage.getItem(DETAILS_KEY);
    if (!raw) return;
    const saved = JSON.parse(raw) as { key: string; at: number; items: Item[] };
    const c = getOnestockConfig();
    if (saved.key !== `${c.url}|${c.siteId}|${c.language}` || Date.now() - saved.at > DETAILS_CACHE_MS) return;
    saved.items.forEach((i) => itemDetails.set(i.id, i));
  } catch {
    /* ignore */
  }
}
function saveCompactDetails() {
  try {
    const c = getOnestockConfig();
    const items = [...itemDetails.values()].map(({ features: _f, description: _d, ...compact }) => compact);
    localStorage.setItem(DETAILS_KEY, JSON.stringify({ key: `${c.url}|${c.siteId}|${c.language}`, at: Date.now(), items }));
  } catch {
    /* quota: keep the memory cache only */
  }
}
loadCompactDetails();

/**
 * Item details by id: GET v3/items with { item_ids } (no pagination, as in the API contract), by batches of 25,
 * 4 calls at a time, cached. Unknown ids come back as minimal items.
 */
/** Items whose details are being read: a second request for them waits for the first one. */
const detailsLoading = new Map<string, Promise<void>>();

export async function fetchItemDetails(ids: string[]): Promise<Item[]> {
  const unique = [...new Set(ids)];
  const waiting = [...new Set(unique.filter((id) => !itemDetails.has(id) && detailsLoading.has(id)).map((id) => detailsLoading.get(id)!))];
  const missing = unique.filter((id) => !itemDetails.has(id) && !detailsLoading.has(id));
  if (missing.length) {
    const batches: string[][] = [];
    for (let i = 0; i < missing.length; i += DETAIL_BATCH) batches.push(missing.slice(i, i + DETAIL_BATCH));
    const run = async () => {
      for (let batch = batches.shift(); batch; batch = batches.shift()) {
        const page = await callOnestock<ItemsPage>('/v3/items', getOnestockConfig(), { item_ids: batch });
        (page.items ?? []).forEach((node) => {
          if (!node.id) return;
          itemDetails.set(String(node.id), parseItem(node as ItemNode));
        });
      }
    };
    const loading = Promise.all(Array.from({ length: Math.min(DETAIL_CONCURRENCY, batches.length) }, run)).then(() => saveCompactDetails());
    missing.forEach((id) => detailsLoading.set(id, loading));
    try {
      await loading;
    } finally {
      missing.forEach((id) => detailsLoading.get(id) === loading && detailsLoading.delete(id));
    }
  }
  await Promise.all(waiting);
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

/** "Name (id)" of an item when its details are known, else its id. */
export function skuLabel(id: string): string {
  const item = itemDetails.get(id);
  return item && item.name && item.name !== id ? `${item.name} (${id})` : id;
}

export const useOnestockItems = (c = getOnestockConfig()) => c.useForItems && isOnestockConfigured(c);

// ---------------------------------------------------------------------------
// Stock (stock_export)
// ---------------------------------------------------------------------------

/** One record of stock_export: quantity of an item, in an endpoint, on a stock type (segment). */
export type { StockRecord, StockImportRecord } from '../../api/_lib/segmentation.js';

const STOCK_BATCH = 50;
const STOCK_CONCURRENCY = 4;
const STOCK_CACHE_MS = 2 * 60 * 1000;
const stockCache = new Map<string, { at: number; records: StockRecord[] }>();
let lastStockRead: number | undefined;

/** When the stock was last read from OneStock (ms), for display. */
export const stockReadAt = () => lastStockRead;

/** Forgets every cached stock: the next display reads OneStock again. */
export function refreshAllStock() {
  stockCache.clear();
  stockTotals = undefined;
}

export const useOnestockStock = (c = getOnestockConfig()) => c.useForStock && isOnestockConfigured(c);

/** stock_export for some items: { request_name, item_filter: { ids } }, by batches, cached 2 minutes per item. */
/** Items whose stock is being read: a second request for them waits for the first one. */
const stockLoading = new Map<string, Promise<void>>();

export async function fetchStock(itemIds: string[], config = getOnestockConfig(), force = false): Promise<StockRecord[]> {
  const now = Date.now();
  const unique = [...new Set(itemIds)];
  const waiting = force ? [] : unique.filter((id) => stockLoading.has(id)).map((id) => stockLoading.get(id)!);
  const missing = unique.filter(
    (id) => (force || !stockLoading.has(id)) && (force || !stockCache.has(id) || now - stockCache.get(id)!.at > STOCK_CACHE_MS),
  );
  const batches: string[][] = [];
  for (let i = 0; i < missing.length; i += STOCK_BATCH) batches.push(missing.slice(i, i + STOCK_BATCH));
  const loadBatch = async (batch: string[]) => {
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
    lastStockRead = now;
  };
  // Batches read STOCK_CONCURRENCY at a time.
  const queue = [...batches];
  const running = Promise.all(
    Array.from({ length: Math.min(STOCK_CONCURRENCY, queue.length) }, async () => {
      for (let b = queue.shift(); b; b = queue.shift()) await loadBatch(b);
    }),
  ).then(() => undefined);
  missing.forEach((id) => stockLoading.set(id, running));
  try {
    await Promise.all([running, ...waiting]);
  } finally {
    missing.forEach((id) => stockLoading.get(id) === running && stockLoading.delete(id));
  }
  return itemIds.flatMap((id) => stockCache.get(id)?.records ?? []);
}

let stockTotals: { at: number; totals: Map<string, number>; key: string } | undefined;

/**
 * Total stock by item, for ordering the item list (items with stock first).
 * One stock_export call without item_filter (the whole export of {{stock_request}}); if the API refuses it,
 * falls back to item_filter batches over the given ids. Used for ordering only, never for displayed quantities.
 */
export async function fetchStockTotals(itemIds: string[], config = getOnestockConfig()): Promise<Map<string, number>> {
  const sum = (records: StockRecord[]) => {
    const totals = new Map<string, number>();
    records.forEach((r) => totals.set(r.item_id, (totals.get(r.item_id) ?? 0) + r.quantity));
    return totals;
  };
  // Small lists (e.g. a search): exact totals with item_filter calls.
  if (itemIds.length <= EXACT_TOTALS_MAX) return sum(await fetchStock(itemIds, config));
  const key = [config.url, config.siteId, config.stockRequest].join('|');
  // Totals of the whole site (one export): shown from the browser copy, refreshed in the background.
  const entries = await swr<Array<[string, number]>>(
    `stock-totals|${config.stockRequest}`,
    {
      get: () => (stockTotals && stockTotals.key === key ? { at: stockTotals.at, value: [...stockTotals.totals] } : undefined),
      set: (v) => (stockTotals = { at: v.at, totals: new Map(v.value), key }),
    },
    STOCK_CACHE_MS,
    async () => [...sum(await exportRecords(itemIds, config))],
  );
  // Stock already read item by item (exact) wins over the export.
  const totals = new Map(entries);
  stockCache.forEach((entry, id) => {
    if (Date.now() - entry.at < STOCK_CACHE_MS) totals.set(id, entry.records.reduce((t, r) => t + r.quantity, 0));
  });
  return totals;
}

const EXACT_TOTALS_MAX = 250;

/** Whole export (no item_filter), or item_filter batches when the API refuses it. */
async function exportRecords(itemIds: string[], config: OnestockConfig): Promise<StockRecord[]> {
  let records: StockRecord[];
  try {
    const data = await callOnestock<{ stocks?: StockRecord[] }>('/stock_export', config, {
      ...(config.stockRequest.trim() ? { request_name: config.stockRequest.trim() } : {}),
    });
    if (!Array.isArray(data?.stocks)) throw new Error('No stocks in the answer');
    // Only used for the order of the list: the quantities displayed always come from item_filter calls.
    records = data.stocks.map((r) => ({ ...r, quantity: Number(r.quantity) || 0 }));
  } catch {
    records = await fetchStock(itemIds, config);
  }
  return records;
}

/** One line of stock_import: stock variation of an item, in an endpoint, on a stock type (segment). */
const IMPORT_BATCH = 500;

/** PATCH stock_import by batches, then forgets the cached stock of these items. */
export async function pushStock(records: StockImportRecord[], config = getOnestockConfig()): Promise<{ sent: number; calls: number }> {
  let calls = 0;
  for (let i = 0; i < records.length; i += IMPORT_BATCH) {
    await callOnestock(
      '/stock_import',
      config,
      // Incremental import: the quantities sent are variations added to the current stock.
      { import: { incremental: true }, stocks: records.slice(i, i + IMPORT_BATCH) },
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

// ---------------------------------------------------------------------------
// Settings shared by the users of a site (database, per site_id)
// ---------------------------------------------------------------------------

/**
 * Options shared through the database: everything but the site_id (the key of the site) and the login,
 * which is saved apart (secrets, by environment) and whose password is never read back by the browser.
 */
export function sharedOnestockSettings(config: OnestockConfig): Record<string, unknown> {
  const { siteId: _site, loginUser: _user, loginSaved: _saved, ...shared } = config;
  return shared;
}

const sharingEnabled = (config: OnestockConfig) => getDbConfig().mode === 'remote' && !!config.siteId.trim();

/**
 * Saves the shared OneStock options of the site in the database, and the login of the environment when a user is
 * given (an empty password keeps the saved one).
 */
export async function publishOnestockSettings(config = getOnestockConfig(), login?: { user: string; password: string }): Promise<boolean> {
  if (!sharingEnabled(config)) return false;
  const secrets = login?.user.trim() && config.url.trim() ? { onestockLogin: { url: config.url.trim(), user: login.user.trim(), password: login.password } } : undefined;
  const answer = await remoteRules.saveSiteSettings({ onestock: sharedOnestockSettings(config), ...(secrets ? { secrets } : {}) });
  applySharedOnestockSettings(answer.settings?.onestock, answer.logins);
  return true;
}

/** Tests a OneStock login (the given user / password, or the saved ones): resolves when /login answers a token. */
export async function testOnestockLogin(config: OnestockConfig, login?: { user: string; password: string }): Promise<string> {
  const proxy = getDbConfig();
  const base = proxy.apiUrl.replace(/\/+$/, '') || '/api';
  const res = await fetch(`${base}/onestock`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(proxy.apiKey ? { 'x-api-key': proxy.apiKey } : {}) },
    body: JSON.stringify({ url: config.url.trim(), path: '/login', site_id: config.siteId.trim(), ...(login?.password ? login : {}) }),
  });
  const payload = (await res.json().catch(() => undefined)) as { data?: { user?: string }; error?: string } | undefined;
  if (!res.ok) throw new Error(payload?.error ?? `HTTP ${res.status}`);
  return payload?.data?.user ?? '';
}

/** Loads the shared OneStock options of the site from the database into this computer's settings. */
export async function loadSharedOnestockSettings(): Promise<{ loaded: boolean; updatedAt?: string | null }> {
  const current = getOnestockConfig();
  if (!sharingEnabled(current)) return { loaded: false };
  const { settings, updatedAt, logins } = await remoteRules.getSiteSettings();
  return { loaded: applySharedOnestockSettings(settings?.onestock, logins), updatedAt };
}

/** Applies the OneStock options read from the database (site settings) to this computer's settings. */
export function applySharedOnestockSettings(shared: Record<string, unknown> | undefined, logins: Array<{ url: string; user: string }> = []): boolean {
  if (!shared && !logins.length) return false;
  const current = getOnestockConfig();
  const merged = { ...current, ...((shared ?? {}) as Partial<OnestockConfig>), siteId: current.siteId };
  // Login of the environment of the site (the password stays on the server).
  const login = logins.find((l) => l.url === envKey(merged.url));
  const next = { ...merged, loginUser: login?.user ?? '', loginSaved: !!login };
  if (JSON.stringify(next) !== JSON.stringify(current)) setOnestockConfig(next);
  return true;
}
