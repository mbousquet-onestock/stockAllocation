import React, { useState } from 'react';
import { getDbConfig } from '../api/dbConfig';
import {
  callOnestock,
  DEFAULT_ONESTOCK_CONFIG,
  getOnestockConfig,
  parseCategories,
  parseEndpoints,
  parseItem,
  fetchItemsPage,
  fetchStock,
  setOnestockConfig,
  type Category,
  type OnestockConfig,
} from '../api/onestock';
import { useDataVersion } from '../components/DataVersion';
import { useStockTypes } from '../components/StockTypes';
import { CheckIcon, WarningIcon } from '../components/Icons';
import { useToast } from '../components/Toast';
import { Checkbox, ItemIdentity, Spinner } from '../components/ui';
import type { Item, StockLocation } from '../types';
import { plural } from '../utils/format';

/** Languages found in the display_info of a category tree. */
function languagesOf(data: unknown): string[] {
  const found = new Set<string>();
  const walk = (node: unknown) => {
    if (!node || typeof node !== 'object') return;
    const o = node as { display_info?: Record<string, unknown>; sub_category?: unknown[]; category?: unknown };
    Object.keys(o.display_info ?? {}).forEach((l) => found.add(l));
    (o.sub_category ?? []).forEach(walk);
    if (o.category) walk(o.category);
  };
  walk(data);
  return [...found].sort();
}

const COMMON_LANGUAGES = ['fr', 'en', 'it', 'es', 'de', 'nl', 'pt'];

/** Settings → OneStock API: {{url}}, {{site_id}}, {{token}} and default language. */
export function OnestockSettings() {
  const notify = useToast();
  const { bump } = useDataVersion();
  const saved = getOnestockConfig();
  const [config, setConfig] = useState<OnestockConfig>(saved);
  const [showToken, setShowToken] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ categories: Category[]; languages: string[] } | { error: string }>();
  const [items, setItems] = useState<{ ids: string[]; first?: Item; more: boolean } | { error: string }>();
  const [stock, setStock] = useState<{ records: number; items: number; types: string[]; unknown: string[] } | { error: string }>();
  const [stockIds, setStockIds] = useState('');
  const tree = useStockTypes();
  const [endpoints, setEndpoints] = useState<{ locations: StockLocation[] } | { error: string }>();
  const dirty = JSON.stringify(config) !== JSON.stringify(saved);
  const complete = !!(config.url.trim() && config.siteId.trim() && config.token.trim());

  const set = (patch: Partial<OnestockConfig>) => {
    setConfig((c) => ({ ...c, ...patch }));
    setResult(undefined);
    setEndpoints(undefined);
    setItems(undefined);
    setStock(undefined);
  };

  const test = async () => {
    setBusy(true);
    try {
      const data = await callOnestock('/categories', config);
      setResult({ categories: parseCategories(data, config.language), languages: languagesOf(data) });
    } catch (e) {
      setResult({ error: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const testEndpoints = async () => {
    setBusy(true);
    try {
      setEndpoints({ locations: parseEndpoints(await callOnestock('/endpoints', config)) });
    } catch (e) {
      setEndpoints({ error: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const testItems = async () => {
    setBusy(true);
    try {
      const page = await fetchItemsPage({ limit: 25, start: 0 }, config);
      const ids = (page.items ?? []).map((i) => String(i.id));
      let first: Item | undefined;
      if (ids[0]) {
        const detail = await callOnestock<{ items?: unknown[] }>('/v3/items', config, { item_ids: [ids[0]], pagination: { limit: 1, start: 0 } });
        const node = detail.items?.[0] as Parameters<typeof parseItem>[0] | undefined;
        if (node) first = parseItem(node, config.language);
      }
      setItems({ ids, first, more: !!page.pagination?.search_after || ids.length === 25 });
    } catch (e) {
      setItems({ error: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const testStock = async () => {
    setBusy(true);
    try {
      let ids = stockIds.split(/[\s,;]+/).filter(Boolean);
      if (!ids.length) ids = ((await fetchItemsPage({ limit: 10, start: 0 }, config)).items ?? []).map((i) => String(i.id));
      const records = await fetchStock(ids, config, true);
      const types = [...new Set(records.map((r) => r.type))].sort();
      setStock({
        records: records.length,
        items: new Set(records.map((r) => r.item_id)).size,
        types,
        unknown: types.filter((t) => !tree.byCode(t)),
      });
    } catch (e) {
      setStock({ error: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const save = () => {
    setOnestockConfig(config);
    bump();
    notify('OneStock API settings saved');
  };

  const proxy = getDbConfig();

  return (
    <div>
      <div className="settings-header">
        <div>
          <h2>OneStock API</h2>
          <p className="muted">
            Access to the OneStock API, used to list the <strong>categories</strong> (<code>{'{{url}}'}/categories</code>) the{' '}
            <strong>items</strong> (<code>{'{{url}}'}/v3/items</code>) and the <strong>stock</strong> (<code>{'{{url}}'}/stock_export</code>) and the <strong>stock locations</strong> (<code>{'{{url}}'}/endpoints</code>) of the segmentation rules, with <code>site_id</code> and{' '}
            <code>token</code>. The browser cannot call the API
            directly: the calls go through the proxy of the application (<code>{proxy.apiUrl || '/api'}/onestock</code>).
          </p>
        </div>
        <button type="button" className="btn btn--primary" disabled={!dirty} onClick={save}>
          Save
        </button>
      </div>

      <div className="form-stack db-form">
        <label className="field">
          <span className="field__label">URL — {'{{url}}'}</span>
          <input className="input" value={config.url} onChange={(e) => set({ url: e.target.value })} placeholder="https://api.example.com" />
        </label>
        <label className="field">
          <span className="field__label">Site ID — {'{{site_id}}'}</span>
          <input className="input" value={config.siteId} onChange={(e) => set({ siteId: e.target.value })} placeholder="e.g. c1234" />
        </label>
        <label className="field">
          <span className="field__label">Token — {'{{token}}'}</span>
          <span className="input-group">
            <input
              type={showToken ? 'text' : 'password'}
              value={config.token}
              onChange={(e) => set({ token: e.target.value })}
              autoComplete="off"
            />
            <button type="button" className="input-group__addon input-group__btn" onClick={() => setShowToken((v) => !v)}>
              {showToken ? 'Hide' : 'Show'}
            </button>
          </span>
        </label>
        <div className="form-row">
          <label className="field">
            <span className="field__label">Default language of the labels</span>
            <input
              className="input"
              list="onestock-languages"
              value={config.language}
              onChange={(e) => set({ language: e.target.value.trim().toLowerCase() })}
              placeholder={DEFAULT_ONESTOCK_CONFIG.language}
            />
            <datalist id="onestock-languages">
              {[...new Set([...(result && 'languages' in result ? result.languages : []), ...COMMON_LANGUAGES])].map((l) => (
                <option key={l} value={l} />
              ))}
            </datalist>
            <span className="muted small">When a category has no name in this language, the first available one is used.</span>
          </label>
          <label className="field">
            <span className="field__label">HTTP method</span>
            <select className="select" value={config.method} onChange={(e) => set({ method: e.target.value as OnestockConfig['method'] })}>
              <option value="GET">GET</option>
              <option value="POST">POST</option>
            </select>
          </label>
        </div>
        <Checkbox
          checked={config.useForCategories}
          onChange={(useForCategories) => set({ useForCategories })}
          label="Use the OneStock categories in the segmentation rule criteria"
        />
        <Checkbox
          checked={config.useForLocations}
          onChange={(useForLocations) => set({ useForLocations })}
          label="Use the OneStock endpoints as stock locations of the segmentation rules"
        />
        <Checkbox
          checked={config.useForItems}
          onChange={(useForItems) => set({ useForItems })}
          label="Use the OneStock items (item search, allocation pages, SKU criteria)"
        />
        <Checkbox
          checked={config.useForStock}
          onChange={(useForStock) => set({ useForStock })}
          label="Read the item stock from OneStock (stock_export) in the allocation pages"
        />
        <div className="form-row">
          <label className="field">
            <span className="field__label">Stock request — {'{{stock_request}}'} (request_name of stock_export)</span>
            <input className="input" value={config.stockRequest} onChange={(e) => set({ stockRequest: e.target.value })} placeholder="e.g. stock_segments" />
          </label>
          <label className="field">
            <span className="field__label">Item ids to test (optional)</span>
            <input className="input" value={stockIds} onChange={(e) => setStockIds(e.target.value)} placeholder="first items" />
          </label>
        </div>

        <div className="db-actions">
          <button type="button" className="btn btn--secondary" disabled={busy || !complete} onClick={test}>
            Test — load the categories
          </button>
          <button type="button" className="btn btn--secondary" disabled={busy || !complete} onClick={testEndpoints}>
            Test — load the stock locations
          </button>
          <button type="button" className="btn btn--secondary" disabled={busy || !complete} onClick={testItems}>
            Test — load the items
          </button>
          <button type="button" className="btn btn--secondary" disabled={busy || !complete} onClick={testStock}>
            Test — load the stock
          </button>
          {busy && <Spinner />}
        </div>

        {result && (
          <div className={`db-status ${'error' in result ? 'is-error' : 'is-ok'}`}>
            {'error' in result ? (
              <div className="db-status__title">
                <WarningIcon /> {result.error}
              </div>
            ) : (
              <>
                <div className="db-status__title">
                  <CheckIcon /> {plural(result.categories.length, 'category')} loaded
                  {result.languages.length > 0 && <span className="muted small">· languages: {result.languages.join(', ')}</span>}
                </div>
                <ul className="category-preview">
                  {result.categories.slice(0, 20).map((c) => (
                    <li key={c.id}>
                      {c.label} <code>{c.id}</code>
                    </li>
                  ))}
                  {result.categories.length > 20 && <li className="muted">… and {result.categories.length - 20} more</li>}
                </ul>
              </>
            )}
          </div>
        )}
        {stock && (
          <div className={`db-status ${'error' in stock ? 'is-error' : 'is-ok'}`}>
            {'error' in stock ? (
              <div className="db-status__title">
                <WarningIcon /> {stock.error}
              </div>
            ) : (
              <>
                <div className="db-status__title">
                  <CheckIcon /> {plural(stock.records, 'stock record')} for {plural(stock.items, 'item')}
                </div>
                <div className="small">
                  Stock types: {stock.types.map((t) => <code key={t}>{t}</code>).reduce<React.ReactNode[]>((a, c) => (a.length ? [...a, ' ', c] : [c]), [])}
                </div>
                {stock.unknown.length > 0 && (
                  <div className="text-warning small">
                    Not configured in Settings → Stock types (ignored): {stock.unknown.join(', ')}
                  </div>
                )}
              </>
            )}
          </div>
        )}
        {items && (
          <div className={`db-status ${'error' in items ? 'is-error' : 'is-ok'}`}>
            {'error' in items ? (
              <div className="db-status__title">
                <WarningIcon /> {items.error}
              </div>
            ) : (
              <>
                <div className="db-status__title">
                  <CheckIcon /> {plural(items.ids.length, 'item')} on the first page{items.more ? ' (more pages available)' : ''}
                </div>
                {items.first && (
                  <div className="item-test">
                    <ItemIdentity item={items.first} detailed />
                    <span className="muted small">{Object.keys(items.first.features ?? {}).length} features read in "{config.language}"</span>
                  </div>
                )}
              </>
            )}
          </div>
        )}
        {endpoints && (
          <div className={`db-status ${'error' in endpoints ? 'is-error' : 'is-ok'}`}>
            {'error' in endpoints ? (
              <div className="db-status__title">
                <WarningIcon /> {endpoints.error}
              </div>
            ) : (
              <>
                <div className="db-status__title">
                  <CheckIcon /> {plural(endpoints.locations.length, 'stock location')} loaded
                </div>
                <ul className="category-preview">
                  {endpoints.locations.slice(0, 20).map((l) => (
                    <li key={l.id}>
                      {l.name} <code>{l.id}</code>
                      {l.city && <span className="muted"> · {[l.city, l.country].filter(Boolean).join(', ')}</span>}
                    </li>
                  ))}
                  {endpoints.locations.length > 20 && <li className="muted">… and {endpoints.locations.length - 20} more</li>}
                </ul>
              </>
            )}
          </div>
        )}
        {dirty && <span className="text-warning small">Unsaved changes: click Save to apply them.</span>}
      </div>

      <div className="panel db-help">
        <strong>Notes</strong>
        <ul>
          <li>
            The rules store the category and endpoint <strong>ids</strong> (e.g. <code>renault_clio_vi</code>,{' '}
            <code>michelin_clermont-warehouse</code>); the names are only displayed.
          </li>
          <li>
            The proxy uses the API URL and API key of <em>Settings → Database</em>. It only relays the allowed OneStock paths.
          </li>
          <li>The token is kept in this browser; each user enters it once.</li>
        </ul>
      </div>
    </div>
  );
}
