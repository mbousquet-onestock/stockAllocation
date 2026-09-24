import type {
  Allocation,
  ApplyResult,
  ImportResult,
  ImportRow,
  ItemDetail,
  ItemQuery,
  ItemSummary,
  Page,
  StockLocation,
  WarningSummary,
  Item,
  SegmentationRule,
} from '../types';

/**
 * Contract between the UI and the backend.
 * The mock implementation lives in mockApi.ts; a real HTTP implementation
 * only needs to implement this interface and be exported from api/index.ts.
 */
export interface StockAllocationApi {
  listItems(query: ItemQuery): Promise<Page<ItemSummary>>;
  getWarningSummary(): Promise<WarningSummary[]>;
  getItemDetail(itemId: string): Promise<ItemDetail>;
  /** Items / categories lookup used when building a segmentation rule. */
  searchItems(search: string, limit?: number): Promise<Item[]>;
  listCategories(): Promise<Array<{ name: string; itemCount: number }>>;
  listLocations(): Promise<StockLocation[]>;
  updateAllocation(allocation: Allocation): Promise<Allocation>;
  applyRule(rule: SegmentationRule): Promise<ApplyResult>;
  importRows(rows: ImportRow[]): Promise<ImportResult>;
  /** Mock only: restore the initial data set. */
  reset?(): Promise<void>;
}
