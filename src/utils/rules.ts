import { itemAttribute } from '../config/attributes';
import type { Criterion, Item, RuleInput, SegmentationRule } from '../types';

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

export const byPriority = (a: SegmentationRule, b: SegmentationRule) => a.priority - b.priority;

/** The rule used at stock import for this item and location: first enabled matching rule by priority. */
export function effectiveRule(
  rules: SegmentationRule[],
  item: Item,
  locationId?: string,
): SegmentationRule | undefined {
  return [...rules]
    .sort(byPriority)
    .find((r) => r.enabled && matchesCriteria(item, r.criteria) && (!locationId || appliesToLocation(r, locationId)));
}

export { norm as normalizeText };

/** Editable part of a rule. */
export function toRuleInput(rule: SegmentationRule): RuleInput {
  const { name, enabled, criteria, locationIds, mode, values, thresholds, period } = rule;
  return { name, enabled, criteria, locationIds, mode, values, thresholds, period };
}
