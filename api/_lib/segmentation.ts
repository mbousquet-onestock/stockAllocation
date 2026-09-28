/**
 * Segmentation logic shared by the browser application (src/) and the serverless functions (api/):
 * rule matching, percentage split, stock type hierarchy, OneStock items / categories / stock records.
 * Pure TypeScript without dependencies, so both sides apply the rules exactly the same way.
 * (Imports use the `.js` extension: required by the Node ESM runtime of Vercel, resolved to `.ts` by Vite.)
 */
import type { AttributeKey, Criterion, Item, SegmentationRule, StockLine, StockType } from '../../src/types.js';

// ---------------------------------------------------------------------------
// Rules
// ---------------------------------------------------------------------------

export const normalizeText = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();
const norm = normalizeText;

/** Parent id of each OneStock category (from /categories), so that a rule on a category also matches its sub-categories. */
let categoryParents = new Map<string, string>();

export function setCategoryParents(parents: Map<string, string>) {
  categoryParents = parents;
}

/** Categories of an item and all their ancestors. */
function categoryValues(item: Item): string[] {
  const own = item.categories?.length ? item.categories : item.category ? [item.category] : [];
  const all = new Set<string>();
  own.forEach((c) => {
    for (let id: string | undefined = c, depth = 0; id && !all.has(id) && depth < 50; id = categoryParents.get(id), depth++) all.add(id);
  });
  return [...all];
}

/** Values of an item characteristic a rule criterion is compared with. */
export function itemValues(item: Item, key: AttributeKey): string[] {
  if (key === 'category') return categoryValues(item);
  const v = item[key];
  return v ? [v] : [];
}

/** All criteria must match; inside a criterion any value matches. No criterion: every item matches. */
export function matchesCriteria(item: Item, criteria: Criterion[]): boolean {
  if (!criteria.length) return true;
  return criteria.every((c) => {
    if (!c.values.length) return false;
    const values = new Set(itemValues(item, c.attribute).map(norm));
    return c.values.some((v) => values.has(norm(v)));
  });
}

export const appliesToLocation = (rule: SegmentationRule, locationId: string) =>
  rule.locationIds.length === 0 || rule.locationIds.includes(locationId);

export const appliesToPurchaseOrder = (rule: SegmentationRule, po: string | null) =>
  rule.purchaseOrders.length === 0 || (po !== null && rule.purchaseOrders.some((p) => norm(p) === norm(po)));

export const appliesToStockType = (rule: SegmentationRule, stockTypeId: string) =>
  rule.stockTypeIds.length === 0 || rule.stockTypeIds.includes(stockTypeId);

export const byPriority = (a: SegmentationRule, b: SegmentationRule) => a.priority - b.priority;

export type LineKey = Pick<StockLine, 'locationId' | 'stockTypeId' | 'purchaseOrder'>;

/** Does the rule apply to this item's stock line? */
export const ruleMatchesLine = (rule: SegmentationRule, item: Item, line: LineKey) =>
  rule.enabled &&
  appliesToStockType(rule, line.stockTypeId) &&
  matchesCriteria(item, rule.criteria) &&
  appliesToLocation(rule, line.locationId) &&
  appliesToPurchaseOrder(rule, line.purchaseOrder);

/** The rule used when this stock line is updated: first enabled matching rule by priority. */
export function effectiveRule(rules: SegmentationRule[], item: Item, line: LineKey): SegmentationRule | undefined {
  return [...rules].sort(byPriority).find((r) => ruleMatchesLine(r, item, line));
}

// ---------------------------------------------------------------------------
// Split
// ---------------------------------------------------------------------------

/**
 * Splits a quantity onto groups by percentage: floor(quantity * pct / 100) per group, and floor for the share left on
 * the main (default) stock type (100 − Σ pct). The rounding rest always goes up on the segment with the highest
 * percentage, which may be the main stock type itself (a group wins a tie).
 * E.g. 25 at A 50 % / B 30 % (main 20 %): 12.5 / 7.5 / 5 → A 13 / B 7 / main 5;
 *      25 at A 30 % / B 20 % (main 50 %): 7.5 / 5 / 12.5 → A 7 / B 5 / main 13.
 */
export function computeSplit(quantity: number, shares: Record<string, number>, groupIds: string[]): Record<string, number> {
  const pct = (id: string) => Math.max(0, shares[id] ?? 0);
  const total = Math.min(100, groupIds.reduce((s, id) => s + pct(id), 0));
  let left = quantity;
  const split: Record<string, number> = Object.fromEntries(
    groupIds.map((id) => {
      const q = Math.min(left, Math.floor((quantity * pct(id)) / 100));
      left -= q;
      return [id, q];
    }),
  );
  const onMain = Math.min(left, Math.floor((quantity * (100 - total)) / 100));
  const rest = left - onMain;
  const top = groupIds.reduce<string | undefined>((best, id) => (pct(id) > 0 && (!best || pct(id) > pct(best)) ? id : best), undefined);
  // The main stock type keeps the rest when its own share is the largest (or when no group has a share).
  if (top && rest > 0 && pct(top) >= 100 - total) split[top] += rest;
  return split;
}

/**
 * Incremental import: only the variation is segmented and added to the current segments, which are not re-split.
 * + variation: split by the rule (no rule: all on the main stock type) and added.
 * − variation: split the same way and removed; what a segment lacks is taken from the other segments,
 *   the largest share first (no rule: from the main stock type first).
 */
export function applyVariationToLine(line: StockLine, delta: number, rule: SegmentationRule | undefined, tree: StockTypeTree): StockLine {
  const groupIds = tree.groupsOf(line.stockTypeId).map((g) => g.id);
  const MAIN = '';
  const current: Record<string, number> = Object.fromEntries(groupIds.map((id) => [id, line.split[id]?.quantity ?? 0]));
  current[MAIN] = line.quantity - groupIds.reduce((s, id) => s + current[id], 0);
  const amount = Math.abs(delta);
  const parts: Record<string, number> = rule ? computeSplit(amount, rule.shares, groupIds) : Object.fromEntries(groupIds.map((id) => [id, 0]));
  parts[MAIN] = amount - groupIds.reduce((s, id) => s + (parts[id] ?? 0), 0);
  const next = { ...current };
  if (delta >= 0) Object.keys(parts).forEach((k) => (next[k] += parts[k]));
  else {
    let missing = 0;
    Object.keys(parts).forEach((k) => {
      next[k] -= parts[k];
      if (next[k] < 0) {
        missing -= next[k];
        next[k] = 0;
      }
    });
    const share = (k: string) =>
      rule ? (k === MAIN ? 100 - groupIds.reduce((s, id) => s + Math.max(0, rule.shares[id] ?? 0), 0) : Math.max(0, rule.shares[k] ?? 0)) : k === MAIN ? 1 : 0;
    for (const k of Object.keys(next).sort((a, b) => share(b) - share(a))) {
      const take = Math.min(missing, next[k]);
      next[k] -= take;
      missing -= take;
    }
  }
  return {
    ...line,
    quantity: line.quantity + delta,
    split: Object.fromEntries(groupIds.map((id) => [id, { quantity: next[id], threshold: rule?.thresholds[id] ?? line.split[id]?.threshold ?? null }])),
    ...(rule ? { source: { type: 'rule' as const, ruleId: rule.id }, period: rule.period } : {}),
  };
}

/** Splits a stock line with a rule. */
export function applyRuleToLine(line: StockLine, rule: SegmentationRule, tree: StockTypeTree): StockLine {
  const groupIds = tree.groupsOf(line.stockTypeId).map((g) => g.id);
  const quantities = computeSplit(line.quantity, rule.shares, groupIds);
  return {
    ...line,
    period: rule.period,
    split: Object.fromEntries(groupIds.map((id) => [id, { quantity: quantities[id], threshold: rule.thresholds[id] ?? null }])),
    source: { type: 'rule', ruleId: rule.id },
  };
}

// ---------------------------------------------------------------------------
// Stock types
// ---------------------------------------------------------------------------

const byPosition = (a: StockType, b: StockType) => a.position - b.position;

/** Helpers over the stock type hierarchy (main types → groups). */
export class StockTypeTree {
  readonly all: StockType[];
  constructor(types: StockType[]) {
    this.all = [...types].sort(byPosition);
  }
  get mainTypes(): StockType[] {
    return this.all.filter((t) => t.parentId === null);
  }
  groupsOf(typeId: string): StockType[] {
    return this.all.filter((t) => t.parentId === typeId);
  }
  byId(id: string): StockType | undefined {
    return this.all.find((t) => t.id === id);
  }
  byCode(code: string): StockType | undefined {
    return this.all.find((t) => t.code.toLowerCase() === code.trim().toLowerCase());
  }
  label(id: string): string {
    return this.byId(id)?.label ?? id;
  }
  code(id: string): string {
    return this.byId(id)?.code ?? id;
  }
  /** Main type followed by its groups: the segments of one stock type family. */
  family(mainId: string): StockType[] {
    const main = this.byId(mainId);
    return main ? [main, ...this.groupsOf(mainId)] : [];
  }
  /** Every segment, main types each followed by their groups. */
  get ordered(): StockType[] {
    return this.mainTypes.flatMap((m) => this.family(m.id));
  }
}

// ---------------------------------------------------------------------------
// OneStock items and categories
// ---------------------------------------------------------------------------

type FeatureValue = string | number | boolean | null;
export interface ItemNode {
  id?: string;
  /** Categories of the item (ids of the /categories tree). */
  category_ids?: Array<string | number>;
  features?: Record<string, Record<string, FeatureValue[] | FeatureValue> | undefined>;
}

const firstValue = (v: FeatureValue[] | FeatureValue | undefined): string => {
  const x = Array.isArray(v) ? v[0] : v;
  return x === null || x === undefined ? '' : String(x).trim();
};

/** Maps a v3/items entry to an Item, features read in the given language (fallback: first language). */
export function parseItemNode(node: ItemNode, language: string): Item {
  const id = String(node.id);
  const byLang = node.features ?? {};
  const f = byLang[language] ?? Object.values(byLang).find(Boolean) ?? {};
  const features = Object.fromEntries(
    Object.entries(f)
      .map(([k, v]) => [k, Array.isArray(v) ? v.map((x) => String(x ?? '').trim()).filter(Boolean).join(', ') : firstValue(v)] as const)
      .filter(([, v]) => v !== ''),
  );
  const get = (...keys: string[]) => keys.map((k) => firstValue(f[k])).find(Boolean) ?? '';
  // category_ids (item level) is the reference; a "category" feature is only a fallback.
  const categories = (node.category_ids ?? []).map((c) => String(c).trim()).filter(Boolean);
  if (!categories.length) {
    const feature = get('category', 'categories', 'category_id');
    if (feature) categories.push(feature);
  }
  return {
    id,
    sku: id,
    name: get('name', 'title', 'designation') || id,
    category: categories[0] ?? '',
    categories,
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

export interface Category {
  /** Value stored in the rule criteria. */
  id: string;
  label: string;
  /** Parent category id (none for the first level). */
  parentId?: string;
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
export function parseCategories(data: unknown, language: string): Category[] {
  const result: Category[] = [];
  const walk = (nodes: CategoryNode[] | undefined, parents: string[], parentId?: string) =>
    (nodes ?? []).forEach((node) => {
      if (node?.id === undefined) return;
      const label = nodeLabel(node, language);
      const id = String(node.id);
      result.push({ id, label: [...parents, label].join(' › '), ...(parentId ? { parentId } : {}) });
      walk(node.sub_category, [...parents, label], id);
    });

  const root = (data as { category?: CategoryNode } | null)?.category;
  if (root && typeof root === 'object') walk(root.sub_category, []);
  else if (Array.isArray(data))
    data.forEach((c) => {
      if (typeof c === 'string' || typeof c === 'number') result.push({ id: String(c), label: String(c) });
      else if (c && typeof c === 'object') {
        const o = c as CategoryNode & { name?: string };
        if (o.id !== undefined) result.push({ id: String(o.id), label: o.name ?? nodeLabel(o, language) });
        walk(o.sub_category, [o.name ?? nodeLabel(o, language)], o.id !== undefined ? String(o.id) : undefined);
      }
    });
  else throw new Error('No category tree found in the answer (expected { category: { sub_category: [...] } })');

  const unique = new Map(result.map((c) => [c.id, c]));
  return [...unique.values()].sort((a, b) => a.label.localeCompare(b.label));
}

/** Parent map of a category list, for setCategoryParents. */
export const categoryParentMap = (list: Category[]) =>
  new Map(list.filter((c) => c.parentId).map((c) => [c.id, c.parentId!] as [string, string]));

// ---------------------------------------------------------------------------
// OneStock stock records (stock_export / stock_import)
// ---------------------------------------------------------------------------

export interface StockRecord {
  item_id: string;
  endpoint_id: string;
  quantity: number;
  /** Stock type code, main type (on_hand, Container…) or group (on_hand_A, Container_B…); absent = on_hand. */
  type?: string;
  eta_start?: number;
  eta_end?: number;
  purchase_order_number?: string;
}

export interface StockImportRecord {
  item_id: string;
  endpoint_id: string;
  quantity: number;
  /** Omitted: default stock type (on_hand). */
  type?: string;
  purchase_order_number?: string;
  eta_start?: number;
  eta_end?: number;
}

/** Stock type of the stock records without type. */
export const DEFAULT_STOCK_TYPE = 'on_hand';

/** Key of a stock line: item × endpoint × main stock type × purchase order. */
export const lineKey = (itemId: string, endpointId: string, mainTypeId: string, po: string | null) =>
  ['onestock', itemId, endpointId, mainTypeId, po ?? ''].join('|');

/**
 * Turns stock_export records into stock lines: one line per item × endpoint × main stock type × purchase order.
 * OneStock stock is already segmented: a record on a group (on_hand_A, Container_B…) is the quantity of that group,
 * a record on the main type (on_hand, Container…) is what stays on it; the line quantity is the sum.
 * Stock type codes are matched case-insensitively with the stock types of the settings.
 */
export function recordsToLines(records: StockRecord[], tree: StockTypeTree): { lines: StockLine[]; unknownTypes: string[] } {
  const lines = new Map<string, StockLine>();
  const unknown = new Set<string>();
  records.forEach((r) => {
    // No stock type: the default stock type, on_hand.
    const untyped = !r.type?.trim();
    const type = tree.byCode(untyped ? DEFAULT_STOCK_TYPE : r.type!);
    if (!type) {
      unknown.add(untyped ? `${DEFAULT_STOCK_TYPE} (default, records without type)` : r.type!);
      return;
    }
    const main = type.parentId ? tree.byId(type.parentId)! : type;
    const po = main.future ? r.purchase_order_number?.trim() || null : null;
    const id = lineKey(r.item_id, r.endpoint_id, main.id, po);
    let line = lines.get(id);
    if (!line) {
      line = emptyLine(r.item_id, r.endpoint_id, main.id, po, tree);
      lines.set(id, line);
    }
    // '' = sent back without type, as read.
    if (!(type.id in line.remoteTypes!) || !untyped) line.remoteTypes![type.id] = untyped ? '' : r.type!;
    const q = Number(r.quantity) || 0;
    line.quantity += q;
    if (type.parentId) line.split[type.id] = { quantity: (line.split[type.id]?.quantity ?? 0) + q, threshold: null };
    if (r.eta_start || r.eta_end) {
      const start = r.eta_start ?? r.eta_end!;
      const end = r.eta_end ?? r.eta_start!;
      line.eta = line.eta ? { start: Math.min(line.eta.start, start), end: Math.max(line.eta.end, end) } : { start, end };
    }
  });
  return { lines: [...lines.values()], unknownTypes: [...unknown] };
}

/** A OneStock stock line without stock. */
export function emptyLine(itemId: string, endpointId: string, mainTypeId: string, po: string | null, tree: StockTypeTree): StockLine {
  return {
    id: lineKey(itemId, endpointId, mainTypeId, po),
    itemId,
    locationId: endpointId,
    stockTypeId: mainTypeId,
    purchaseOrder: po,
    quantity: 0,
    split: Object.fromEntries(tree.groupsOf(mainTypeId).map((g) => [g.id, { quantity: 0, threshold: null }])),
    period: { type: 'always' },
    source: { type: 'onestock' },
    remoteTypes: {},
  };
}

/**
 * OneStock code of a stock type for a line: the code read from OneStock when known, else derived from any code read
 * for the same line (e.g. "Container_A" read for container_A → main "Container", group container_B → "Container_B"),
 * else the code of the settings.
 */
function remoteCode(line: StockLine, typeId: string, tree: StockTypeTree): string {
  const known = line.remoteTypes?.[typeId];
  if (known !== undefined) return known;
  const main = tree.byId(line.stockTypeId)!;
  const target = tree.byId(typeId)!;
  const suffix = (code: string) => (code.toLowerCase().startsWith(main.code.toLowerCase()) ? code.slice(main.code.length) : undefined);
  const targetSuffix = suffix(target.code);
  for (const [id, remote] of Object.entries(line.remoteTypes ?? {})) {
    const ownSuffix = suffix(tree.byId(id)?.code ?? '');
    if (!remote || targetSuffix === undefined || ownSuffix === undefined) continue;
    if (!remote.toLowerCase().endsWith(ownSuffix.toLowerCase())) continue;
    return remote.slice(0, remote.length - ownSuffix.length) + targetSuffix;
  }
  return target.code;
}

/**
 * Incremental stock_import records: for each stock type of the line, the variation (after − before).
 * Types whose quantity does not change are not sent. A move between segments sums to 0.
 */
export function lineDeltaRecords(before: StockLine, after: StockLine, tree: StockTypeTree): StockImportRecord[] {
  const key = (r: StockImportRecord) => r.type ?? '';
  const old = new Map(lineToRecords(before, tree).map((r) => [key(r), r.quantity]));
  return lineToRecords(after, tree)
    .map((r) => ({ ...r, quantity: r.quantity - (old.get(key(r)) ?? 0) }))
    .filter((r) => r.quantity !== 0);
}

/**
 * stock_import records of a line: the main type keeps quantity − split, each group gets its split quantity.
 * Future stock carries the purchase order and the ETA read at the GET.
 */
export function lineToRecords(line: StockLine, tree: StockTypeTree): StockImportRecord[] {
  const main = tree.byId(line.stockTypeId);
  if (!main) return [];
  const extra = {
    ...(line.purchaseOrder ? { purchase_order_number: line.purchaseOrder } : {}),
    ...(line.eta ? { eta_start: line.eta.start, eta_end: line.eta.end } : {}),
  };
  const groups = tree.groupsOf(main.id);
  const split = groups.reduce((s, g) => s + (line.split[g.id]?.quantity ?? 0), 0);
  const record = (typeId: string, quantity: number): StockImportRecord => {
    const type = remoteCode(line, typeId, tree);
    // A record read without type (default on_hand) is sent back without type.
    return { item_id: line.itemId, endpoint_id: line.locationId, quantity, ...(type ? { type } : {}), ...extra };
  };
  return [record(main.id, line.quantity - split), ...groups.map((g) => record(g.id, line.split[g.id]?.quantity ?? 0))];
}
