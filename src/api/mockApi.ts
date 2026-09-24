import { SEGMENT_IDS } from '../config/segments';
import type {
  Allocation,
  ImportResult,
  ItemQuery,
  ItemSortKey,
  ItemSummary,
  SegmentationRule,
  Sort,
} from '../types';
import { applyRuleToAllocation, summarize, toLocationRow } from '../utils/allocation';
import { buildAllocations, ITEMS, LOCATIONS } from './mockData';
import type { StockAllocationApi } from './types';

const STORAGE_KEY = 'stock-allocation:mock:v1';
const LATENCY_MS = 150;

const delay = <T>(value: T): Promise<T> =>
  new Promise((resolve) => setTimeout(() => resolve(structuredClone(value)), LATENCY_MS));

function load(): Allocation[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as Allocation[];
  } catch {
    /* ignore */
  }
  return buildAllocations();
}

let allocations: Allocation[] = load();

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(allocations));
  } catch {
    /* ignore */
  }
}

const normalize = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const allocationsOf = (itemId: string) => allocations.filter((a) => a.itemId === itemId);

const summaries = (): ItemSummary[] => ITEMS.map((item) => summarize(item, allocationsOf(item.id)));

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

const matches = (search: string) => {
  const q = normalize(search.trim());
  return (s: { name: string; sku: string; category: string }) =>
    !q || normalize(s.name).includes(q) || s.sku.includes(q) || normalize(s.category).includes(q);
};

export const mockApi: StockAllocationApi = {
  async listItems(query: ItemQuery) {
    let list = summaries().filter((s) => matches(query.search ?? '')(s.item));
    if (query.warningSegment) list = list.filter((s) => s.warnings.includes(query.warningSegment!));
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
    const rows = LOCATIONS.flatMap((loc) => {
      const a = itemAllocations.find((x) => x.locationId === loc.id);
      return a ? [toLocationRow(loc, a)] : [];
    });
    return delay({ summary: summarize(item, itemAllocations), rows });
  },

  async searchItems(search, limit = 20) {
    return delay(ITEMS.filter(matches(search)).slice(0, limit));
  },

  async listCategories() {
    const counts = new Map<string, number>();
    ITEMS.forEach((i) => counts.set(i.category, (counts.get(i.category) ?? 0) + 1));
    return delay(
      [...counts.entries()]
        .map(([name, itemCount]) => ({ name, itemCount }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    );
  },

  async listLocations() {
    return delay(LOCATIONS);
  },

  async updateAllocation(allocation) {
    const idx = allocations.findIndex(
      (a) => a.itemId === allocation.itemId && a.locationId === allocation.locationId,
    );
    if (idx < 0) throw new Error('Allocation not found');
    const sum = SEGMENT_IDS.reduce((s, id) => s + allocation.segments[id].quantity, 0);
    if (sum > allocations[idx].totalStock) throw new Error('Allocated quantity exceeds total stock');
    allocations[idx] = { ...allocation, totalStock: allocations[idx].totalStock };
    persist();
    return delay(allocations[idx]);
  },

  async applyRule(rule: SegmentationRule) {
    const itemIds = new Set(
      rule.target.type === 'items'
        ? rule.target.itemIds
        : ITEMS.filter((i) => (rule.target as { categories: string[] }).categories.includes(i.category)).map(
            (i) => i.id,
          ),
    );
    const locations = new Set(rule.locationIds);
    let allocationCount = 0;
    let cappedCount = 0;
    allocations = allocations.map((a) => {
      if (!itemIds.has(a.itemId)) return a;
      if (locations.size && !locations.has(a.locationId)) return a;
      const { allocation, capped } = applyRuleToAllocation(a, rule);
      allocationCount++;
      if (capped) cappedCount++;
      return allocation;
    });
    persist();
    return delay({ itemCount: itemIds.size, allocationCount, cappedCount });
  },

  async importRows(rows) {
    const result: ImportResult = { updated: 0, errors: [] };
    rows.forEach((row, i) => {
      const line = i + 2; // header is line 1
      const item = ITEMS.find((it) => it.sku === row.sku);
      const loc = LOCATIONS.find((l) => l.code === row.locationCode);
      if (!item) return result.errors.push(`Line ${line}: unknown SKU "${row.sku}"`);
      if (!loc) return result.errors.push(`Line ${line}: unknown stock location "${row.locationCode}"`);
      const idx = allocations.findIndex((a) => a.itemId === item.id && a.locationId === loc.id);
      if (idx < 0) return result.errors.push(`Line ${line}: no stock for ${row.sku} in ${loc.code}`);
      const current = allocations[idx];
      const next: Allocation = {
        ...current,
        period: row.period ?? current.period,
        segments: { ...current.segments, ...row.segments },
      };
      const sum = SEGMENT_IDS.reduce((s, id) => s + next.segments[id].quantity, 0);
      if (sum > next.totalStock)
        return result.errors.push(`Line ${line}: allocated ${sum} exceeds total stock ${next.totalStock}`);
      allocations[idx] = next;
      result.updated++;
    });
    persist();
    return delay(result);
  },

  async reset() {
    allocations = buildAllocations();
    persist();
    return delay(undefined);
  },
};
