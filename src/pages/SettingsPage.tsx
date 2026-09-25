import { useState } from 'react';
import { api } from '../api';
import { DatabaseSettings } from './DatabaseSettings';
import { OnestockSettings } from './OnestockSettings';
import { ApiCallsSettings } from './ApiCallsSettings';
import { ConfirmModal } from '../components/ConfirmModal';
import { useDataVersion } from '../components/DataVersion';
import { ArrowDownIcon, ArrowUpIcon, EditIcon, TrashIcon, TruckIcon, WarehouseIcon } from '../components/Icons';
import { useStockTypes } from '../components/StockTypes';
import { useToast } from '../components/Toast';
import { Checkbox, Modal } from '../components/ui';
import type { StockType, StockTypeInput } from '../types';

type Editing = { type?: StockType; parent?: StockType } | null;

function StockTypeModal({ editing, onClose, onSaved }: { editing: NonNullable<Editing>; onClose: () => void; onSaved: () => void }) {
  const notify = useToast();
  const { type, parent } = editing;
  const isGroup = type ? type.parentId !== null : !!parent;
  const [code, setCode] = useState(type?.code ?? (parent ? `${parent.code}_` : ''));
  const [label, setLabel] = useState(type?.label ?? (parent ? `${parent.label} ` : ''));
  const [future, setFuture] = useState(type?.future ?? parent?.future ?? false);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    const input: StockTypeInput = { code, label, future, parentId: type ? type.parentId : parent?.id ?? null };
    setSaving(true);
    try {
      if (type) await api.updateStockType(type.id, input);
      else await api.createStockType(input);
      notify(`${isGroup ? 'Group' : 'Stock type'} "${label.trim()}" saved`);
      onSaved();
    } catch (e) {
      notify((e as Error).message, 'error');
      setSaving(false);
    }
  };

  const title = type ? `Edit ${isGroup ? 'group' : 'stock type'}` : isGroup ? `New group of ${parent!.label}` : 'New stock type';
  return (
    <Modal
      title={title}
      onClose={onClose}
      width={480}
      footer={
        <>
          <button type="button" className="btn btn--secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn--primary" disabled={!code.trim() || !label.trim() || saving} onClick={save}>
            Save
          </button>
        </>
      }
    >
      <div className="form-stack">
        <label className="field">
          <span className="field__label">Code (used in stock files and APIs)</span>
          <input className="input" value={code} onChange={(e) => setCode(e.target.value)} autoFocus placeholder="e.g. on_hand" />
        </label>
        <label className="field">
          <span className="field__label">Label</span>
          <input className="input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. On hand" />
        </label>
        {isGroup ? (
          <p className="muted small">
            A group is a segment of <strong>{parent?.label ?? ''}</strong>: segmentation rules split the stock of the main type onto
            its groups. {future ? 'It is future stock, like its main type.' : ''}
          </p>
        ) : (
          <div>
            <Checkbox checked={future} onChange={setFuture} label="Future stock (container, planned…)" />
            <p className="muted small">
              Future stock can be updated with a purchase order, and segmentation rules can be restricted to purchase orders.
            </p>
          </div>
        )}
      </div>
    </Modal>
  );
}

function StockTypesSettings() {
  const tree = useStockTypes();
  const { bump } = useDataVersion();
  const notify = useToast();
  const [editing, setEditing] = useState<Editing>(null);
  const [deleting, setDeleting] = useState<StockType | null>(null);

  const run = async (action: () => Promise<unknown>, message?: string) => {
    try {
      await action();
      if (message) notify(message);
      bump();
    } catch (e) {
      notify((e as Error).message, 'error');
    }
  };

  const actions = (t: StockType, index: number, count: number) => (
    <span className="row-actions">
      <button type="button" className="icon-btn" disabled={index === 0} onClick={() => run(() => api.moveStockType(t.id, -1))} aria-label="Move up">
        <ArrowUpIcon />
      </button>
      <button type="button" className="icon-btn" disabled={index === count - 1} onClick={() => run(() => api.moveStockType(t.id, 1))} aria-label="Move down">
        <ArrowDownIcon />
      </button>
      <button type="button" className="icon-btn" onClick={() => setEditing({ type: t, parent: t.parentId ? tree.byId(t.parentId) : undefined })} aria-label="Edit">
        <EditIcon />
      </button>
      <button type="button" className="icon-btn" onClick={() => setDeleting(t)} aria-label="Delete">
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
            segmentation rules then split the stock of the main type onto its groups, the rest stays on the main type.
          </p>
        </div>
        <button type="button" className="btn btn--primary" onClick={() => setEditing({})}>
          Add a stock type
        </button>
      </div>

      <div className="stock-types">
        {tree.mainTypes.map((main, i, mains) => {
          const groups = tree.groupsOf(main.id);
          return (
            <div className="card stock-type" key={main.id}>
              <div className="stock-type__header">
                <span className={`stock-type__icon ${main.future ? 'is-future' : ''}`}>
                  {main.future ? <TruckIcon width={20} height={20} /> : <WarehouseIcon width={20} height={20} />}
                </span>
                <div className="grow">
                  <div className="stock-type__title">
                    {main.label} <code>{main.code}</code>
                    <span className={`badge ${main.future ? 'badge--future' : 'badge--success'}`}>{main.future ? 'Future stock · purchase orders' : 'Physical stock'}</span>
                  </div>
                  <div className="muted small">Segments: {tree.family(main.id).map((t) => t.code).join(', ')}</div>
                </div>
                {actions(main, i, mains.length)}
              </div>
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
                        <span className="tree-branch">└</span> <code>{g.code}</code>
                      </td>
                      <td>{g.label}</td>
                      <td className="col-actions">{actions(g, j, groups.length)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {groups.length === 0 && <div className="muted small empty">No group: the stock of this type cannot be split.</div>}
              <button type="button" className="link add-group" onClick={() => setEditing({ parent: main })}>
                + Add a group
              </button>
            </div>
          );
        })}
      </div>

      {editing && (
        <StockTypeModal
          editing={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            bump();
          }}
        />
      )}
      {deleting && (
        <ConfirmModal
          title="Delete stock type"
          confirmLabel="Delete"
          danger
          onClose={() => setDeleting(null)}
          onConfirm={() => {
            const t = deleting;
            setDeleting(null);
            run(() => api.deleteStockType(t.id), `"${t.label}" deleted`);
          }}
        >
          <p>
            Delete <strong>{deleting.label}</strong>
            {deleting.parentId === null && tree.groupsOf(deleting.id).length > 0 ? ' and its groups' : ''}? This is only possible when it
            holds no stock and no rule uses it.
          </p>
        </ConfirmModal>
      )}
    </div>
  );
}

const MENUS = [
  { key: 'stock-types', label: 'Stock types' },
  { key: 'database', label: 'Database' },
  { key: 'onestock', label: 'OneStock API' },
  { key: 'api-calls', label: 'API calls' },
];

export function SettingsPage() {
  const [menu, setMenu] = useState(MENUS[0].key);
  return (
    <div className="settings">
      <aside className="card settings-menu">
        <div className="settings-menu__title">Configuration</div>
        {MENUS.map((m) => (
          <button type="button" key={m.key} className={menu === m.key ? 'is-active' : ''} onClick={() => setMenu(m.key)}>
            {m.label}
          </button>
        ))}
      </aside>
      <section className="card page grow">
        {menu === 'stock-types' && <StockTypesSettings />}
        {menu === 'database' && <DatabaseSettings />}
        {menu === 'onestock' && <OnestockSettings />}
        {menu === 'api-calls' && <ApiCallsSettings />}
      </section>
    </div>
  );
}
