import { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { getDbConfig } from '../api/dbConfig';
import { currentSiteId } from '../api/site';
import { useDataVersion } from '../components/DataVersion';
import { ArrowDownIcon, ArrowUpIcon, TrashIcon, TruckIcon, WarehouseIcon } from '../components/Icons';
import { useStockTypes } from '../components/StockTypes';
import { useToast } from '../components/Toast';
import { Checkbox, Spinner } from '../components/ui';
import type { StockType } from '../types';

const CODE = /^[A-Za-z0-9_-]+$/;
let seq = 0;
const newId = () => `st-${Date.now()}-${++seq}`;
const byPosition = (a: StockType, b: StockType) => a.position - b.position;

/**
 * Settings → Stock types: the whole configuration (main types and their groups) is edited here and saved at once,
 * for the site (OneStock site ID) when the Vercel database is used.
 */
export function StockTypesSettings() {
  const tree = useStockTypes();
  const { bump } = useDataVersion();
  const notify = useToast();
  const [draft, setDraft] = useState<StockType[]>(tree.all);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const saved = useMemo(() => JSON.stringify(tree.all), [tree.all]);
  const dirty = JSON.stringify(draft) !== saved;
  const site = currentSiteId();
  const shared = getDbConfig().mode === 'remote' && !!site;

  // New configuration loaded (other screen, other computer): taken when nothing is being edited.
  useEffect(() => {
    if (!dirty) setDraft(tree.all);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saved]);

  const mains = draft.filter((t) => t.parentId === null).sort(byPosition);
  const groupsOf = (id: string) => draft.filter((t) => t.parentId === id).sort(byPosition);

  const change = (id: string, patch: Partial<StockType>) => {
    setError(undefined);
    setDraft((list) =>
      list.map((t) => {
        if (t.id === id) return { ...t, ...patch };
        // The future flag of a main type applies to its groups.
        if (patch.future !== undefined && t.parentId === id) return { ...t, future: patch.future };
        return t;
      }),
    );
  };
  const remove = (id: string) => setDraft((list) => list.filter((t) => t.id !== id && t.parentId !== id));
  const move = (t: StockType, direction: -1 | 1) => {
    const siblings = draft.filter((s) => s.parentId === t.parentId).sort(byPosition);
    const other = siblings[siblings.findIndex((s) => s.id === t.id) + direction];
    if (!other) return;
    setDraft((list) => list.map((s) => (s.id === t.id ? { ...s, position: other.position } : s.id === other.id ? { ...s, position: t.position } : s)));
  };
  const nextPosition = (parentId: string | null) => Math.max(0, ...draft.filter((t) => t.parentId === parentId).map((t) => t.position)) + 1;
  const addMain = () =>
    setDraft((list) => [...list, { id: newId(), code: '', label: '', parentId: null, future: false, position: nextPosition(null) }]);
  const addGroup = (main: StockType) =>
    setDraft((list) => [
      ...list,
      { id: newId(), code: `${main.code}_`, label: `${main.label} `, parentId: main.id, future: main.future, position: nextPosition(main.id) },
    ]);

  // Field checks shown while editing (the save checks them again, with the rules).
  const problems = useMemo(() => {
    const count = new Map<string, number>();
    draft.forEach((t) => count.set(t.code.trim().toLowerCase(), (count.get(t.code.trim().toLowerCase()) ?? 0) + 1));
    return new Map(
      draft.map((t) => {
        const code = t.code.trim();
        const p = !code
          ? 'Code required'
          : !CODE.test(code)
            ? 'Letters, digits, "_" and "-" only'
            : (count.get(code.toLowerCase()) ?? 0) > 1
              ? 'Code used twice'
              : !t.label.trim()
                ? 'Label required'
                : '';
        return [t.id, p];
      }),
    );
  }, [draft]);
  const invalid = [...problems.values()].some(Boolean) || !mains.length;

  const save = async () => {
    setSaving(true);
    setError(undefined);
    try {
      const result = await api.saveStockTypes(draft);
      setDraft(result);
      notify(shared ? `Stock types saved for site ${site}` : 'Stock types saved in this browser');
      bump();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const field = (t: StockType, key: 'code' | 'label', placeholder: string) => (
    <input
      className={`input input--sm ${key === 'code' ? 'code-field' : ''} ${key === 'code' && problems.get(t.id) && problems.get(t.id) !== 'Label required' ? 'is-invalid' : ''} ${key === 'label' && problems.get(t.id) === 'Label required' ? 'is-invalid' : ''}`}
      value={t[key]}
      placeholder={placeholder}
      onChange={(e) => change(t.id, { [key]: e.target.value })}
      aria-label={key}
    />
  );
  const actions = (t: StockType, index: number, count: number) => (
    <span className="row-actions">
      <button type="button" className="icon-btn" disabled={index === 0} onClick={() => move(t, -1)} aria-label="Move up">
        <ArrowUpIcon />
      </button>
      <button type="button" className="icon-btn" disabled={index === count - 1} onClick={() => move(t, 1)} aria-label="Move down">
        <ArrowDownIcon />
      </button>
      <button type="button" className="icon-btn" onClick={() => remove(t.id)} aria-label={`Remove ${t.code}`}>
        <TrashIcon />
      </button>
    </span>
  );

  return (
    <div>
      <div className="settings-header">
        <div>
          <h2>Stock types</h2>
          <p className="muted">
            Stock is always updated on a stock type. Each stock type is a segment and can be divided into groups (also segments): the
            segmentation rules split the stock of the main type onto its groups, the rest stays on the main type. Codes are the ones used
            in OneStock (case is ignored).
          </p>
          <p className="muted small">
            {shared ? (
              <>
                <strong>Shared by site:</strong> saved in the database for the site <code>{site}</code> — every computer of the site uses
                the same stock types.
              </>
            ) : (
              <>Saved in this browser only (use the Vercel database and a site ID to share them).</>
            )}
          </p>
        </div>
        <div className="row-actions">
          {dirty && (
            <button type="button" className="btn btn--secondary" disabled={saving} onClick={() => (setDraft(tree.all), setError(undefined))}>
              Cancel
            </button>
          )}
          <button type="button" className="btn btn--primary" disabled={!dirty || invalid || saving} onClick={save}>
            {shared ? `Save for site ${site}` : 'Save'}
          </button>
        </div>
      </div>

      {error && <div className="db-status is-error stock-types-error">{error}</div>}

      <div className="stock-types">
        {mains.map((main, i) => {
          const groups = groupsOf(main.id);
          return (
            <div className="card stock-type" key={main.id}>
              <div className="stock-type__header">
                <span className={`stock-type__icon ${main.future ? 'is-future' : ''}`}>
                  {main.future ? <TruckIcon width={20} height={20} /> : <WarehouseIcon width={20} height={20} />}
                </span>
                <div className="stock-type__fields grow">
                  {field(main, 'code', 'Code, e.g. on_hand')}
                  {field(main, 'label', 'Label, e.g. On hand')}
                  <Checkbox checked={main.future} onChange={(future) => change(main.id, { future })} label="Future stock (purchase orders)" />
                </div>
                {actions(main, i, mains.length)}
              </div>
              {problems.get(main.id) && <div className="text-error small">{problems.get(main.id)}</div>}
              <table className="table table--compact">
                <thead>
                  <tr>
                    <th>Group code</th>
                    <th>Label</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {groups.map((g, j) => (
                    <tr key={g.id}>
                      <td>
                        <span className="tree-branch">└</span> {field(g, 'code', 'e.g. on_hand_A')}
                        {problems.get(g.id) && <div className="text-error small">{problems.get(g.id)}</div>}
                      </td>
                      <td>{field(g, 'label', 'e.g. On hand A')}</td>
                      <td className="col-actions">{actions(g, j, groups.length)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {groups.length === 0 && <div className="muted small empty">No group: the stock of this type cannot be split.</div>}
              <button type="button" className="link add-group" onClick={() => addGroup(main)}>
                + Add a group
              </button>
            </div>
          );
        })}
      </div>
      <div className="db-actions" style={{ marginTop: 12 }}>
        <button type="button" className="btn btn--secondary" onClick={addMain}>
          + Add a stock type
        </button>
        {saving && <Spinner />}
        {dirty && <span className="text-warning small">Unsaved changes: click {shared ? `“Save for site ${site}”` : '“Save”'} to apply them.</span>}
      </div>
    </div>
  );
}
