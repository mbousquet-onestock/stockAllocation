import type {
  AttributeKey,
  Item,
  ItemDetail,
  ItemQuery,
  ItemSummary,
  Page,
  RuleInput,
  RulePage,
  RulePreview,
  RuleQuery,
  SegmentationRule,
  StockImportResult,
  StockImportRow,
  StockLine,
  StockLocation,
  StockType,
  StockTypeInput,
  WarningSummary,
} from '../types';

/**
 * Contract between the UI and the backend.
 * The mock implementation lives in mockApi.ts; a real HTTP implementation
 * only needs to implement this interface and be exported from api/index.ts.
 */
export interface StockAllocationApi {
  // --- Settings: stock types
  listStockTypes(): Promise<StockType[]>;
  createStockType(input: StockTypeInput): Promise<StockType>;
  updateStockType(id: string, input: StockTypeInput): Promise<StockType>;
  /** Refused while the type (or one of its groups) is used by stock or rules. */
  deleteStockType(id: string): Promise<void>;
  /** Moves a stock type one step up (-1) or down (+1) among its siblings. */
  moveStockType(id: string, direction: -1 | 1): Promise<void>;

  // --- Segmentation rules
  listRules(query: RuleQuery): Promise<RulePage>;
  getRule(ruleId: string): Promise<SegmentationRule>;
  createRule(rule: RuleInput): Promise<SegmentationRule>;
  updateRule(ruleId: string, rule: RuleInput): Promise<SegmentationRule>;
  deleteRule(ruleId: string): Promise<void>;
  /** Moves a rule one step up (-1) or down (+1) in the priority order. */
  moveRule(ruleId: string, direction: -1 | 1): Promise<void>;
  /** Items matched by some criteria (rule editor preview). */
  previewCriteria(rule: Pick<SegmentationRule, 'criteria'>): Promise<RulePreview>;
  /** Existing values of an item characteristic, for criteria suggestions. */
  listAttributeValues(attribute: AttributeKey, search: string): Promise<Array<{ value: string; label?: string; itemCount: number }>>;
  /** Purchase orders present on future stock of these types (empty = all), for suggestions. */
  listPurchaseOrders(stockTypeIds: string[], search: string): Promise<Array<{ value: string; itemCount: number }>>;
  /** Re-runs the rules on the current stock (all lines, or those of the items matched by one rule). */
  applyRulesToCurrentStock(ruleId?: string): Promise<StockImportResult>;

  // --- Stock & allocation
  /** Stock update on a stock type: each line is then split by the rules. */
  importStock(rows: StockImportRow[]): Promise<StockImportResult>;
  listItems(query: ItemQuery): Promise<Page<ItemSummary>>;
  getWarningSummary(): Promise<WarningSummary[]>;
  getItemDetail(itemId: string): Promise<ItemDetail>;
  listLocations(): Promise<StockLocation[]>;
  /** Manual override of the split of one stock line. */
  updateStockLine(line: StockLine): Promise<StockLine>;
  searchItems(search: string, limit?: number): Promise<Item[]>;

  /** Mock only: restore the initial data set. */
  reset?(): Promise<void>;
}
