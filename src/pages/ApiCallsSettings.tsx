import { Fragment, useMemo, useState, useSyncExternalStore } from 'react';
import { clearApiLog, getApiLog, subscribeApiLog, type ApiLogEntry } from '../api/apiLog';
import { ConfirmModal } from '../components/ConfirmModal';
import { DownloadIcon } from '../components/Icons';
import { useToast } from '../components/Toast';
import { downloadText } from '../utils/csv';
import { plural } from '../utils/format';

const pretty = (v: unknown) => (typeof v === 'string' ? v : JSON.stringify(v, null, 2));

function JsonBlock({ title, value }: { title: string; value: unknown }) {
  const notify = useToast();
  if (value === undefined) return null;
  return (
    <div className="json-block">
      <div className="json-block__header">
        <strong>{title}</strong>
        <button
          type="button"
          className="link small"
          onClick={() => navigator.clipboard?.writeText(pretty(value)).then(() => notify('Copied', 'info'))}
        >
          Copy
        </button>
      </div>
      <pre>{pretty(value)}</pre>
    </div>
  );
}

/** Settings → API calls: every call made to OneStock (through the proxy) and to the database, with its result. */
export function ApiCallsSettings() {
  const entries = useSyncExternalStore(subscribeApiLog, getApiLog);
  const [target, setTarget] = useState<'' | ApiLogEntry['target']>('');
  const [errorsOnly, setErrorsOnly] = useState(false);
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState<number | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);

  const list = useMemo(() => {
    const q = search.trim().toLowerCase();
    return entries.filter(
      (e) =>
        (!target || e.target === target) &&
        (!errorsOnly || !e.ok) &&
        (!q || [e.method, e.path, e.summary ?? '', e.error ?? '', JSON.stringify(e.request ?? '')].join(' ').toLowerCase().includes(q)),
    );
  }, [entries, target, errorsOnly, search]);
  const errors = entries.filter((e) => !e.ok).length;

  return (
    <div>
      <div className="settings-header">
        <div>
          <h2>API calls</h2>
          <p className="muted">
            Every call made by the application to the <strong>OneStock API</strong> (through the proxy) and to the{' '}
            <strong>database</strong>, with its request and its result. The last 300 calls are kept in this browser; tokens and keys
            are masked.
          </p>
        </div>
        <span className="row-actions">
          <button
            type="button"
            className="btn btn--secondary"
            disabled={!list.length}
            onClick={() => downloadText(`api-calls-${new Date().toISOString().slice(0, 19)}.json`, JSON.stringify(list, null, 2))}
          >
            <DownloadIcon /> Export
          </button>
          <button type="button" className="btn btn--secondary" disabled={!entries.length} onClick={() => setConfirmClear(true)}>
            Clear
          </button>
        </span>
      </div>

      <div className="toolbar api-toolbar">
        <select className="select" value={target} onChange={(e) => setTarget(e.target.value as typeof target)} aria-label="Target">
          <option value="">All APIs</option>
          <option value="OneStock">OneStock</option>
          <option value="Database">Database</option>
        </select>
        <label className="checkbox">
          <input type="checkbox" checked={errorsOnly} onChange={(e) => setErrorsOnly(e.target.checked)} />
          <span>Errors only{errors ? ` (${errors})` : ''}</span>
        </label>
        <input className="input grow" placeholder="Search a path, an id, an error…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <span className="muted small">{plural(list.length, 'call')}</span>
      </div>

      <div className="table-wrap">
        <table className="table table--compact api-table">
          <thead>
            <tr>
              <th>Time</th>
              <th>API</th>
              <th>Method</th>
              <th>Path</th>
              <th>Status</th>
              <th className="col-num">Duration</th>
              <th>Result</th>
            </tr>
          </thead>
          <tbody>
            {list.map((e) => (
              <Fragment key={e.id}>
                <tr className={`is-clickable ${open === e.id ? 'is-highlighted' : ''}`} onClick={() => setOpen(open === e.id ? null : e.id)}>
                  <td className="nowrap">
                    {new Date(e.at).toLocaleDateString('fr-FR')} {new Date(e.at).toLocaleTimeString('fr-FR')}
                  </td>
                  <td>
                    <span className={`badge ${e.target === 'OneStock' ? 'badge--rule' : 'badge--future'}`}>{e.target}</span>
                  </td>
                  <td>
                    <code>{e.method}</code>
                  </td>
                  <td className="api-path" title={e.path}>
                    {e.path}
                  </td>
                  <td>
                    <span className={`badge ${e.ok ? 'badge--success' : 'badge--warning'}`}>{e.status ?? (e.ok ? 'OK' : 'Error')}</span>
                  </td>
                  <td className="col-num">{e.durationMs} ms</td>
                  <td className={e.ok ? 'small' : 'small text-error'}>{e.ok ? e.summary ?? 'OK' : e.error}</td>
                </tr>
                {open === e.id && (
                  <tr className="api-detail">
                    <td colSpan={7}>
                      <div className="api-detail__blocks">
                        <JsonBlock title="Request" value={e.request} />
                        <JsonBlock title={e.ok ? `Response${e.truncated ? ' (truncated)' : ''}` : 'Error'} value={e.ok ? e.response : e.response ?? e.error} />
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
        {!list.length && <div className="muted empty">{entries.length ? 'No call matches the filters.' : 'No API call yet.'}</div>}
      </div>

      {confirmClear && (
        <ConfirmModal
          title="Clear the API calls"
          confirmLabel="Clear"
          danger
          onClose={() => setConfirmClear(false)}
          onConfirm={() => {
            clearApiLog();
            setConfirmClear(false);
          }}
        >
          <p>Delete the {plural(entries.length, 'logged call')} kept in this browser?</p>
        </ConfirmModal>
      )}
    </div>
  );
}
