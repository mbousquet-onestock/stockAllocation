import { SEGMENT_IDS, segmentRecord } from '../config/segments';
import type {
  Allocation,
  Item,
  ItemSummary,
  LocationRow,
  SegmentId,
  SegmentationRule,
  StockLocation,
} from '../types';

export const allocatedSum = (a: Allocation): number =>
  SEGMENT_IDS.reduce((sum, id) => sum + a.segments[id].quantity, 0);

export const nonAllocated = (a: Allocation): number => a.totalStock - allocatedSum(a);

export const isBelowThreshold = (quantity: number, threshold: number | null): boolean =>
  threshold !== null && quantity < threshold;

export const allocationWarnings = (a: Allocation): SegmentId[] =>
  SEGMENT_IDS.filter((id) => isBelowThreshold(a.segments[id].quantity, a.segments[id].threshold));

/** Is the allocation active on the given day (ISO yyyy-mm-dd)? */
export function isActive(a: Allocation, today: string): boolean {
  if (a.period.type === 'always') return true;
  return a.period.start <= today && today <= a.period.end;
}

export function toLocationRow(location: StockLocation, allocation: Allocation): LocationRow {
  return {
    location,
    allocation,
    nonAllocated: nonAllocated(allocation),
    warnings: allocationWarnings(allocation),
  };
}

export function summarize(item: Item, allocations: Allocation[]): ItemSummary {
  const totals = segmentRecord((id) =>
    allocations.reduce((sum, a) => sum + a.segments[id].quantity, 0),
  );
  const totalStock = allocations.reduce((sum, a) => sum + a.totalStock, 0);
  const allocated = SEGMENT_IDS.reduce((sum, id) => sum + totals[id], 0);
  const warnings = SEGMENT_IDS.filter((id) =>
    allocations.some((a) => isBelowThreshold(a.segments[id].quantity, a.segments[id].threshold)),
  );
  return {
    item,
    totals,
    totalStock,
    nonAllocated: totalStock - allocated,
    activeSegments: SEGMENT_IDS.filter((id) => totals[id] > 0).length,
    warnings,
  };
}

/**
 * Computes segment quantities for a given stock according to a rule.
 * - percentage: floor(stock * pct / 100) per segment, the rounding rest stays non allocated.
 * - quantity: fixed quantities, capped in segment order when the stock is insufficient.
 */
export function computeQuantities(
  totalStock: number,
  rule: Pick<SegmentationRule, 'mode' | 'values'>,
): { quantities: Record<SegmentId, number>; capped: boolean } {
  let remaining = totalStock;
  let capped = false;
  const quantities = segmentRecord((id) => {
    const value = Math.max(0, rule.values[id] || 0);
    const wanted = rule.mode === 'percentage' ? Math.floor((totalStock * value) / 100) : value;
    const q = Math.min(wanted, remaining);
    if (q < wanted) capped = true;
    remaining -= q;
    return q;
  });
  return { quantities, capped };
}

export function applyRuleToAllocation(a: Allocation, rule: SegmentationRule): { allocation: Allocation; capped: boolean } {
  const { quantities, capped } = computeQuantities(a.totalStock, rule);
  return {
    capped,
    allocation: {
      ...a,
      period: rule.period,
      segments: segmentRecord((id) => ({ quantity: quantities[id], threshold: rule.thresholds[id] })),
    },
  };
}
