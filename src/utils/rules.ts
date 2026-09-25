import { itemAttribute } from '../config/attributes';
import type { Criterion, Item, RuleInput, SegmentationRule, StockLine } from '../types';

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();

/** All criteria must match; inside a criterion any value matches. */
export function matchesCriteria(item: Item, criteria: Criterion[]): boolean {
  if (!criteria.length) return false;
  return criteria.every(
    (c) => c.values.length > 0 && c.values.some((v) => norm(v) === norm(itemAttribute(item, c.attribute))),
  );
}

export const appliesToLocation = (rule: SegmentationRule, locationId: string) =>
  rule.locationIds.length === 0 || rule.locationIds.includes(locationId);

export const appliesToPurchaseOrder = (rule: SegmentationRule, po: string | null) =>
  rule.purchaseOrders.length === 0 || (po !== null && rule.purchaseOrders.some((p) => norm(p) === norm(po)));

export const byPriority = (a: SegmentationRule, b: SegmentationRule) => a.priority - b.priority;

type LineKey = Pick<StockLine, 'locationId' | 'stockTypeId' | 'purchaseOrder'>;

/** Does the rule apply to this item's stock line? */
export const ruleMatchesLine = (rule: SegmentationRule, item: Item, line: LineKey) =>
  rule.enabled &&
  rule.stockTypeId === line.stockTypeId &&
  matchesCriteria(item, rule.criteria) &&
  appliesToLocation(rule, line.locationId) &&
  appliesToPurchaseOrder(rule, line.purchaseOrder);

/** The rule used when this stock line is updated: first enabled matching rule by priority. */
export function effectiveRule(rules: SegmentationRule[], item: Item, line: LineKey): SegmentationRule | undefined {
  return [...rules].sort(byPriority).find((r) => ruleMatchesLine(r, item, line));
}

/** Editable part of a rule. */
export function toRuleInput(rule: SegmentationRule): RuleInput {
  const { name, enabled, criteria, stockTypeId, purchaseOrders, locationIds, shares, thresholds, period } = rule;
  return { name, enabled, criteria, stockTypeId, purchaseOrders, locationIds, shares, thresholds, period };
}

export { norm as normalizeText };
