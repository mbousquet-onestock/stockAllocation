import { useState } from 'react';
import { api } from '../api';
import { Modal, Spinner } from '../components/ui';
import { WarningIcon } from '../components/Icons';
import { useStockTypes } from '../components/StockTypes';
import { useToast } from '../components/Toast';
import type { StockLine } from '../types';
import { plural } from '../utils/format';
import { useAsync } from '../utils/useAsync';

function SplitText({ line }: { line: StockLine }) {
  const tree = useStockTypes();
  const groups = tree.groupsOf(line.stockTypeId);
  const split = groups.reduce((s, g) => s + (line.split[g.id]?.quantity ?? 0), 0);
  return (
    <span className="split-text">
      {groups.map((g) => (
        <span key={g.id}>
          <span className="muted">{g.code}</span> {line.split[g.id]?.quantity ?? 0}
        </span>
      ))}
      <span>
        <span className="muted">{tree.code(line.stockTypeId)}</span> {line.quantity - split}
      </span>
    </span>
  );
}

/**
 * Applies the segmentation rules to the OneStock stock: preview of the lines the rules would change,
 * then PATCH stock_import. Without itemIds, every item holding stock is considered.
 */
export function ApplyRulesOnestockModal({ itemIds, onClose, onDone }: { itemIds?: string[]; onClose: () => void; onDone: () => void }) {
  const notify = useToast();
  const tree = useStockTypes();
  const preview = useAsync(() => api.previewOnestockRules(itemIds), []);
  const [sending, setSending] = useState(false);
  const sendable = (preview.data?.changes ?? []).filter((c) => !c.blocked);

  const send = async () => {
    setSending(true);
    try {
      const res = await api.pushOnestockLines(sendable.map((c) => c.after));
      notify(`${plural(sendable.length, 'stock line')} sent to OneStock (${plural(res.sent, 'record')}, ${plural(res.calls, 'call')})`);
      onDone();
    } catch (e) {
      notify((e as Error).message, 'error');
      setSending(false);
    }
  };

  return (
    <Modal
      title="Apply the rules to the OneStock stock"
      onClose={onClose}
      width={1000}
      footer={
        <>
          <span className="footer-hint muted small">The new split is sent with PATCH stock_import.</span>
          <button type="button" className="btn btn--secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn--primary" disabled={!sendable.length || sending} onClick={send}>
            Send {plural(sendable.length, 'line')} to OneStock
          </button>
        </>
      }
    >
      {preview.loading && <Spinner />}
      {preview.error && <p className="text-error">{preview.error.message}</p>}
      {preview.data && (
        <>
          <p>
            {plural(preview.data.itemCount, 'item')} checked: <strong>{plural(preview.data.changes.length, 'stock line')} to re-segment</strong>,{' '}
            {preview.data.unchanged} already split as the rules say, {preview.data.withoutRule} without applicable rule (left as they are).
          </p>
          {preview.data.changes.length > 0 && (
            <div className="table-wrap preview-table">
              <table className="table table--compact">
                <thead>
                  <tr>
                    <th>Item</th>
                    <th>Stock location</th>
                    <th>Stock type · PO</th>
                    <th>Qty</th>
                    <th>Current split</th>
                    <th>New split</th>
                    <th>Rule</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.data.changes.map((c) => (
                    <tr key={c.before.id} className={c.blocked ? 'is-disabled' : ''}>
                      <td>
                        <div>{c.item.name}</div>
                        <div className="muted small">{c.item.sku}</div>
                      </td>
                      <td>{c.location.name}</td>
                      <td>
                        <code>{tree.code(c.before.stockTypeId)}</code>
                        {c.before.purchaseOrder && <span className="muted small"> · {c.before.purchaseOrder}</span>}
                      </td>
                      <td>{c.before.quantity}</td>
                      <td>
                        <SplitText line={c.before} />
                      </td>
                      <td>
                        <strong>
                          <SplitText line={c.after} />
                        </strong>
                        {c.blocked && (
                          <div className="text-warning small">
                            <WarningIcon width={12} height={12} /> {c.blocked}
                          </div>
                        )}
                      </td>
                      <td className="small">{c.rule.name}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </Modal>
  );
}
