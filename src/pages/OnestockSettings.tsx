import React, { useEffect, useState } from 'react';
import { getDbConfig } from '../api/dbConfig';
import { extensionContext } from '../api/extension';
import { remoteRules } from '../api/remoteRules';
import {
  callOnestock,
  DEFAULT_ONESTOCK_CONFIG,
  getOnestockConfig,
  isOnestockConfigured,
  parseCategories,
  parseEndpoints,
  parseItem,
  fetchItemsPage,
  loadSharedOnestockSettings,
  publishOnestockSettings,
  testOnestockLogin,
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

/** Settings → OneStock API: environment ({{url}}), {{site_id}}, login (user / password → token via /login) and options. */
export function OnestockSettings() {
  const notify = useToast();
  const { bump } = useDataVersion();
  const [saved, setSaved] = useState(getOnestockConfig());
  const [shared, setShared] = useState<{ loaded: boolean; updatedAt?: string | null; error?: string }>();
  const sharing = getDbConfig().mode === 'remote';
  const [config, setConfig] = useState<OnestockConfig>(saved);
  const fromCall = extensionContext();
  // Login of the context (site × environment): saved in the database, the password is never read back.
  const [login, setLogin] = useState({ user: saved.loginUser, password: '' });
  const [showPassword, setShowPassword] = useState(false);
  const [loginTest, setLoginTest] = useState<{ ok: boolean; message: string }>();
  // Sites known by the shared database, proposed for the site ID.
  const [sites, setSites] = useState<string[]>([]);
  useEffect(() => {
    if (getDbConfig().mode === 'remote') remoteRules.health().then((h) => setSites(h.sites ?? []), () => undefined);
  }, []);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ categories: Category[]; languages: string[] } | { error: string }>();
  const [items, setItems] = useState<{ ids: string[]; first?: Item; more: boolean } | { error: string }>();
  const [stock, setStock] = useState<{ records: number; items: number; types: string[]; unknown: string[] } | { error: string }>();
  const [stockIds, setStockIds] = useState('');
  const tree = useStockTypes();
  const [endpoints, setEndpoints] = useState<{ locations: StockLocation[] } | { error: string }>();
  const loginDirty = login.user.trim() !== saved.loginUser || login.password !== '';
  const dirty = JSON.stringify(config) !== JSON.stringify(saved) || loginDirty;
  const complete = isOnestockConfigured(config);

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
        const detail = await callOnestock<{ items?: unknown[] }>('/v3/items', config, { item_ids: [ids[0]] });
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
      const types = [...new Set(records.map((r) => r.type?.trim() || 'on_hand (no type)'))].sort();
      setStock({
        records: records.length,
        items: new Set(records.map((r) => r.item_id)).size,
        types,
        unknown: types.filter((t) => !tree.byCode(t.replace(' (no type)', ''))),
      });
    } catch (e) {
      setStock({ error: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  // Options shared by the site in the database: loaded when the page opens.
  useEffect(() => {
    if (!sharing) return;
    loadSharedOnestockSettings()
      .then((r) => {
        setShared(r);
        if (r.loaded) {
          setSaved(getOnestockConfig());
          setConfig(getOnestockConfig());
        }
      })
      .catch((e: Error) => setShared({ loaded: false, error: e.message }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const refresh = () => {
    const c = getOnestockConfig();
    setConfig(c);
    setSaved(c);
    setLogin({ user: c.loginUser, password: '' });
  };

  const save = async () => {
    const siteChanged = config.siteId.trim() !== saved.siteId.trim();
    setOnestockConfig(config);
    try {
      let loadedFromSite = false;
      if (siteChanged) {
        // Another site: take its shared options if it has some, else publish these ones.
        const r = await loadSharedOnestockSettings();
        loadedFromSite = r.loaded;
        if (r.loaded) setShared(r);
      }
      if (!loadedFromSite || loginDirty) {
        const published = await publishOnestockSettings(getOnestockConfig(), loginDirty ? login : undefined);
        if (published) setShared({ loaded: true, updatedAt: new Date().toISOString() });
      }
      notify(
        loadedFromSite && !loginDirty
          ? `Settings of site ${config.siteId.trim()} loaded from the database`
          : `OneStock settings saved for site ${config.siteId.trim()}${loginDirty ? ` (login of ${login.user.trim()})` : ''}`,
      );
    } catch (e) {
      notify(`Not saved in the database: ${(e as Error).message}`, 'error');
    }
    refresh();
    setLoginTest(undefined);
    bump();
  };

  const testLogin = async () => {
    setBusy(true);
    setLoginTest(undefined);
    try {
      const user = await testOnestockLogin(config, login.password ? login : undefined);
      setLoginTest({ ok: true, message: `Login accepted by OneStock for ${user || login.user} (site ${config.siteId.trim()})` });
    } catch (e) {
      setLoginTest({ ok: false, message: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const proxy = getDbConfig();

  return (
    <div>
      <div className="settings-header">
        <div>
          <h2>OneStock API</h2>
          <p className="muted">
            Access to the OneStock API, used to list the <strong>categories</strong> (<code>{'{{url}}'}/categories</code>) the{' '}
            <strong>items</strong> (<code>{'{{url}}'}/v3/items</code>) and the <strong>stock</strong> (read: <code>{'{{url}}'}/stock_export</code>, write: <code>PATCH {'{{url}}'}/stock_import</code>) and the <strong>stock locations</strong> (<code>{'{{url}}'}/endpoints</code>) of the segmentation rules, with <code>site_id</code> and a token obtained with the
            user / password of the site (<code>POST {'{{url}}'}/login</code>). The browser cannot call the API directly: the calls go
            through the proxy of the application (<code>{proxy.apiUrl || '/api'}/onestock</code>), which logs in.
          </p>
          <p className={`small ${shared?.error ? 'text-error' : 'muted'}`}>
            {sharing ? (
              shared?.error ? (
                <>Shared settings unavailable: {shared.error}</>
              ) : (
                <>
                  <strong>Shared by site:</strong> the options below are stored in the database for the site{' '}
                  <code>{saved.siteId || '(no site id)'}</code>
                  {shared?.updatedAt ? ` (updated ${new Date(shared.updatedAt).toLocaleString('fr-FR')})` : ''}, so that every computer
                  uses the same ones. The <strong>user / password</strong> are saved in the database for the site and the environment (URL); the
                  password is never sent back to the browsers.
                </>
              )
            ) : (
              <span className="text-error">
                The OneStock connection needs the Vercel database (Settings → Database): the user / password are saved there per site.
              </span>
            )}
          </p>
        </div>
        <button type="button" className="btn btn--primary" disabled={!dirty} onClick={save}>
          Save
        </button>
      </div>

      <div className="form-stack db-form">
        {fromCall ? (
          <div className="form-row form-row--even">
            <label className="field">
              <span className="field__label">URL — {'{{url}}'}</span>
              <input className="input" value={config.url} readOnly disabled />
            </label>
            <label className="field">
              <span className="field__label">Site ID — {'{{site_id}}'}</span>
              <input className="input" value={config.siteId} readOnly disabled />
            </label>
            <span className="muted small">Provided by OneStock with the call of the extension (user {fromCall.user_id}).</span>
          </div>
        ) : (
          <>
          <label className="field">
            <span className="field__label">URL — {'{{url}}'}</span>
            <input className="input" value={config.url} onChange={(e) => set({ url: e.target.value })} placeholder="https://api.example.com" />
          </label>
          <label className="field">
            <span className="field__label">Site ID — {'{{site_id}}'}</span>
            <input className="input" list="known-sites" value={config.siteId} onChange={(e) => set({ siteId: e.target.value })} placeholder="e.g. c1234" />
            <datalist id="known-sites">
              {sites.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
            {sites.length > 0 && <span className="muted small">Sites of the database: {sites.join(', ')}</span>}
          </label>
          </>
        )}
        <div className="form-row form-row--even">
          <label className="field">
            <span className="field__label">User</span>
            <input
              className="input"
              value={login.user}
              onChange={(e) => (setLogin((l) => ({ ...l, user: e.target.value })), setLoginTest(undefined))}
              autoComplete="username"
              placeholder="OneStock user of the site"
            />
          </label>
          <label className="field">
            <span className="field__label">Password</span>
            <span className="input-group">
              <input
                type={showPassword ? 'text' : 'password'}
                value={login.password}
                onChange={(e) => (setLogin((l) => ({ ...l, password: e.target.value })), setLoginTest(undefined))}
                autoComplete="new-password"
                placeholder={saved.loginSaved && login.user.trim() === saved.loginUser ? 'Saved in the database — type to replace it' : ''}
              />
              <button type="button" className="input-group__addon input-group__btn" onClick={() => setShowPassword((v) => !v)}>
                {showPassword ? 'Hide' : 'Show'}
              </button>
            </span>
          </label>
        </div>
        <div className="db-actions">
          <button
            type="button"
            className="btn btn--secondary"
            disabled={busy || !sharing || !config.url.trim() || !config.siteId.trim() || !(login.password || saved.loginSaved)}
            onClick={testLogin}
          >
            Test login
          </button>
          <span className={`small ${loginTest ? (loginTest.ok ? 'text-success' : 'text-error') : 'muted'}`}>
            {loginTest?.message ??
              (saved.loginSaved
                ? `Login saved for site ${saved.siteId} on ${saved.url}${saved.loginUser ? ` (${saved.loginUser})` : ''}`
                : 'No login saved for this site and environment yet')}
          </span>
        </div>
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
          <span className="field__label">Stock request — {'{{stock_request}}'} (request_name of stock_export)</span>
          <input className="input" value={config.stockRequest} onChange={(e) => set({ stockRequest: e.target.value })} placeholder="e.g. stock_segments" />
        </label>
        <label className="field">
          <span className="field__label">HTTP method of the read calls</span>
          <select className="select" value={config.method} onChange={(e) => set({ method: e.target.value as OnestockConfig['method'] })}>
            <option value="GET">GET</option>
            <option value="POST">POST</option>
          </select>
          <span className="muted small">
            Method used for categories, endpoints, v3/items and stock_export, which send <code>site_id</code> / <code>token</code> in a JSON
            body. GET (OneStock default) unless your API only accepts POST. The stock updates always use <code>PATCH stock_import</code>.
          </span>
        </label>
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
        <label className="field">
          <span className="field__label">Item ids to test the stock (optional)</span>
          <input className="input" value={stockIds} onChange={(e) => setStockIds(e.target.value)} placeholder="first items" />
        </label>

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
          <li>
            Authentication: the proxy logs in with the user / password saved for the site and the environment (POST{' '}
            <code>/login</code>), keeps the token on the server and logs in again when OneStock refuses it. No token is typed or stored
            in the browser.
          </li>
        </ul>
      </div>
    </div>
  );
}
