import { useState } from 'react';
import { api } from '../api';
import { Modal } from '../components/ui';
import { DownloadIcon } from '../components/Icons';
import { useToast } from '../components/Toast';
import type { StockImportRow } from '../types';
import { downloadText, parseStockCsv, STOCK_HEADERS } from '../utils/csv';
import { plural } from '../utils/format';

/** Stock file import: the segmentation rules are applied to every imported line. */
export function StockImportModal({ onClose, onImported }: { onClose: () => void; onImported: () => void }) {
  const notify = useToast();
  const [fileName, setFileName] = useState<string>();
  const [rows, setRows] = useState<StockImportRow[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [importing, setImporting] = useState(false);

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setFileName(file.name);
    const parsed = parseStockCsv(await file.text());
    setRows(parsed.rows);
    setErrors(parsed.errors);
  };

  const run = async () => {
    setImporting(true);
    const res = await api.importStock(rows);
    setImporting(false);
    const summary =
      `${plural(res.updated, 'stock line')} imported: ${res.byRule} segmented by a rule, ${res.withoutRule} without rule` +
      (res.capped ? `, ${res.capped} capped` : '');
    if (res.errors.length) {
      setErrors(res.errors);
      setRows([]);
      notify(`${summary} — ${plural(res.errors.length, 'error')}`, res.updated ? 'info' : 'error');
      if (res.updated) onImported();
      return;
    }
    notify(summary);
    onImported();
  };

  return (
    <Modal
      title="Stock import"
      onClose={onClose}
      width={620}
      footer={
        <>
          <button type="button" className="btn btn--secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn--primary" disabled={!rows.length || errors.length > 0 || importing} onClick={run}>
            Import {rows.length > 0 && plural(rows.length, 'line')}
          </button>
        </>
      }
    >
      <p>
        Import the stock of items per stock location. For each line, the <strong>first enabled segmentation rule</strong> matching
        the item (by priority) computes the allocation. Without matching rule, the whole stock stays non allocated.
      </p>
      <p className="muted small">Columns: {STOCK_HEADERS.join(', ')}</p>
      <button
        type="button"
        className="btn btn--secondary"
        onClick={() => downloadText('stock-template.csv', `${STOCK_HEADERS.join(';')}\n1082108010944;0001;1000\n1082108010860;0002;250`)}
      >
        <DownloadIcon /> Download template
      </button>
      <label className="dropzone">
        <input type="file" accept=".csv,text/csv" onChange={(e) => onFile(e.target.files?.[0])} />
        {fileName ? (
          <span>
            <strong>{fileName}</strong> — {plural(rows.length, 'line')} read
          </span>
        ) : (
          <span>Click to choose a CSV file</span>
        )}
      </label>
      {errors.length > 0 && (
        <ul className="error-list">
          {errors.slice(0, 20).map((e) => (
            <li key={e}>{e}</li>
          ))}
          {errors.length > 20 && <li>… and {errors.length - 20} more</li>}
        </ul>
      )}
    </Modal>
  );
}
