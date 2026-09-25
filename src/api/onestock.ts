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
}

const KEY = 'stock-allocation:onestock-config';
export const DEFAULT_ONESTOCK_CONFIG: OnestockConfig = { url: '', siteId: '', token: '', method: 'GET', language: 'fr', useForCategories: true };

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
}

export const isOnestockConfigured = (c = getOnestockConfig()) => !!(c.url.trim() && c.siteId.trim() && c.token.trim());

/** Calls an OneStock endpoint through the proxy function. */
export async function callOnestock<T = unknown>(path: string, config = getOnestockConfig()): Promise<T> {
  const proxy = getDbConfig();
  const base = proxy.apiUrl.replace(/\/+$/, '') || '/api';
  let res: Response;
  try {
    res = await fetch(`${base}/onestock`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(proxy.apiKey ? { 'x-api-key': proxy.apiKey } : {}) },
      body: JSON.stringify({ url: config.url.trim(), path, method: config.method, site_id: config.siteId.trim(), token: config.token.trim() }),
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
