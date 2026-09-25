import type { Item, ItemSummary, SegmentationRule, StockLine, StockLocation, StockLineRow } from '../types';
import type { StockTypeTree } from './stockTypes';

export const splitSum = (l: StockLine): number =>
  Object.values(l.split).reduce((sum, g) => sum + g.quantity, 0);

/** Quantity left on the main stock type after the split onto its groups. */
export const remaining = (l: StockLine): number => l.quantity - splitSum(l);

export const isBelowThreshold = (quantity: number, threshold: number | null): boolean =>
  threshold !== null && quantity < threshold;

export const lineWarnings = (l: StockLine): string[] =>
  Object.entries(l.split)
    .filter(([, g]) => isBelowThreshold(g.quantity, g.threshold))
    .map(([id]) => id);

/** Is the segmentation active on the given day (ISO yyyy-mm-dd)? */
export function isActive(period: StockLine['period'], today: string): boolean {
  if (period.type === 'always') return true;
  return period.start <= today && today <= period.end;
}

export function toRow(location: StockLocation, line: StockLine): StockLineRow {
  return { line, location, remaining: remaining(line), warnings: lineWarnings(line) };
}

export function summarize(item: Item, lines: StockLine[]): ItemSummary {
  const totals: Record<string, number> = {};
  const add = (id: string, q: number) => (totals[id] = (totals[id] ?? 0) + q);
  const warnings = new Set<string>();
  lines.forEach((l) => {
    add(l.stockTypeId, remaining(l));
    Object.entries(l.split).forEach(([id, g]) => add(id, g.quantity));
    lineWarnings(l).forEach((w) => warnings.add(w));
  });
  return {
    item,
    totals,
    totalStock: lines.reduce((s, l) => s + l.quantity, 0),
    activeSegments: Object.values(totals).filter((q) => q > 0).length,
    warnings: [...warnings],
  };
}

/** Total of a main stock type family (the type itself and its groups). */
export const familyTotal = (totals: Record<string, number>, tree: StockTypeTree, mainId: string) =>
  tree.family(mainId).reduce((s, t) => s + (totals[t.id] ?? 0), 0);

/**
 * Splits a quantity onto groups by percentage: floor(quantity * pct / 100) per group,
 * the rounding rest stays on the main stock type.
 */
export function computeSplit(quantity: number, shares: Record<string, number>, groupIds: string[]): Record<string, number> {
  let left = quantity;
  return Object.fromEntries(
    groupIds.map((id) => {
      const q = Math.min(left, Math.floor((quantity * Math.max(0, shares[id] ?? 0)) / 100));
      left -= q;
      return [id, q];
    }),
  );
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

/** No rule: the whole quantity stays on the main stock type. */
export function unsplit(line: StockLine): StockLine {
  return { ...line, period: { type: 'always' }, split: {}, source: { type: 'none' } };
}
