import { mockApi } from './mockApi';
import type { StockAllocationApi } from './types';

/** Swap this for an HTTP implementation when the backend is ready. */
export const api: StockAllocationApi = mockApi;
export type { StockAllocationApi };
