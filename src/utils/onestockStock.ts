import type { StockImportRecord, StockRecord } from '../api/onestock';
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
        remoteTypes: {},
      };
      lines.set(id, line);
    }
    line.remoteTypes![type.id] = r.type;
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

/**
 * OneStock code of a stock type for a line: the code read from OneStock when known, else derived from any code read
 * for the same line (e.g. "Container_A" read for container_A → main "Container", group container_B → "Container_B"),
 * else the code of the settings.
 */
function remoteCode(line: StockLine, typeId: string, tree: StockTypeTree): string {
  const known = line.remoteTypes?.[typeId];
  if (known) return known;
  const main = tree.byId(line.stockTypeId)!;
  const target = tree.byId(typeId)!;
  const suffix = (code: string) => (code.toLowerCase().startsWith(main.code.toLowerCase()) ? code.slice(main.code.length) : undefined);
  const targetSuffix = suffix(target.code);
  for (const [id, remote] of Object.entries(line.remoteTypes ?? {})) {
    const ownSuffix = suffix(tree.byId(id)?.code ?? '');
    if (targetSuffix === undefined || ownSuffix === undefined) continue;
    if (!remote.toLowerCase().endsWith(ownSuffix.toLowerCase())) continue;
    return remote.slice(0, remote.length - ownSuffix.length) + targetSuffix;
  }
  return target.code;
}

/**
 * stock_import records of a line: the main type keeps quantity − split, each group gets its split quantity.
 * Future stock carries the purchase order and the ETA read at the GET.
 */
export function lineToRecords(line: StockLine, tree: StockTypeTree): StockImportRecord[] {
  const main = tree.byId(line.stockTypeId);
  if (!main) return [];
  const extra = {
    ...(line.purchaseOrder ? { purchase_order_number: line.purchaseOrder } : {}),
    ...(line.eta ? { eta_start: line.eta.start, eta_end: line.eta.end } : {}),
  };
  const groups = tree.groupsOf(main.id);
  const split = groups.reduce((s, g) => s + (line.split[g.id]?.quantity ?? 0), 0);
  const record = (typeId: string, quantity: number): StockImportRecord => ({
    item_id: line.itemId,
    endpoint_id: line.locationId,
    quantity,
    type: remoteCode(line, typeId, tree),
    ...extra,
  });
  return [record(main.id, line.quantity - split), ...groups.map((g) => record(g.id, line.split[g.id]?.quantity ?? 0))];
}
