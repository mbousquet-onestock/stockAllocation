import type { RuleInput, SegmentationRule } from '../types';

// Rule matching is shared with the serverless functions (api/stock-import).
export {
  appliesToLocation,
  appliesToPurchaseOrder,
  appliesToStockType,
  byPriority,
  effectiveRule,
  itemValues,
  matchesCriteria,
  normalizeText,
  ruleMatchesLine,
} from '../../api/_lib/segmentation.js';

/** Editable part of a rule. */
export function toRuleInput(rule: SegmentationRule): RuleInput {
  const { name, enabled, criteria, stockTypeIds, purchaseOrders, locationIds, shares, thresholds, period } = rule;
  return { name, enabled, criteria, stockTypeIds, purchaseOrders, locationIds, shares, thresholds, period };
}
