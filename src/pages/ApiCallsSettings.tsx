import { Fragment, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { fetchDatabaseLog, getApiLog, purgeApiLog, subscribeApiLog, type ApiLogEntry } from '../api/apiLog';
import { getDbConfig } from '../api/dbConfig';
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
  const local = useSyncExternalStore(subscribeApiLog, getApiLog);
  const notify = useToast();
  // History stored in the database when Settings → Database uses the Vercel database.
  const inDatabase = getDbConfig().mode === 'remote';
  const PAGE = 100;
  const [db, setDb] = useState<{ calls: ApiLogEntry[]; total: number; all: number; errors: number; error?: string; loading: boolean }>({
    calls: [],
    total: 0,
    all: 0,
    errors: 0,
    loading: inDatabase,
  });
  const [dbLimit, setDbLimit] = useState(PAGE);
  const [target, setTarget] = useState<'' | ApiLogEntry['target']>('');
  const [errorsOnly, setErrorsOnly] = useState(false);
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState<number | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);

  // Database: server side filters, reloaded when a new call is logged.
  useEffect(() => {
    if (!inDatabase) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      setDb((d) => ({ ...d, loading: true }));
      fetchDatabaseLog({ target, errorsOnly, search, limit: dbLimit, offset: 0 })
        .then((r) => !cancelled && setDb({ ...r, loading: false }))
        .catch((e: Error) => !cancelled && setDb((d) => ({ ...d, loading: false, error: e.message })));
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [inDatabase, target, errorsOnly, search, dbLimit, local]);

  const entries = inDatabase ? db.calls : local;
  const list = useMemo(() => {
    if (inDatabase) return entries;
    const q = search.trim().toLowerCase();
    return entries.filter(
      (e) =>
        (!target || e.target === target) &&
        (!errorsOnly || !e.ok) &&
        (!q || [e.method, e.path, e.summary ?? '', e.error ?? '', JSON.stringify(e.request ?? '')].join(' ').toLowerCase().includes(q)),
    );
  }, [entries, target, errorsOnly, search, inDatabase]);
  const errors = inDatabase ? db.errors : entries.filter((e) => !e.ok).length;
  const total = inDatabase ? db.total : list.length;

  return (
    <div>
      <div className="settings-header">
        <div>
          <h2>API calls</h2>
          <p className="muted">
            Every call made by the application to the <strong>OneStock API</strong> (through the proxy) and to the{' '}
            <strong>database</strong>, with its request and its result; tokens and keys are masked.{' '}
            {inDatabase ? (
              <>
                The history is <strong>stored in the database</strong> (<code>api_calls</code> table).
              </>
            ) : (
              <>The last 300 calls are kept in this browser (use the Vercel database in Settings → Database to keep the history).</>
            )}
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
          <button type="button" className="btn btn--secondary" disabled={!entries.length && !total} onClick={() => setConfirmClear(true)}>
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
        <span className="muted small">
          {inDatabase && db.loading ? 'Loading…' : inDatabase ? `${list.length} / ${plural(total, 'call')}` : plural(total, 'call')}
        </span>
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
        {inDatabase && db.error && <div className="text-error empty">History unavailable: {db.error}</div>}
        {!list.length && !db.error && <div className="muted empty">{search || target || errorsOnly ? 'No call matches the filters.' : 'No API call yet.'}</div>}
        {inDatabase && list.length < total && (
          <div className="empty">
            <button type="button" className="btn btn--secondary" disabled={db.loading} onClick={() => setDbLimit((l) => l + PAGE)}>
              Load more ({total - list.length} left)
            </button>
          </div>
        )}
      </div>

      {confirmClear && (
        <ConfirmModal
          title="Clear the API calls"
          confirmLabel="Clear"
          danger
          onClose={() => setConfirmClear(false)}
          onConfirm={() => {
            setConfirmClear(false);
            purgeApiLog()
              .then((n) => {
                notify(inDatabase ? `History purged: ${plural(n, 'call')} deleted from the database` : 'History cleared', 'info');
                setDbLimit(PAGE);
                setDb((d) => ({ ...d, calls: [], total: 0, all: 0, errors: 0 }));
              })
              .catch((e: Error) => notify(e.message, 'error'));
          }}
        >
          <p>
            {inDatabase ? (
              <>
                Purge the <strong>whole history of the database</strong> ({plural(db.all, 'call')}), and the calls kept in this browser?
              </>
            ) : (
              <>Delete the {plural(local.length, 'logged call')} kept in this browser?</>
            )}
          </p>
        </ConfirmModal>
      )}
    </div>
  );
}
