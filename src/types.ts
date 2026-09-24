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
  /** Free attributes displayed under the name (e.g. capacity). */
  attributes: string[];
  category: string;
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
}

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
  nonAllocated: number;
  warnings: SegmentId[];
}

export interface ItemDetail {
  summary: ItemSummary;
  rows: LocationRow[];
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
  sort?: Sort<ItemSortKey>;
  page: number; // 0-based
  pageSize: number;
}

export interface WarningSummary {
  segment: SegmentId;
  itemCount: number;
}

/** Target of a segmentation rule: explicit items or whole categories. */
export type RuleTarget =
  | { type: 'items'; itemIds: string[] }
  | { type: 'categories'; categories: string[] };

export type RuleMode = 'percentage' | 'quantity';

/** A segmentation rule applied in bulk to a set of items. */
export interface SegmentationRule {
  target: RuleTarget;
  /** Empty = all stock locations. */
  locationIds: string[];
  mode: RuleMode;
  /** Percentage (0-100) or fixed quantity per location, by segment. */
  values: Record<SegmentId, number>;
  thresholds: Record<SegmentId, number | null>;
  period: ActivationPeriod;
}

export interface ApplyResult {
  itemCount: number;
  allocationCount: number;
  /** Allocations where fixed quantities exceeded the stock and were capped. */
  cappedCount: number;
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
