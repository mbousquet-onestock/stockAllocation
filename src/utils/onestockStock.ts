import type { StockRecord } from '../api/onestock';
import type { StockLine } from '../types';
import type { StockTypeTree } from './stockTypes';

/**
 * Turns stock_export records into stock lines: one line per item × endpoint × main stock type × purchase order.
 * OneStock stock is already segmented: a record on a group (on_hand_A, Container_B…) is the quantity of that group,
 * a record on the main type (on_hand, Container…) is what stays on it; the line quantity is the sum.
 * Stock type codes are matched case-insensitively with the stock types of the settings.
 */
export function recordsToLines(records: StockRecord[], tree: StockTypeTree): { lines: StockLine[]; unknownTypes: string[] } {
  const lines = new Map<string, StockLine>();
  const unknown = new Set<string>();
  records.forEach((r) => {
    const type = tree.byCode(r.type ?? '');
    if (!type) {
      unknown.add(r.type || '(empty)');
      return;
    }
    const main = type.parentId ? tree.byId(type.parentId)! : type;
    const po = main.future ? r.purchase_order_number?.trim() || null : null;
    const id = ['onestock', r.item_id, r.endpoint_id, main.id, po ?? ''].join('|');
    let line = lines.get(id);
    if (!line) {
      line = {
        id,
        itemId: r.item_id,
        locationId: r.endpoint_id,
        stockTypeId: main.id,
        purchaseOrder: po,
        quantity: 0,
        split: Object.fromEntries(tree.groupsOf(main.id).map((g) => [g.id, { quantity: 0, threshold: null }])),
        period: { type: 'always' },
        source: { type: 'onestock' },
      };
      lines.set(id, line);
    }
    const q = Number(r.quantity) || 0;
    line.quantity += q;
    if (type.parentId) line.split[type.id] = { quantity: (line.split[type.id]?.quantity ?? 0) + q, threshold: null };
    if (r.eta_start || r.eta_end) {
      const start = r.eta_start ?? r.eta_end!;
      const end = r.eta_end ?? r.eta_start!;
      line.eta = line.eta ? { start: Math.min(line.eta.start, start), end: Math.max(line.eta.end, end) } : { start, end };
    }
  });
  return { lines: [...lines.values()], unknownTypes: [...unknown] };
}
