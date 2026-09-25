// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------

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
  description?: string;
  /** All item features (OneStock items), in the default language. */
  features?: Record<string, string>;
  /** Where the item comes from: demo catalog or the OneStock API. */
  source?: 'demo' | 'onestock';
}

export interface StockLocation {
  id: string;
  code: string;
  name: string;
  city?: string;
  country?: string;
}

// ---------------------------------------------------------------------------
// Settings: stock types
// ---------------------------------------------------------------------------

/**
 * A stock type is also a segment. Main types (no parent, e.g. on_hand, container, planned)
 * can be divided into groups (children, e.g. on_hand_A, on_hand_B).
 * Stock is always updated on one stock type, then split onto its groups by the segmentation rules.
 */
export interface StockType {
  id: string;
  /** Technical code used in files and APIs (e.g. on_hand_A). */
  code: string;
  label: string;
  /** null for a main stock type. */
  parentId: string | null;
  /** Future stock (container, planned…): can carry a purchase order. Set on main types, inherited by groups. */
  future: boolean;
  /** Display order among siblings. */
  position: number;
}

export type StockTypeInput = Pick<StockType, 'code' | 'label' | 'parentId' | 'future'>;

// ---------------------------------------------------------------------------
// Stock & allocation
// ---------------------------------------------------------------------------

export type ActivationPeriod =
  | { type: 'always' }
  | { type: 'range'; start: string; end: string }; // ISO dates (yyyy-mm-dd)

export interface GroupAllocation {
  quantity: number;
  /** Alert threshold: a warning is raised when quantity < threshold. */
  threshold: number | null;
}

export type AllocationSource =
  | { type: 'rule'; ruleId: string }
  | { type: 'manual' }
  /** No rule matched at the last stock update: the whole quantity stays on the main stock type. */
  | { type: 'none' }
  /** Stock read from the OneStock API (stock_export), already segmented there. */
  | { type: 'onestock' };

/**
 * Stock of an item, in a location, on a stock type (and purchase order for future stock).
 * `split` holds the quantities moved to the groups of the stock type; the rest stays on the type itself.
 */
export interface StockLine {
  id: string;
  itemId: string;
  locationId: string;
  stockTypeId: string;
  purchaseOrder: string | null;
  quantity: number;
  split: Record<string, GroupAllocation>; // by group stock type id
  period: ActivationPeriod;
  source: AllocationSource;
  /** Future stock: expected arrival (unix seconds), as read from OneStock for the purchase order. */
  eta?: { start: number; end: number };
  /** OneStock lines: stock type code as written in OneStock, by stock type id (e.g. container_B → "Container_B"). */
  remoteTypes?: Record<string, string>;
}

/** Quantities by stock type id (main types = remaining after split, groups = split quantities). */
export type TypeTotals = Record<string, number>;

export interface ItemSummary {
  item: Item;
  totals: TypeTotals;
  totalStock: number;
  /** Number of stock types (segments) holding stock. */
  activeSegments: number;
  /** Stock type ids where at least one line is below its threshold. */
  warnings: string[];
}

export interface StockLineRow {
  line: StockLine;
  location: StockLocation;
  /** Quantity left on the main stock type after split. */
  remaining: number;
  warnings: string[];
  /** Rule that produced the split (when source is a rule). */
  rule?: { id: string; name: string };
  /** Rule the next stock update of this line would use. */
  nextRule?: { id: string; name: string };
}

export interface ItemDetail {
  summary: ItemSummary;
  rows: StockLineRow[];
  /** Stock read from the OneStock API: changes are sent back with stock_import. */
  onestock?: boolean;
  /** Information about the data (e.g. unknown stock types in the OneStock answer). */
  notices?: string[];
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

/** 'item' | 'totalStock' | 'activeSegments' | a stock type id. */
export type ItemSortKey = string;

export interface ItemQuery {
  search?: string;
  /** Only items below threshold for this stock type (group). */
  warningType?: string;
  /** Only items matched by this rule's criteria. */
  ruleId?: string;
  sort?: Sort<ItemSortKey>;
  page: number; // 0-based
  pageSize: number;
}

export interface WarningSummary {
  stockTypeId: string;
  itemCount: number;
}

// ---------------------------------------------------------------------------
// Segmentation rules
// ---------------------------------------------------------------------------

/** Item characteristics a rule can be defined on. */
export type AttributeKey = 'sku' | 'category' | 'brand' | 'season';

/** Condition on one characteristic: the item value must be one of `values`. */
export interface Criterion {
  attribute: AttributeKey;
  values: string[];
}

/**
 * Segmentation rule, applied when the stock of a matching item is updated on one of `stockTypeIds`.
 * All criteria must match (AND); several values in one criterion are alternatives (OR).
 * When several rules match, the one with the lowest priority number wins.
 */
export interface SegmentationRule {
  id: string;
  name: string;
  priority: number;
  enabled: boolean;
  criteria: Criterion[];
  /** Main stock types whose stock is split (empty = all main stock types). */
  stockTypeIds: string[];
  /** Restricts the rule to stock lines with these purchase orders, i.e. future stock only (empty = any). */
  purchaseOrders: string[];
  /** Empty = all stock locations. */
  locationIds: string[];
  /** Percentage (0-100) of the stock moved to each group, for the groups of every targeted stock type. */
  shares: Record<string, number>;
  thresholds: Record<string, number | null>;
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
  stockTypeId?: string;
  page: number;
  pageSize: number;
}

export interface RulePage extends Page<RuleSummary> {
  /** Number of rules without search filter (last priority). */
  ruleCount: number;
  /** Set when the search is an item SKU: the item, rules matching it are listed. */
  matchedItem?: { item: Item; effectiveRuleIds: string[] };
}

export interface RulePreview {
  itemCount: number;
  sample: Item[];
}

export interface StockImportRow {
  sku: string;
  locationCode: string;
  stockTypeCode: string;
  quantity: number;
  purchaseOrder: string | null;
}

export interface StockImportResult {
  updated: number;
  byRule: number;
  withoutRule: number;
  errors: string[];
}

/** One stock line of OneStock re-segmented by a rule (preview before sending it with stock_import). */
export interface OnestockRuleChange {
  item: Item;
  location: StockLocation;
  before: StockLine;
  after: StockLine;
  rule: { id: string; name: string };
  /** Why the line cannot be sent (e.g. future stock without ETA). */
  blocked?: string;
}

export interface OnestockRulePreview {
  changes: OnestockRuleChange[];
  /** Lines already split as the rule says. */
  unchanged: number;
  /** Lines without applicable rule (left as they are). */
  withoutRule: number;
  itemCount: number;
}
