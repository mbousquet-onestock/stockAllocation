/** Identifier of a sales segment (channel) stock can be allocated to. */
export type SegmentId = 'brand_site' | 'marketplace' | 'social';

export interface Segment {
  id: SegmentId;
  label: string;
}

export interface Item {
  id: string;
  sku: string;
  name: string;
  price: number;
  /** Free specs displayed under the name (e.g. capacity). */
  specs: string[];
  category: string;
  brand: string;
  season: string;
  imageUrl?: string;
}

export interface StockLocation {
  id: string;
  code: string;
  name: string;
}

export type ActivationPeriod =
  | { type: 'always' }
  | { type: 'range'; start: string; end: string }; // ISO dates (yyyy-mm-dd)

export interface SegmentAllocation {
  quantity: number;
  /** Alert threshold: a warning is raised when quantity < threshold. */
  threshold: number | null;
}

/** Segmentation of one item's stock in one stock location. */
export interface Allocation {
  itemId: string;
  locationId: string;
  totalStock: number;
  period: ActivationPeriod;
  segments: Record<SegmentId, SegmentAllocation>;
  /** What produced the current segmentation. */
  source: AllocationSource;
}

export type AllocationSource =
  | { type: 'rule'; ruleId: string }
  | { type: 'manual' }
  /** No rule matched at the last stock import: everything stays non allocated. */
  | { type: 'none' };

export type SegmentTotals = Record<SegmentId, number>;

export interface ItemSummary {
  item: Item;
  totals: SegmentTotals;
  nonAllocated: number;
  totalStock: number;
  activeSegments: number;
  /** Segments where at least one location is below its threshold. */
  warnings: SegmentId[];
}

export interface LocationRow {
  location: StockLocation;
  allocation: Allocation;
  /** Rule that produced the allocation (when source is a rule). */
  rule?: { id: string; name: string };
  nonAllocated: number;
  warnings: SegmentId[];
}

export interface ItemDetail {
  summary: ItemSummary;
  rows: LocationRow[];
  /** Rule the next stock import would use, per location id. */
  effectiveRules: Record<string, { id: string; name: string } | undefined>;
}

export type SortDirection = 'asc' | 'desc';
export interface Sort<K extends string> {
  key: K;
  direction: SortDirection;
}

export interface Page<T> {
  data: T[];
  total: number;
}

export type ItemSortKey = 'item' | SegmentId | 'nonAllocated' | 'totalStock' | 'activeSegments';

export interface ItemQuery {
  search?: string;
  /** Only items below threshold for this segment. */
  warningSegment?: SegmentId;
  /** Only items matched by this rule's criteria. */
  ruleId?: string;
  sort?: Sort<ItemSortKey>;
  page: number; // 0-based
  pageSize: number;
}

export interface WarningSummary {
  segment: SegmentId;
  itemCount: number;
}

/** Item characteristics a rule can be defined on. */
export type AttributeKey = 'sku' | 'category' | 'brand' | 'season';

/** Condition on one characteristic: the item value must be one of `values`. */
export interface Criterion {
  attribute: AttributeKey;
  values: string[];
}

export type RuleMode = 'percentage' | 'quantity';

/**
 * Segmentation rule, applied when the stock of a matching item is imported.
 * All criteria must match (AND); several values in one criterion are alternatives (OR).
 * When several rules match, the one with the lowest priority number wins.
 */
export interface SegmentationRule {
  id: string;
  name: string;
  priority: number;
  enabled: boolean;
  criteria: Criterion[];
  /** Empty = all stock locations. */
  locationIds: string[];
  mode: RuleMode;
  /** Percentage (0-100) or fixed quantity per location, by segment. */
  values: Record<SegmentId, number>;
  thresholds: Record<SegmentId, number | null>;
  period: ActivationPeriod;
  updatedAt: string; // ISO date-time
}

export type RuleInput = Omit<SegmentationRule, 'id' | 'priority' | 'updatedAt'>;

export interface RuleSummary {
  rule: SegmentationRule;
  matchedItemCount: number;
}

export interface RuleQuery {
  search?: string;
  /** Restrict the search to one characteristic. */
  attribute?: AttributeKey;
  page: number;
  pageSize: number;
}

export interface RulePage extends Page<RuleSummary> {
  /** Number of rules without search filter (last priority). */
  ruleCount: number;
  /** Set when the search is an item SKU: rules matching that item, the effective one first. */
  matchedItem?: { item: Item; effectiveRuleId?: string };
}

export interface RulePreview {
  itemCount: number;
  sample: Item[];
}

export interface StockImportRow {
  sku: string;
  locationCode: string;
  quantity: number;
}

export interface StockImportResult {
  updated: number;
  byRule: number;
  withoutRule: number;
  /** Allocations where fixed quantities exceeded the stock and were capped. */
  capped: number;
  errors: string[];
}

export interface ImportRow {
  sku: string;
  locationCode: string;
  segments: Partial<Record<SegmentId, SegmentAllocation>>;
  period?: ActivationPeriod;
}

export interface ImportResult {
  updated: number;
  errors: string[];
}
