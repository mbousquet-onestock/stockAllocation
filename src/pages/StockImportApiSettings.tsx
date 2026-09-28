import { useEffect, useMemo, useState } from 'react';
import { getDbConfig } from '../api/dbConfig';
import { fetchEndpoints, fetchItemIndex, getOnestockConfig, isOnestockConfigured } from '../api/onestock';
import { remoteRules, type StockImportAnswer } from '../api/remoteRules';
import { currentSiteId } from '../api/site';
import { ConfirmModal } from '../components/ConfirmModal';
import { CheckIcon, WarningIcon } from '../components/Icons';
import { useToast } from '../components/Toast';
import { Checkbox, Spinner } from '../components/ui';
import { plural } from '../utils/format';

type Mode = 'import' | 'items' | 'catalog';

const MODES: Array<{ key: Mode; label: string; help: string }> = [
  {
    key: 'import',
    label: 'Import stock',
    help: 'Each record gives the stock of an item × endpoint × main stock type (× purchase order for future stock): the new quantity (update) or a variation (incremental: true). The resulting stock is split onto the groups by the rule of the item.',
  },
  { key: 'items', label: 'Re-segment items', help: 'The current OneStock stock of these items is split again with the rules.' },
  {
    key: 'catalog',
    label: 'Re-segment the catalog',
    help: 'Item ids read with v3/items from the cursor, only the items matched by a rule are segmented. Call again with next_cursor until it is null.',
  },
];

/** Example body of a mode, with ids of the OneStock catalog when known. */
function example(mode: Mode, itemIds: string[], endpointIds: string[]): string {
  const item = (i: number) => itemIds[i] ?? itemIds[0] ?? 'ITEM_ID';
  const endpoint = (i: number) => endpointIds[i] ?? endpointIds[0] ?? 'ENDPOINT_ID';
  if (mode === 'items') return JSON.stringify({ item_ids: [item(0), item(1)] }, null, 2);
  if (mode === 'catalog') return JSON.stringify({ limit: 200 }, null, 2);
  const inTwoWeeks = Math.round(Date.now() / 1000 / 86400 + 14) * 86400;
  return JSON.stringify(
    {
      stocks: [
        { item_id: item(0), endpoint_id: endpoint(0), type: 'on_hand', quantity: 40 },
        {
          item_id: item(1),
          endpoint_id: endpoint(1),
          type: 'container',
          quantity: 10,
          purchase_order_number: 'PO_001',
          eta_start: inTwoWeeks,
          eta_end: inTwoWeeks,
        },
      ],
    },
    null,
    2,
  );
}

interface Check {
  label: string;
  ok: boolean;
  detail?: string;
}

const FIELDS: Array<[string, string, string]> = [
  ['stocks', 'array (≤ 5 000)', 'Import mode: records to import (fields below).'],
  ['stocks[].item_id', 'string, required', 'OneStock item id.'],
  ['stocks[].endpoint_id', 'string, required', 'OneStock endpoint (stock location) id.'],
  ['incremental', 'boolean (default false)', 'Import mode. false = update: quantity is the new stock of the main stock type. true = incremental: quantity is a variation added to the current OneStock stock (may be negative; a line whose stock would become negative is refused). { "import": { "incremental": true } } is accepted too.'],
  ['stocks[].quantity', 'number, required', 'Update: new total quantity of the main stock type (≥ 0). Incremental: variation (+ / −).'],
  ['stocks[].type', 'string', 'Main stock type code (on_hand, container…). Absent = on_hand. A group (on_hand_A…) is refused: the rules split the main type.'],
  ['stocks[].purchase_order_number', 'string', 'Required on future stock types (container, planned…), ignored otherwise.'],
  ['stocks[].eta_start / eta_end', 'unix seconds', 'Future stock: expected arrival. Without ETA (sent or read in OneStock) the line is not sent.'],
  ['item_ids', 'array (≤ 500)', 'Items mode: items whose current OneStock stock is re-segmented.'],
  ['limit', 'number (1-500, default 200)', 'Catalog mode: number of item ids read per call.'],
  ['cursor', 'array', 'Catalog mode: next_cursor of the previous answer (absent = start of the catalog).'],
  ['dry_run', 'boolean', 'true: computes the changes without sending them to OneStock.'],
];

const ANSWER: Array<[string, string]> = [
  ['mode', 'import, items or catalog'],
  ['items_scanned / items_matched', 'Items read / items matched by at least one rule'],
  ['lines', 'Stock lines looked at (item × endpoint × main type × purchase order)'],
  ['changed / unchanged / blocked', 'Lines sent / already segmented as the rules say / not sent (future stock without ETA)'],
  ['without_rule', 'Lines without applicable rule: the groups keep their quantity, the rest goes on the main type'],
  ['records_sent / stock_import_calls', 'stock_import records (variations, incremental: true) and calls (500 records per call)'],
  ['next_cursor', 'Catalog mode: cursor of the next call, null at the end'],
  ['errors', 'Rejected records, unknown items or stock types'],
  ['changes', 'Before / after quantity of each segment, with the applied rule'],
  ['records', 'stock_import records sent (or that would be sent with dry_run)'],
];

/** Settings → Stock import API: how to call /api/stock-import, prerequisites of the site, and a tester. */
export function StockImportApiSettings() {
  const notify = useToast();
  const db = getDbConfig();
  const site = currentSiteId();
  const endpoint = useMemo(() => {
    const base = db.apiUrl.replace(/\/+$/, '') || '/api';
    return new URL(`${base}/stock-import`, window.location.origin).toString();
  }, [db.apiUrl]);

  const [checks, setChecks] = useState<Check[]>();
  const [ids, setIds] = useState<{ items: string[]; endpoints: string[] }>({ items: [], endpoints: [] });
  const [mode, setMode] = useState<Mode>('import');
  const [bodies, setBodies] = useState<Partial<Record<Mode, string>>>({});
  const [dryRun, setDryRun] = useState(true);
  const [incremental, setIncremental] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [answer, setAnswer] = useState<{ data?: StockImportAnswer; error?: string; request?: unknown }>();
  const [showKey, setShowKey] = useState(false);

  // Prerequisites of the site, read in the database.
  useEffect(() => {
    if (db.mode !== 'remote' || !site) return;
    Promise.all([remoteRules.getSiteSettings(), remoteRules.list()])
      .then(([s, rules]) => {
        const onestock = (s.settings?.onestock ?? {}) as { url?: string; stockRequest?: string };
        const enabled = rules.filter((r) => r.enabled).length;
        setChecks([
          { label: 'OneStock URL stored for the site', ok: !!onestock.url, detail: onestock.url || 'Save Settings → OneStock API' },
          { label: 'OneStock token stored in the database', ok: s.hasToken, detail: s.hasToken ? undefined : 'Check "Store the token in the database" in Settings → OneStock API' },
          { label: 'Stock types stored for the site', ok: !!s.settings?.stockTypes?.length, detail: s.settings?.stockTypes?.length ? `${s.settings.stockTypes.length} stock types and groups` : 'Open Settings → Stock types once' },
          { label: 'Enabled segmentation rules', ok: enabled > 0, detail: plural(enabled, 'rule') },
          { label: 'Stock request (request_name of stock_export)', ok: true, detail: onestock.stockRequest || '(none: default export)' },
        ]);
      })
      .catch((e: Error) => setChecks([{ label: 'Database', ok: false, detail: e.message }]));
  }, [db.mode, site]);

  // Real ids for the examples.
  useEffect(() => {
    const c = getOnestockConfig();
    if (!isOnestockConfigured(c)) return;
    Promise.all([c.useForItems ? fetchItemIndex() : Promise.resolve([]), fetchEndpoints()])
      .then(([items, endpoints]) => setIds({ items: items.slice(0, 2), endpoints: endpoints.slice(0, 2).map((e) => e.id) }))
      .catch(() => undefined);
  }, []);

  const body = bodies[mode] ?? example(mode, ids.items, ids.endpoints);
  const parsed = useMemo((): { value?: Record<string, unknown>; error?: string } => {
    try {
      const v = JSON.parse(body);
      if (!v || typeof v !== 'object' || Array.isArray(v)) return { error: 'The body must be a JSON object' };
      return { value: v };
    } catch (e) {
      return { error: (e as Error).message };
    }
  }, [body]);
  const request = parsed.value ? { ...parsed.value, ...(mode === 'import' ? { incremental } : {}), dry_run: dryRun } : undefined;

  const curl = [
    `curl -X POST '${endpoint}' \\`,
    `  -H 'Content-Type: application/json' \\`,
    `  -H 'x-api-key: ${db.apiKey ? (showKey ? db.apiKey : '<API key>') : '<API key, if API_KEY is set>'}' \\`,
    `  -H 'x-site-id: ${site || '<site id>'}' \\`,
    `  -d '${JSON.stringify(request ?? {})}'`,
  ].join('\n');

  const send = async (extra?: Record<string, unknown>) => {
    if (!request) return;
    const payload = { ...request, ...extra };
    setBusy(true);
    setAnswer(undefined);
    try {
      const data = await remoteRules.stockImport(payload);
      setAnswer({ data, request: payload });
      if (!data.dry_run && data.records_sent) notify(`${plural(data.records_sent, 'stock record')} sent to OneStock`);
    } catch (e) {
      setAnswer({ error: (e as Error).message, request: payload });
    } finally {
      setBusy(false);
    }
  };

  const ready = db.mode === 'remote' && !!site;
  const copy = (text: string) => navigator.clipboard?.writeText(text).then(() => notify('Copied'), () => undefined);

  return (
    <div>
      <div className="settings-header">
        <div>
          <h2>Stock import API</h2>
          <p className="muted">
            Serverless function (Vercel) that imports or re-segments the OneStock stock with the segmentation rules of the site, without
            the browser: it can be called by an ERP or a scheduler. Items are read with <code>v3/items</code> (criteria:{' '}
            <code>category_ids</code>, brand, season…), the current stock with <code>stock_export</code>, and the variations of each stock
            type are sent with <code>PATCH stock_import</code> (<code>incremental: true</code>).
          </p>
        </div>
      </div>

      {!ready && (
        <div className="db-status is-error">
          <div className="db-status__title">
            <WarningIcon /> The API uses the data stored in the database for the site: select the Vercel database (Settings → Database) and
            set the site ID (Settings → OneStock API).
          </div>
        </div>
      )}

      <h3 className="section-title">Call</h3>
      <div className="panel">
        <dl className="api-def">
          <dt>Method / URL</dt>
          <dd>
            <code>POST {endpoint}</code>
          </dd>
          <dt>Header x-api-key</dt>
          <dd>API key of the Vercel project (<code>API_KEY</code> variable, Settings → Database) — required when it is set.</dd>
          <dt>Header x-site-id</dt>
          <dd>
            OneStock site ID: <code>{site || '(not set)'}</code> — selects the rules, stock types, OneStock URL and token of the site.
          </dd>
          <dt>Header Content-Type</dt>
          <dd>
            <code>application/json</code>
          </dd>
          <dt>Time limit</dt>
          <dd>60 s per call (vercel.json); the catalog scan stops before and returns next_cursor.</dd>
        </dl>
      </div>

      {checks && (
        <>
          <h3 className="section-title">Prerequisites for site {site}</h3>
          <ul className="check-list">
            {checks.map((c) => (
              <li key={c.label} className={c.ok ? 'is-ok' : 'is-error'}>
                {c.ok ? <CheckIcon /> : <WarningIcon />} <strong>{c.label}</strong>
                {c.detail && <span className="muted small"> — {c.detail}</span>}
              </li>
            ))}
          </ul>
        </>
      )}

      <h3 className="section-title">Modes</h3>
      <table className="table table--compact">
        <thead>
          <tr>
            <th>Body</th>
            <th>Mode</th>
            <th>Processing</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td><code>{'{ "stocks": [...] }'}</code></td>
            <td>{MODES[0].label}</td>
            <td>{MODES[0].help}</td>
          </tr>
          <tr>
            <td><code>{'{ "item_ids": [...] }'}</code></td>
            <td>{MODES[1].label}</td>
            <td>{MODES[1].help}</td>
          </tr>
          <tr>
            <td><code>{'{ "limit": 200, "cursor": [...] }'}</code></td>
            <td>{MODES[2].label}</td>
            <td>{MODES[2].help}</td>
          </tr>
        </tbody>
      </table>

      <h3 className="section-title">Body fields</h3>
      <table className="table table--compact">
        <thead>
          <tr>
            <th>Field</th>
            <th>Type</th>
            <th>Description</th>
          </tr>
        </thead>
        <tbody>
          {FIELDS.map(([f, t, d]) => (
            <tr key={f}>
              <td className="nowrap"><code>{f}</code></td>
              <td className="nowrap muted small">{t}</td>
              <td>{d}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3 className="section-title">Answer</h3>
      <table className="table table--compact">
        <tbody>
          {ANSWER.map(([f, d]) => (
            <tr key={f}>
              <td className="nowrap"><code>{f}</code></td>
              <td>{d}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted small">
        A rule on a category also applies to its sub-categories. The OneStock calls made by the function are logged in Settings → API
        calls (target “OneStock (server)”). HTTP 400: invalid body or missing site settings · 401: wrong API key · 502: OneStock error.
      </p>

      <h3 className="section-title">Test</h3>
      <div className="form-stack">
        <div className="segmented-control" style={{ alignSelf: 'flex-start' }}>
          {MODES.map((m) => (
            <button type="button" key={m.key} className={mode === m.key ? 'is-active' : ''} onClick={() => setMode(m.key)}>
              {m.label}
            </button>
          ))}
        </div>
        <p className="muted small">{MODES.find((m) => m.key === mode)!.help}</p>
        {mode === 'import' && (
          <div className="field">
            <span className="field__label">Quantities of the records</span>
            <div className="segmented-control" style={{ alignSelf: 'flex-start' }}>
              <button type="button" className={!incremental ? 'is-active' : ''} onClick={() => setIncremental(false)}>
                Update — new stock
              </button>
              <button type="button" className={incremental ? 'is-active' : ''} onClick={() => setIncremental(true)}>
                Incremental — variation
              </button>
            </div>
            <span className="muted small">
              {incremental
                ? 'incremental: true — each quantity is added to the current OneStock stock (e.g. +10 received, −3 sold), then the total is split by the rule.'
                : 'incremental: false — each quantity replaces the stock of the main stock type, then it is split by the rule.'}
            </span>
          </div>
        )}
        <label className="field">
          <span className="field__label">
            Body (JSON) —{' '}
            <button type="button" className="link" onClick={() => setBodies((b) => ({ ...b, [mode]: undefined }))}>
              reset the example
            </button>
          </span>
          <textarea
            className="input code-input"
            rows={Math.min(22, body.split('\n').length + 1)}
            value={body}
            spellCheck={false}
            onChange={(e) => setBodies((b) => ({ ...b, [mode]: e.target.value }))}
          />
          {parsed.error && <span className="text-error small">Invalid JSON: {parsed.error}</span>}
        </label>
        <Checkbox checked={dryRun} onChange={setDryRun} label="Dry run: compute the changes without sending them to OneStock" />
        <div className="db-actions">
          <button
            type="button"
            className={`btn ${dryRun ? 'btn--secondary' : 'btn--primary'}`}
            disabled={!ready || !request || busy}
            onClick={() => (dryRun ? send() : setConfirm(true))}
          >
            {dryRun ? 'Test — dry run' : 'Send — update OneStock'}
          </button>
          {answer?.data?.mode === 'catalog' && answer.data.next_cursor && (
            <button type="button" className="btn btn--secondary" disabled={busy} onClick={() => send({ cursor: answer.data!.next_cursor })}>
              Next page (cursor)
            </button>
          )}
          {busy && <Spinner />}
        </div>

        <div className="json-block">
          <div className="json-block__header">
            <strong className="small">curl</strong>
            <span>
              {db.apiKey && (
                <button type="button" className="link small" onClick={() => setShowKey((v) => !v)}>
                  {showKey ? 'Hide the key' : 'Show the key'}
                </button>
              )}{' '}
              <button type="button" className="link small" onClick={() => copy(curl.replace('<API key>', db.apiKey))}>
                Copy
              </button>
            </span>
          </div>
          <pre>{curl}</pre>
        </div>

        {answer && <AnswerView answer={answer} />}
      </div>

      {confirm && (
        <ConfirmModal
          title="Update the OneStock stock"
          confirmLabel="Send"
          onClose={() => setConfirm(false)}
          onConfirm={() => {
            setConfirm(false);
            send();
          }}
        >
          <p>
            Dry run is off: the stock variations will be sent to OneStock (<code>PATCH stock_import</code>) for site <strong>{site}</strong>.
          </p>
        </ConfirmModal>
      )}
    </div>
  );
}

function AnswerView({ answer }: { answer: { data?: StockImportAnswer; error?: string; request?: unknown } }) {
  const [raw, setRaw] = useState(false);
  if (answer.error)
    return (
      <div className="db-status is-error">
        <div className="db-status__title">
          <WarningIcon /> {answer.error}
        </div>
      </div>
    );
  const d = answer.data!;
  const segments = (c: StockImportAnswer['changes'][number]) =>
    Object.keys(c.after).map((k) => (
      <span key={k} className={`seg-delta ${c.after[k] !== (c.before[k] ?? 0) ? 'is-changed' : ''}`}>
        <code>{k}</code> {c.before[k] ?? 0} → <strong>{c.after[k]}</strong>
      </span>
    ));
  return (
    <div className={`db-status ${d.errors.length ? 'is-warning' : 'is-ok'}`}>
      <div className="db-status__title">
        <CheckIcon /> {d.dry_run ? 'Dry run' : 'Done'} · mode {d.mode}
        {d.incremental !== undefined && ` (${d.incremental ? 'incremental' : 'update'})`} · {d.duration_ms} ms
      </div>
      <dl>
        {d.items_scanned !== undefined && (
          <>
            <dt>Items scanned</dt>
            <dd>{d.items_scanned}</dd>
          </>
        )}
        <dt>Items matched by a rule</dt>
        <dd>{d.items_matched}</dd>
        <dt>Stock lines</dt>
        <dd>
          {d.lines} · {d.changed} changed · {d.unchanged} unchanged · {d.blocked} blocked · {d.without_rule} without rule
        </dd>
        <dt>stock_import</dt>
        <dd>
          {d.dry_run ? `${plural(d.records.length, 'record')} would be sent` : `${plural(d.records_sent, 'record')} sent in ${plural(d.stock_import_calls, 'call')}`}
        </dd>
        {d.mode === 'catalog' && (
          <>
            <dt>next_cursor</dt>
            <dd>
              <code>{JSON.stringify(d.next_cursor)}</code>
            </dd>
          </>
        )}
      </dl>
      {d.errors.length > 0 && (
        <ul className="text-warning small">
          {d.errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}
      {d.changes.length > 0 && (
        <table className="table table--compact api-changes">
          <thead>
            <tr>
              <th>Item</th>
              <th>Endpoint</th>
              <th>Stock type / PO</th>
              <th>Rule</th>
              <th>Segments (before → after)</th>
            </tr>
          </thead>
          <tbody>
            {d.changes.map((c, i) => (
              <tr key={i}>
                <td className="api-path">{c.item_id}</td>
                <td className="small">{c.endpoint_id}</td>
                <td className="small">
                  <code>{c.stock_type}</code>
                  {c.purchase_order_number && <div className="muted">{c.purchase_order_number}</div>}
                </td>
                <td className="small">{c.rule ?? <span className="muted">none</span>}</td>
                <td>
                  <div className="seg-deltas">{segments(c)}</div>
                  {c.blocked && <div className="text-warning small">{c.blocked}</div>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <button type="button" className="link small" onClick={() => setRaw((v) => !v)}>
        {raw ? 'Hide' : 'Show'} the JSON request and answer
      </button>
      {raw && (
        <div className="api-detail__blocks">
          <div className="json-block">
            <strong className="small">Request</strong>
            <pre>{JSON.stringify(answer.request, null, 2)}</pre>
          </div>
          <div className="json-block">
            <strong className="small">Answer</strong>
            <pre>{JSON.stringify(d, null, 2)}</pre>
          </div>
        </div>
      )}
    </div>
  );
}
