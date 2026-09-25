import { itemAttribute } from '../config/attributes';
import type {
  ItemQuery,
  ItemSortKey,
  ItemSummary,
  RuleInput,
  SegmentationRule,
  Sort,
  StockImportResult,
  StockLine,
  StockType,
  StockTypeInput,
} from '../types';
import { applyRuleToLine, splitSum, summarize, toRow, unsplit } from '../utils/allocation';
import { appliesToStockType, byPriority, effectiveRule, matchesCriteria, normalizeText as normalize } from '../utils/rules';
import { StockTypeTree } from '../utils/stockTypes';
import { buildRules, buildStockLines, buildStockTypes, ITEMS, LOCATIONS, newLine } from './mockData';
import type { StockAllocationApi } from './types';

const STORAGE_KEY = 'stock-allocation:mock:v4';
const LATENCY_MS = 120;

const delay = <T>(value: T): Promise<T> =>
  new Promise((resolve) => setTimeout(() => resolve(structuredClone(value)), LATENCY_MS));
const fail = (message: string): Promise<never> =>
  new Promise((_, reject) => setTimeout(() => reject(new Error(message)), LATENCY_MS));

interface Db {
  stockTypes: StockType[];
  rules: SegmentationRule[];
  lines: StockLine[];
}

function initialDb(): Db {
  const stockTypes = buildStockTypes();
  const rules = buildRules();
  return { stockTypes, rules, lines: buildStockLines(rules, stockTypes) };
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

const tree = () => new StockTypeTree(db.stockTypes);
const linesOf = (itemId: string) => db.lines.filter((l) => l.itemId === itemId);
const summaries = (): ItemSummary[] => ITEMS.map((item) => summarize(item, linesOf(item.id)));
const itemOf = (id: string) => ITEMS.find((i) => i.id === id)!;
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
    case 'totalStock':
      return s.totalStock;
    case 'activeSegments':
      return s.activeSegments;
    default:
      return s.totals[key] ?? 0;
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
  return (i: { name: string; sku: string; category: string; brand: string; season: string }) =>
    !q || [i.name, i.sku, i.category, i.brand, i.season].some((v) => normalize(v).includes(q));
};

/** Main stock types a rule applies to. */
const targetedTypes = (rule: Pick<RuleInput, 'stockTypeIds'>) =>
  tree().mainTypes.filter((m) => rule.stockTypeIds.length === 0 || rule.stockTypeIds.includes(m.id));

function validateRule(rule: RuleInput) {
  const t = tree();
  if (!rule.name.trim()) throw new Error('The rule needs a name');
  if (rule.stockTypeIds.some((id) => t.byId(id)?.parentId !== null)) throw new Error('Choose main stock types');
  const types = targetedTypes(rule);
  if (!types.some((type) => t.groupsOf(type.id).length)) throw new Error('No targeted stock type has groups to split the stock onto');
  if (!rule.criteria.length || rule.criteria.some((c) => !c.values.length))
    throw new Error('Each criterion needs at least one value');
  if (rule.purchaseOrders.length && !(rule.stockTypeIds.length === 1 && t.byId(rule.stockTypeIds[0])?.future))
    throw new Error('Purchase orders can only be entered for a single future stock type');
  types.forEach((type) => {
    if (t.groupsOf(type.id).reduce((s, g) => s + (rule.shares[g.id] ?? 0), 0) > 100)
      throw new Error(`${type.label}: the sum of percentages cannot exceed 100 %`);
  });
}

/** Splits one stock line as a stock update does: first matching rule, or nothing split. */
function segmentWithRules(line: StockLine, stats: StockImportResult): StockLine {
  const rule = effectiveRule(db.rules, itemOf(line.itemId), line);
  if (!rule) {
    stats.withoutRule++;
    return unsplit(line);
  }
  stats.byRule++;
  return applyRuleToLine(line, rule, tree());
}

const emptyStats = (): StockImportResult => ({ updated: 0, byRule: 0, withoutRule: 0, errors: [] });

function renumberRules() {
  db.rules.sort(byPriority).forEach((r, i) => (r.priority = i + 1));
}

function validateStockType(input: StockTypeInput, id?: string) {
  const code = input.code.trim();
  if (!/^[A-Za-z0-9_-]+$/.test(code)) throw new Error('The code can only contain letters, digits, "_" and "-"');
  if (!input.label.trim()) throw new Error('The label is required');
  if (db.stockTypes.some((t) => t.id !== id && t.code.toLowerCase() === code.toLowerCase()))
    throw new Error(`The code "${code}" is already used`);
  if (input.parentId) {
    const parent = db.stockTypes.find((t) => t.id === input.parentId);
    if (!parent || parent.parentId !== null) throw new Error('A group must belong to a main stock type');
  }
}

export const mockApi: StockAllocationApi = {
  // --- Stock types
  async listStockTypes() {
    return delay(tree().all);
  },

  async createStockType(input) {
    try {
      validateStockType(input);
    } catch (e) {
      return fail((e as Error).message);
    }
    const siblings = db.stockTypes.filter((t) => t.parentId === input.parentId);
    const parent = db.stockTypes.find((t) => t.id === input.parentId);
    const type: StockType = {
      id: `st-${Date.now()}`,
      code: input.code.trim(),
      label: input.label.trim(),
      parentId: input.parentId,
      future: parent ? parent.future : input.future,
      position: Math.max(0, ...siblings.map((s) => s.position)) + 1,
    };
    db.stockTypes.push(type);
    persist();
    return delay(type);
  },

  async updateStockType(id, input) {
    const type = db.stockTypes.find((t) => t.id === id);
    if (!type) return fail('Stock type not found');
    try {
      validateStockType({ ...input, parentId: type.parentId }, id);
    } catch (e) {
      return fail((e as Error).message);
    }
    if (type.future && !input.future && db.lines.some((l) => l.stockTypeId === id && l.purchaseOrder))
      return fail('Stock with purchase orders exists on this type: it must stay a future stock type');
    type.code = input.code.trim();
    type.label = input.label.trim();
    if (type.parentId === null) {
      type.future = input.future;
      db.stockTypes.filter((t) => t.parentId === id).forEach((g) => (g.future = input.future));
      // Purchase orders are only allowed on a future stock type.
      if (!input.future)
        db.rules.filter((r) => r.purchaseOrders.length && r.stockTypeIds.includes(id)).forEach((r) => (r.purchaseOrders = []));
    }
    persist();
    return delay(type);
  },

  async deleteStockType(id) {
    const ids = [id, ...db.stockTypes.filter((t) => t.parentId === id).map((t) => t.id)];
    const usedByStock = db.lines.some((l) => ids.includes(l.stockTypeId) || ids.some((g) => (l.split[g]?.quantity ?? 0) > 0));
    if (usedByStock) return fail('This stock type holds stock: it cannot be deleted');
    const rules = db.rules.filter((r) => r.stockTypeIds.some((s) => ids.includes(s)) || ids.some((g) => (r.shares[g] ?? 0) > 0));
    if (rules.length) return fail(`Used by ${rules.length} rule(s): ${rules.map((r) => r.name).join(', ')}`);
    db.stockTypes = db.stockTypes.filter((t) => !ids.includes(t.id));
    db.lines.forEach((l) => ids.forEach((g) => delete l.split[g]));
    persist();
    return delay(undefined);
  },

  async moveStockType(id, direction) {
    const type = db.stockTypes.find((t) => t.id === id);
    if (!type) return delay(undefined);
    const siblings = db.stockTypes.filter((t) => t.parentId === type.parentId).sort((a, b) => a.position - b.position);
    const i = siblings.indexOf(type);
    const other = siblings[i + direction];
    if (other) [type.position, other.position] = [other.position, type.position];
    persist();
    return delay(undefined);
  },

  // --- Rules
  async listRules(query) {
    const q = normalize(query.search ?? '');
    const rules = [...db.rules].sort(byPriority).filter((r) => !query.stockTypeId || appliesToStockType(r, query.stockTypeId));
    // A SKU search also lists every rule matching that item (e.g. its category rule).
    const item = q ? ITEMS.find((i) => i.sku === q) : undefined;
    const matchesItem = (r: SegmentationRule) => !!item && matchesCriteria(item, r.criteria);
    const matchesText = (r: SegmentationRule) =>
      !q ||
      (!query.attribute && (normalize(r.name).includes(q) || r.purchaseOrders.some((p) => normalize(p).includes(q)))) ||
      r.criteria.some(
        (c) => (!query.attribute || c.attribute === query.attribute) && c.values.some((v) => normalize(v).includes(q)),
      );
    const list = rules.filter((r) => matchesText(r) || ((!query.attribute || query.attribute === 'sku') && matchesItem(r)));
    const start = query.page * query.pageSize;
    // Effective rules for the searched item: the ones actually used by its current stock lines.
    const effectiveRuleIds = item
      ? [...new Set(linesOf(item.id).map((l) => effectiveRule(db.rules, item, l)?.id).filter((id): id is string => !!id))]
      : [];
    return delay({
      data: list.slice(start, start + query.pageSize).map((rule) => ({ rule, matchedItemCount: matchedItems(rule).length })),
      total: list.length,
      ruleCount: db.rules.length,
      matchedItem: item ? { item, effectiveRuleIds } : undefined,
    });
  },

  async getRule(ruleId) {
    return delay(ruleById(ruleId));
  },

  async createRule(input) {
    try {
      validateRule(input);
    } catch (e) {
      return fail((e as Error).message);
    }
    const rule: SegmentationRule = { ...input, id: `rule-${Date.now()}`, priority: db.rules.length + 1, updatedAt: new Date().toISOString() };
    db.rules.push(rule);
    persist();
    return delay(rule);
  },

  async updateRule(ruleId, input) {
    try {
      validateRule(input);
    } catch (e) {
      return fail((e as Error).message);
    }
    Object.assign(ruleById(ruleId), input, { updatedAt: new Date().toISOString() });
    persist();
    return delay(ruleById(ruleId));
  },

  async deleteRule(ruleId) {
    db.rules = db.rules.filter((r) => r.id !== ruleId);
    // Lines keep their split until the next stock update.
    db.lines = db.lines.map((l) => (l.source.type === 'rule' && l.source.ruleId === ruleId ? { ...l, source: { type: 'manual' } } : l));
    renumberRules();
    persist();
    return delay(undefined);
  },

  async moveRule(ruleId, direction) {
    const rules = db.rules.sort(byPriority);
    const i = rules.findIndex((r) => r.id === ruleId);
    const j = i + direction;
    if (i >= 0 && j >= 0 && j < rules.length) [rules[i].priority, rules[j].priority] = [rules[j].priority, rules[i].priority];
    renumberRules();
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

  async listPurchaseOrders(stockTypeIds, search) {
    const q = normalize(search);
    const items = new Map<string, Set<string>>();
    db.lines
      .filter(
        (l) =>
          l.purchaseOrder &&
          (stockTypeIds.length === 0 || stockTypeIds.includes(l.stockTypeId)) &&
          (!q || normalize(l.purchaseOrder).includes(q)),
      )
      .forEach((l) => items.set(l.purchaseOrder!, (items.get(l.purchaseOrder!) ?? new Set()).add(l.itemId)));
    return delay(
      [...items.entries()].map(([value, set]) => ({ value, itemCount: set.size })).sort((a, b) => a.value.localeCompare(b.value)),
    );
  },

  async applyRulesToCurrentStock(ruleId) {
    const stats = emptyStats();
    const scope = ruleId ? new Set(matchedItems(ruleById(ruleId)).map((i) => i.id)) : undefined;
    db.lines = db.lines.map((l) => {
      if (scope && !scope.has(l.itemId)) return l;
      stats.updated++;
      return segmentWithRules(l, stats);
    });
    persist();
    return delay(stats);
  },

  // --- Stock & allocation
  async importStock(rows) {
    const stats = emptyStats();
    const t = tree();
    rows.forEach((row, i) => {
      const line = i + 2; // header is line 1
      const item = ITEMS.find((it) => it.sku === row.sku);
      const loc = LOCATIONS.find((l) => l.code === row.locationCode);
      const type = t.byCode(row.stockTypeCode);
      if (!item) return stats.errors.push(`Line ${line}: unknown SKU "${row.sku}"`);
      if (!loc) return stats.errors.push(`Line ${line}: unknown stock location "${row.locationCode}"`);
      if (!type) return stats.errors.push(`Line ${line}: unknown stock type "${row.stockTypeCode}"`);
      if (row.purchaseOrder && !type.future)
        return stats.errors.push(`Line ${line}: purchase orders are only allowed on future stock types (${type.code} is not)`);
      const po = type.future ? row.purchaseOrder : null;
      const idx = db.lines.findIndex(
        (l) => l.itemId === item.id && l.locationId === loc.id && l.stockTypeId === type.id && l.purchaseOrder === po,
      );
      const current = idx >= 0 ? db.lines[idx] : newLine(item.id, loc.id, type.id, po, 0);
      const next = segmentWithRules({ ...current, quantity: row.quantity }, stats);
      if (idx >= 0) db.lines[idx] = next;
      else db.lines.push(next);
      stats.updated++;
    });
    persist();
    return delay(stats);
  },

  async listItems(query: ItemQuery) {
    let list = summaries().filter((s) => matchesSearch(query.search ?? '')(s.item));
    if (query.warningType) list = list.filter((s) => s.warnings.includes(query.warningType!));
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
      tree()
        .ordered.map((t) => ({ stockTypeId: t.id, itemCount: all.filter((s) => s.warnings.includes(t.id)).length }))
        .filter((w) => w.itemCount > 0),
    );
  },

  async getItemDetail(itemId) {
    const item = ITEMS.find((i) => i.id === itemId);
    if (!item) return fail(`Item ${itemId} not found`);
    const lines = linesOf(itemId);
    const ref = (r?: SegmentationRule) => (r ? { id: r.id, name: r.name } : undefined);
    const rows = lines.map((l) => {
      const location = LOCATIONS.find((x) => x.id === l.locationId)!;
      const rule = l.source.type === 'rule' ? ref(db.rules.find((r) => r.id === (l.source as { ruleId: string }).ruleId)) : undefined;
      return { ...toRow(location, l), rule, nextRule: ref(effectiveRule(db.rules, item, l)) };
    });
    return delay({ summary: summarize(item, lines), rows });
  },

  async listLocations() {
    return delay(LOCATIONS);
  },

  async updateStockLine(line) {
    const idx = db.lines.findIndex((l) => l.id === line.id);
    if (idx < 0) return fail('Stock line not found');
    const current = db.lines[idx];
    if (splitSum(line) > current.quantity) return fail('The split exceeds the stock quantity');
    db.lines[idx] = { ...current, split: line.split, period: line.period, source: { type: 'manual' } };
    persist();
    return delay(db.lines[idx]);
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
