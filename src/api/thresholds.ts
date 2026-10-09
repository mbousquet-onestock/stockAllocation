import type { StockLine } from '../types';
import { getDbConfig } from './dbConfig';
import { remoteRules, type ThresholdEntry } from './remoteRules';
import { currentSiteId } from './site';

/**
 * Alert thresholds of the OneStock stock lines (OneStock does not store them): saved in the database for the site
 * (api/thresholds), or in this browser without database, and applied when the items are displayed.
 */
const LOCAL_KEY = 'stock-allocation:thresholds';
const key = (e: Pick<ThresholdEntry, 'item_id' | 'endpoint_id' | 'stock_type' | 'purchase_order'>) =>
  [e.item_id, e.endpoint_id, e.stock_type, e.purchase_order ?? ''].join('|');
const shared = () => getDbConfig().mode === 'remote' && !!currentSiteId();

function localAll(): Record<string, number | null> {
  try {
    return (JSON.parse(localStorage.getItem(LOCAL_KEY) ?? '{}') as Record<string, Record<string, number | null>>)[currentSiteId()] ?? {};
  } catch {
    return {};
  }
}
function localReplace(values: Record<string, number | null>) {
  try {
    const all = JSON.parse(localStorage.getItem(LOCAL_KEY) ?? '{}') as Record<string, Record<string, number | null>>;
    all[currentSiteId()] = values;
    localStorage.setItem(LOCAL_KEY, JSON.stringify(all));
  } catch {
    /* ignore */
  }
}

/** Saved thresholds of these items, by line × group key. */
export async function loadThresholds(itemIds: string[]): Promise<Map<string, number | null>> {
  if (!itemIds.length) return new Map();
  if (!shared()) return new Map(Object.entries(localAll()).filter(([, v]) => v !== null));
  const map = new Map<string, number | null>();
  const ids = [...new Set(itemIds)];
  for (let i = 0; i < ids.length; i += 200) {
    const { thresholds } = await remoteRules.getThresholds(ids.slice(i, i + 200));
    thresholds.forEach((t) => map.set(key(t), t.threshold));
  }
  return map;
}

/** Items having at least one saved threshold (candidates for the threshold alerts). */
export async function itemsWithThresholds(): Promise<string[]> {
  if (!shared()) return [...new Set(Object.entries(localAll()).filter(([, v]) => v !== null).map(([k]) => k.split('|')[0]))];
  const { thresholds } = await remoteRules.allThresholds();
  return [...new Set(thresholds.map((t) => t.item_id))];
}

/** Applies the saved thresholds to the lines (they replace the thresholds of the rules). */
export function applyThresholds(lines: StockLine[], saved: Map<string, number | null>) {
  lines.forEach((l) =>
    Object.entries(l.split).forEach(([group, a]) => {
      const k = key({ item_id: l.itemId, endpoint_id: l.locationId, stock_type: group, purchase_order: l.purchaseOrder });
      const v = saved.get(k);
      if (v !== undefined && v !== null) a.threshold = v;
    }),
  );
}

/**
 * Saves the thresholds of a line: only a threshold different from the one of the rule is kept for the line; an empty
 * threshold, or the threshold of the rule, removes it (the rule applies, and follows its later changes).
 */
export async function saveLineThresholds(line: StockLine, ruleThresholds: Record<string, number | null | undefined> = {}) {
  const entries: ThresholdEntry[] = Object.entries(line.split).map(([group, a]) => ({
    item_id: line.itemId,
    endpoint_id: line.locationId,
    stock_type: group,
    purchase_order: line.purchaseOrder,
    threshold: a.threshold === null || a.threshold === (ruleThresholds[group] ?? null) ? null : a.threshold,
  }));
  if (!entries.length) return;
  if (shared()) await remoteRules.saveThresholds(entries);
  else {
    const all = localAll();
    entries.forEach((e) => (e.threshold === null ? delete all[key(e)] : (all[key(e)] = e.threshold)));
    localReplace(all);
  }
}
