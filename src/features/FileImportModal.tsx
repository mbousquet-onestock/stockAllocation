import { useState } from 'react';
import { api } from '../api';
import { Modal } from '../components/ui';
import { DownloadIcon } from '../components/Icons';
import { useToast } from '../components/Toast';
import type { ImportRow } from '../types';
import { downloadText, IMPORT_HEADERS, parseImportCsv, templateCsv } from '../utils/csv';
import { plural } from '../utils/format';

export function FileImportModal({
  sample,
  onClose,
  onImported,
}: {
  /** Pre-filled rows for the template (e.g. the current item's locations). */
  sample?: Array<{ sku: string; locationCode: string }>;
  onClose: () => void;
  onImported: () => void;
}) {
  const notify = useToast();
  const [fileName, setFileName] = useState<string>();
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [importing, setImporting] = useState(false);

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setFileName(file.name);
    const parsed = parseImportCsv(await file.text());
    setRows(parsed.rows);
    setErrors(parsed.errors);
  };

  const run = async () => {
    setImporting(true);
    const res = await api.importRows(rows);
    setImporting(false);
    if (res.errors.length) {
      setErrors(res.errors);
      notify(`${plural(res.updated, 'line')} imported, ${plural(res.errors.length, 'error')}`, res.updated ? 'info' : 'error');
      if (res.updated) onImported();
      setRows([]);
      return;
    }
    notify(`${plural(res.updated, 'line')} imported`);
    onImported();
  };

  return (
    <Modal
      title="File import"
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
        Import a CSV file (<code>;</code> or <code>,</code> separated) with one line per item and stock location. Empty cells keep the
        current value. Dates use the <code>yyyy-mm-dd</code> format, put <code>always</code> in <code>start_date</code> for “All the time”.
      </p>
      <p className="muted small">Columns: {IMPORT_HEADERS.join(', ')}</p>
      <button type="button" className="btn btn--secondary" onClick={() => downloadText('segmentation-template.csv', templateCsv(sample))}>
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
