import { useState } from 'react';
import { api } from '../api';
import { ItemIdentity, Modal } from '../components/ui';
import { TrashIcon, WarehouseIcon, WarningIcon } from '../components/Icons';
import { useStockTypes } from '../components/StockTypes';
import { useToast } from '../components/Toast';
import type { Item, StockLine, StockLocation } from '../types';
import { isBelowThreshold } from '../utils/allocation';
import { isPeriodValid, PeriodField } from './PeriodField';

type Draft = Record<string, { quantity: string; threshold: string }>;

const toInt = (v: string): number | null => (v.trim() === '' ? null : Number(v));
const isValidInt = (v: string, optional: boolean) =>
  (optional && v.trim() === '') || (/^\d+$/.test(v.trim()) && Number.isSafeInteger(Number(v)));

/** Manual split of one stock line onto the groups of its stock type. */
export function EditStockLineModal({
  item,
  location,
  line,
  onClose,
  onSaved,
}: {
  item: Item;
  location: StockLocation;
  line: StockLine;
  onClose: () => void;
  onSaved: () => void;
}) {
  const notify = useToast();
  const tree = useStockTypes();
  const type = tree.byId(line.stockTypeId);
  const groups = tree.groupsOf(line.stockTypeId);
  const [period, setPeriod] = useState(line.period);
  const [draft, setDraft] = useState<Draft>(() =>
    Object.fromEntries(
      groups.map((g) => [
        g.id,
        { quantity: String(line.split[g.id]?.quantity ?? 0), threshold: line.split[g.id]?.threshold == null ? '' : String(line.split[g.id]!.threshold) },
      ]),
    ),
  );
  const [saving, setSaving] = useState(false);

  const set = (id: string, field: 'quantity' | 'threshold', value: string) =>
    setDraft((d) => ({ ...d, [id]: { ...d[id], [field]: value } }));

  const split = groups.reduce((s, g) => s + (toInt(draft[g.id].quantity) ?? 0), 0);
  const left = line.quantity - split;
  const fieldsValid = groups.every((g) => isValidInt(draft[g.id].quantity, false) && isValidInt(draft[g.id].threshold, true));
  const valid = fieldsValid && left >= 0 && isPeriodValid(period);

  const save = async () => {
    setSaving(true);
    try {
      await api.updateStockLine({
        ...line,
        period,
        split: Object.fromEntries(groups.map((g) => [g.id, { quantity: toInt(draft[g.id].quantity) ?? 0, threshold: toInt(draft[g.id].threshold) }])),
      });
      notify(
        line.source.type === 'onestock'
          ? `Segmentation sent to OneStock for ${location.name} · ${type?.code}`
          : `Segmentation updated for ${location.name} · ${type?.code}`,
      );
      onSaved();
    } catch (e) {
      notify((e as Error).message, 'error');
      setSaving(false);
    }
  };

  return (
    <Modal
      title="Edit segmentation"
      onClose={onClose}
      width={600}
      footer={
        <>
          <button type="button" className="btn btn--secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn--primary" disabled={!valid || saving || !groups.length} onClick={save}>
            Edit
          </button>
        </>
      }
    >
      <div className="card card--compact">
        <ItemIdentity item={item} detailed />
      </div>
      <div className="card card--compact location-card">
        <span className="location-card__icon">
          <WarehouseIcon width={22} height={22} />
        </span>
        <div className="grow">
          <div>{location.name}</div>
          <div className="muted">{location.code}</div>
        </div>
        <div className="line-type">
          <div>
            {type?.label} <code>{type?.code}</code>
          </div>
          {line.purchaseOrder && <div className="muted small">PO {line.purchaseOrder}</div>}
          <div className="muted small">{line.quantity} pcs</div>
        </div>
      </div>

      {line.source.type === 'onestock' && (
        <p className="panel small">
          Stock read from OneStock: saving sends the variation of each stock type with an incremental <code>PATCH stock_import</code>
          {line.eta ? '' : tree.byId(line.stockTypeId)?.future ? ' — no ETA known for this purchase order, it cannot be sent.' : ''}. The
          activation period is not sent.
        </p>
      )}
      <h3 className="section-title">Activation period</h3>
      <PeriodField value={period} onChange={setPeriod} />

      {groups.length === 0 && <p className="muted">This stock type has no group: its stock cannot be split.</p>}
      <div className="segment-grid">
        {groups.map((g) => {
          const d = draft[g.id];
          const qValid = isValidInt(d.quantity, false);
          const tValid = isValidInt(d.threshold, true);
          const warn = qValid && tValid && isBelowThreshold(toInt(d.quantity) ?? 0, toInt(d.threshold));
          return (
            <div className="segment-grid__row" key={g.id}>
              <label className="field">
                <span className="field__label">
                  {g.label} <code>{g.code}</code>
                </span>
                <span className={`input-group ${!qValid ? 'is-invalid' : ''}`}>
                  <input inputMode="numeric" value={d.quantity} onChange={(e) => set(g.id, 'quantity', e.target.value)} />
                  {warn && (
                    <span className="input-group__addon text-warning" title={`Below threshold (${d.threshold})`}>
                      <WarningIcon />
                    </span>
                  )}
                </span>
              </label>
              <label className="field">
                <span className="field__label">{g.label} threshold</span>
                <span className={`input-group ${!tValid ? 'is-invalid' : ''}`}>
                  <input inputMode="numeric" value={d.threshold} placeholder="None" onChange={(e) => set(g.id, 'threshold', e.target.value)} />
                  <button
                    type="button"
                    className="input-group__addon input-group__btn"
                    onClick={() => set(g.id, 'threshold', '')}
                    aria-label={`Remove ${g.label} threshold`}
                    disabled={d.threshold === ''}
                  >
                    <TrashIcon />
                  </button>
                </span>
              </label>
            </div>
          );
        })}
      </div>

      <div className="non-allocated">
        <strong className={left < 0 ? 'text-error' : ''}>
          {fieldsValid ? left : '—'} : stays on {type?.code}
        </strong>
        <span className="muted"> / {line.quantity} in stock</span>
        {left < 0 && <div className="text-error small">The split exceeds the stock quantity by {-left}.</div>}
      </div>
    </Modal>
  );
}
