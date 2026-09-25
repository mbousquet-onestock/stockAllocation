import type { StockImportRow } from '../types';

export function downloadText(filename: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export const STOCK_HEADERS = ['sku', 'location_code', 'stock_type', 'quantity', 'purchase_order'];
/** stock_type is optional: empty or missing = on_hand, the default stock type. */
const REQUIRED = ['sku', 'location_code', 'quantity'];

/** Parses a stock file: one line per item, stock location, stock type (and purchase order for future stock). */
export function parseStockCsv(text: string): { rows: StockImportRow[]; errors: string[] } {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return { rows: [], errors: ['The file is empty'] };
  const sep = lines[0].includes(';') ? ';' : ',';
  const headers = lines[0].split(sep).map((h) => h.trim().toLowerCase());
  const col = (name: string) => headers.indexOf(name);
  if (REQUIRED.some((h) => col(h) < 0)) return { rows: [], errors: [`Required columns: ${REQUIRED.join(', ')}`] };
  const rows: StockImportRow[] = [];
  const errors: string[] = [];
  lines.slice(1).forEach((line, i) => {
    const cells = line.split(sep).map((c) => c.trim());
    const get = (name: string) => (col(name) >= 0 ? cells[col(name)] ?? '' : '');
    const quantity = Number(get('quantity'));
    if (get('quantity') === '' || !Number.isInteger(quantity) || quantity < 0) {
      errors.push(`Line ${i + 2}: invalid quantity "${get('quantity')}"`);
      return;
    }
    rows.push({
      sku: get('sku'),
      locationCode: get('location_code'),
      stockTypeCode: get('stock_type') || 'on_hand',
      quantity,
      purchaseOrder: get('purchase_order') || null,
    });
  });
  return { rows, errors };
}
