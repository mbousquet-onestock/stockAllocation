import { itemAttribute } from '../config/attributes';
import { SEGMENT_IDS } from '../config/segments';
import type {
  Allocation,
  ImportResult,
  ItemQuery,
  ItemSortKey,
  ItemSummary,
  RuleInput,
  SegmentationRule,
  Sort,
  StockImportResult,
} from '../types';
import { applyRuleToAllocation, summarize, toLocationRow, unallocated } from '../utils/allocation';
import { byPriority, effectiveRule, matchesCriteria, normalizeText as normalize } from '../utils/rules';
import { buildAllocations, buildRules, ITEMS, LOCATIONS } from './mockData';
import type { StockAllocationApi } from './types';

const STORAGE_KEY = 'stock-allocation:mock:v2';
const LATENCY_MS = 150;

const delay = <T>(value: T): Promise<T> =>
  new Promise((resolve) => setTimeout(() => resolve(structuredClone(value)), LATENCY_MS));

interface Db {
  rules: SegmentationRule[];
  allocations: Allocation[];
}

function initialDb(): Db {
  const rules = buildRules();
  return { rules, allocations: buildAllocations(rules) };
}

function load(): Db {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as Db;
  } catch {
    /* ignore */
  }
  return initialDb();
}

let db: Db = load();

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
  } catch {
    /* ignore */
  }
}

const allocationsOf = (itemId: string) => db.allocations.filter((a) => a.itemId === itemId);
const summaries = (): ItemSummary[] => ITEMS.map((item) => summarize(item, allocationsOf(item.id)));
const ruleById = (id: string) => {
  const rule = db.rules.find((r) => r.id === id);
  if (!rule) throw new Error(`Rule ${id} not found`);
  return rule;
};
const matchedItems = (rule: Pick<SegmentationRule, 'criteria'>) => ITEMS.filter((i) => matchesCriteria(i, rule.criteria));

function sortValue(s: ItemSummary, key: ItemSortKey): string | number {
  switch (key) {
    case 'item':
      return s.item.name.toLowerCase();
    case 'nonAllocated':
      return s.nonAllocated;
    case 'totalStock':
      return s.totalStock;
    case 'activeSegments':
      return s.activeSegments;
    default:
      return s.totals[key];
  }
}

function sortSummaries(list: ItemSummary[], sort?: Sort<ItemSortKey>) {
  if (!sort) return list;
  const dir = sort.direction === 'asc' ? 1 : -1;
  return [...list].sort((a, b) => {
    const va = sortValue(a, sort.key);
    const vb = sortValue(b, sort.key);
    return va < vb ? -dir : va > vb ? dir : 0;
  });
}

const matchesSearch = (search: string) => {
  const q = normalize(search);
  return (s: { name: string; sku: string; category: string; brand: string; season: string }) =>
    !q ||
    [s.name, s.sku, s.category, s.brand, s.season].some((v) => normalize(v).includes(q));
};

function validateRule(rule: RuleInput) {
  if (!rule.name.trim()) throw new Error('The rule needs a name');
  if (!rule.criteria.length || rule.criteria.some((c) => !c.values.length))
    throw new Error('Each criterion needs at least one value');
  if (rule.mode === 'percentage' && SEGMENT_IDS.reduce((s, id) => s + rule.values[id], 0) > 100)
    throw new Error('The sum of percentages cannot exceed 100 %');
}

/** Segments one allocation as a stock import does: first matching rule, or nothing allocated. */
function segmentWithRules(a: Allocation, stats: StockImportResult) {
  const item = ITEMS.find((i) => i.id === a.itemId)!;
  const rule = effectiveRule(db.rules, item, a.locationId);
  if (!rule) {
    stats.withoutRule++;
    return unallocated(a);
  }
  const { allocation, capped } = applyRuleToAllocation(a, rule);
  stats.byRule++;
  if (capped) stats.capped++;
  return allocation;
}

const emptyStats = (): StockImportResult => ({ updated: 0, byRule: 0, withoutRule: 0, capped: 0, errors: [] });

function renumber() {
  db.rules.sort(byPriority).forEach((r, i) => (r.priority = i + 1));
}

export const mockApi: StockAllocationApi = {
  // --- Rules
  async listRules(query) {
    const q = normalize(query.search ?? '');
    const rules = [...db.rules].sort(byPriority);
    // A SKU search also lists every rule matching that item (e.g. its category rule).
    const item = q ? ITEMS.find((i) => i.sku === q) : undefined;
    const matchesItem = (r: SegmentationRule) => !!item && matchesCriteria(item, r.criteria);
    const matchesText = (r: SegmentationRule) =>
      !q ||
      (!query.attribute && normalize(r.name).includes(q)) ||
      r.criteria.some(
        (c) => (!query.attribute || c.attribute === query.attribute) && c.values.some((v) => normalize(v).includes(q)),
      );
    const list = rules.filter(
      (r) => matchesText(r) || ((!query.attribute || query.attribute === 'sku') && matchesItem(r)),
    );
    const start = query.page * query.pageSize;
    return delay({
      data: list.slice(start, start + query.pageSize).map((rule) => ({ rule, matchedItemCount: matchedItems(rule).length })),
      total: list.length,
      ruleCount: db.rules.length,
      matchedItem: item ? { item, effectiveRuleId: effectiveRule(db.rules, item)?.id } : undefined,
    });
  },

  async getRule(ruleId) {
    return delay(ruleById(ruleId));
  },

  async createRule(input) {
    validateRule(input);
    const rule: SegmentationRule = {
      ...input,
      id: `rule-${Date.now()}`,
      priority: db.rules.length + 1,
      updatedAt: new Date().toISOString(),
    };
    db.rules.push(rule);
    persist();
    return delay(rule);
  },

  async updateRule(ruleId, input) {
    validateRule(input);
    const rule = ruleById(ruleId);
    Object.assign(rule, input, { updatedAt: new Date().toISOString() });
    persist();
    return delay(rule);
  },

  async deleteRule(ruleId) {
    db.rules = db.rules.filter((r) => r.id !== ruleId);
    // Allocations keep their quantities until the next stock import.
    db.allocations = db.allocations.map((a) =>
      a.source.type === 'rule' && a.source.ruleId === ruleId ? { ...a, source: { type: 'manual' } } : a,
    );
    renumber();
    persist();
    return delay(undefined);
  },

  async moveRule(ruleId, direction) {
    const rules = db.rules.sort(byPriority);
    const i = rules.findIndex((r) => r.id === ruleId);
    const j = i + direction;
    if (i < 0 || j < 0 || j >= rules.length) return delay(undefined);
    [rules[i].priority, rules[j].priority] = [rules[j].priority, rules[i].priority];
    renumber();
    persist();
    return delay(undefined);
  },

  async previewCriteria(rule) {
    const items = matchedItems(rule);
    return delay({ itemCount: items.length, sample: items.slice(0, 5) });
  },

  async listAttributeValues(attribute, search) {
    const q = normalize(search);
    const counts = new Map<string, { label?: string; itemCount: number }>();
    ITEMS.forEach((i) => {
      const value = itemAttribute(i, attribute);
      const label = attribute === 'sku' ? i.name : undefined;
      if (q && !normalize(value).includes(q) && !(label && normalize(label).includes(q))) return;
      const c = counts.get(value) ?? { label, itemCount: 0 };
      c.itemCount++;
      counts.set(value, c);
    });
    return delay(
      [...counts.entries()]
        .map(([value, c]) => ({ value, ...c }))
        .sort((a, b) => a.value.localeCompare(b.value))
        .slice(0, 50),
    );
  },

  async applyRulesToCurrentStock(ruleId) {
    const stats = emptyStats();
    const scope = ruleId ? new Set(matchedItems(ruleById(ruleId)).map((i) => i.id)) : undefined;
    db.allocations = db.allocations.map((a) => {
      if (scope && !scope.has(a.itemId)) return a;
      stats.updated++;
      return segmentWithRules(a, stats);
    });
    persist();
    return delay(stats);
  },

  // --- Stock & allocation
  async importStock(rows) {
    const stats = emptyStats();
    rows.forEach((row, i) => {
      const line = i + 2; // header is line 1
      const item = ITEMS.find((it) => it.sku === row.sku);
      const loc = LOCATIONS.find((l) => l.code === row.locationCode);
      if (!item) return stats.errors.push(`Line ${line}: unknown SKU "${row.sku}"`);
      if (!loc) return stats.errors.push(`Line ${line}: unknown stock location "${row.locationCode}"`);
      const idx = db.allocations.findIndex((a) => a.itemId === item.id && a.locationId === loc.id);
      const current: Allocation =
        idx >= 0
          ? db.allocations[idx]
          : unallocated({ itemId: item.id, locationId: loc.id, totalStock: 0 } as Allocation);
      const next = segmentWithRules({ ...current, totalStock: row.quantity }, stats);
      if (idx >= 0) db.allocations[idx] = next;
      else db.allocations.push(next);
      stats.updated++;
    });
    persist();
    return delay(stats);
  },

  async listItems(query: ItemQuery) {
    let list = summaries().filter((s) => matchesSearch(query.search ?? '')(s.item));
    if (query.warningSegment) list = list.filter((s) => s.warnings.includes(query.warningSegment!));
    if (query.ruleId) {
      const rule = db.rules.find((r) => r.id === query.ruleId);
      list = rule ? list.filter((s) => matchesCriteria(s.item, rule.criteria)) : [];
    }
    list = sortSummaries(list, query.sort);
    const start = query.page * query.pageSize;
    return delay({ data: list.slice(start, start + query.pageSize), total: list.length });
  },

  async getWarningSummary() {
    const all = summaries();
    return delay(
      SEGMENT_IDS.map((segment) => ({
        segment,
        itemCount: all.filter((s) => s.warnings.includes(segment)).length,
      })).filter((w) => w.itemCount > 0),
    );
  },

  async getItemDetail(itemId) {
    const item = ITEMS.find((i) => i.id === itemId);
    if (!item) throw new Error(`Item ${itemId} not found`);
    const itemAllocations = allocationsOf(itemId);
    const ref = (r?: SegmentationRule) => (r ? { id: r.id, name: r.name } : undefined);
    const rows = LOCATIONS.flatMap((loc) => {
      const a = itemAllocations.find((x) => x.locationId === loc.id);
      if (!a) return [];
      const rule = a.source.type === 'rule' ? ref(db.rules.find((r) => r.id === (a.source as { ruleId: string }).ruleId)) : undefined;
      return [{ ...toLocationRow(loc, a), rule }];
    });
    const effectiveRules = Object.fromEntries(LOCATIONS.map((l) => [l.id, ref(effectiveRule(db.rules, item, l.id))]));
    return delay({ summary: summarize(item, itemAllocations), rows, effectiveRules });
  },

  async listLocations() {
    return delay(LOCATIONS);
  },

  async updateAllocation(allocation) {
    const idx = db.allocations.findIndex(
      (a) => a.itemId === allocation.itemId && a.locationId === allocation.locationId,
    );
    if (idx < 0) throw new Error('Allocation not found');
    const sum = SEGMENT_IDS.reduce((s, id) => s + allocation.segments[id].quantity, 0);
    if (sum > db.allocations[idx].totalStock) throw new Error('Allocated quantity exceeds total stock');
    db.allocations[idx] = { ...allocation, totalStock: db.allocations[idx].totalStock, source: { type: 'manual' } };
    persist();
    return delay(db.allocations[idx]);
  },

  async importRows(rows) {
    const result: ImportResult = { updated: 0, errors: [] };
    rows.forEach((row, i) => {
      const line = i + 2;
      const item = ITEMS.find((it) => it.sku === row.sku);
      const loc = LOCATIONS.find((l) => l.code === row.locationCode);
      if (!item) return result.errors.push(`Line ${line}: unknown SKU "${row.sku}"`);
      if (!loc) return result.errors.push(`Line ${line}: unknown stock location "${row.locationCode}"`);
      const idx = db.allocations.findIndex((a) => a.itemId === item.id && a.locationId === loc.id);
      if (idx < 0) return result.errors.push(`Line ${line}: no stock for ${row.sku} in ${loc.code}`);
      const current = db.allocations[idx];
      const next: Allocation = {
        ...current,
        period: row.period ?? current.period,
        segments: { ...current.segments, ...row.segments },
        source: { type: 'manual' },
      };
      const sum = SEGMENT_IDS.reduce((s, id) => s + next.segments[id].quantity, 0);
      if (sum > next.totalStock)
        return result.errors.push(`Line ${line}: allocated ${sum} exceeds total stock ${next.totalStock}`);
      db.allocations[idx] = next;
      result.updated++;
    });
    persist();
    return delay(result);
  },

  async searchItems(search, limit = 20) {
    return delay(ITEMS.filter(matchesSearch(search)).slice(0, limit));
  },

  async reset() {
    db = initialDb();
    persist();
    return delay(undefined);
  },
};

