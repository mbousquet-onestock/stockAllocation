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
/** Stock adjustment: signed integer (+5, -3), empty = none. */
const isValidAdjustment = (v: string) => v.trim() === '' || (/^[+-]?\d+$/.test(v.trim()) && Number.isSafeInteger(Number(v)));

/** Manual split of one stock line onto the groups of its stock type. */
export function EditStockLineModal({
  item,
  location,
  line,
  ruleThresholds,
  onClose,
  onSaved,
}: {
  item: Item;
  location: StockLocation;
  line: StockLine;
  /** Thresholds of the rule of the line: an empty threshold means this one. */
  ruleThresholds?: Record<string, number | null>;
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
        {
          quantity: String(line.split[g.id]?.quantity ?? 0),
          // Threshold of the line only: the threshold of the rule is shown as placeholder.
          threshold:
            line.split[g.id]?.threshold == null || line.split[g.id]!.threshold === (ruleThresholds?.[g.id] ?? null)
              ? ''
              : String(line.split[g.id]!.threshold),
        },
      ]),
    ),
  );
  const [saving, setSaving] = useState(false);
  // Manual change of the stock quantity (added to / removed from the main type).
  const [adjustment, setAdjustment] = useState('');
  const adjustmentValid = isValidAdjustment(adjustment);
  const delta = adjustmentValid ? Number(adjustment.trim() || 0) : 0;
  const quantity = line.quantity + delta;
  const step = (by: number) => {
    const next = delta + by;
    setAdjustment(next === 0 ? '' : next > 0 ? `+${next}` : String(next));
  };

  const set = (id: string, field: 'quantity' | 'threshold', value: string) =>
    setDraft((d) => ({ ...d, [id]: { ...d[id], [field]: value } }));

  const split = groups.reduce((s, g) => s + (toInt(draft[g.id].quantity) ?? 0), 0);
  const left = quantity - split;
  const fieldsValid = adjustmentValid && groups.every((g) => isValidInt(draft[g.id].quantity, false) && isValidInt(draft[g.id].threshold, true));
  const valid = fieldsValid && quantity >= 0 && left >= 0 && isPeriodValid(period);

  const save = async () => {
    setSaving(true);
    try {
      await api.updateStockLine({
        ...line,
        quantity,
        period,
        // Empty threshold: the one of the rule.
        split: Object.fromEntries(
          groups.map((g) => [g.id, { quantity: toInt(draft[g.id].quantity) ?? 0, threshold: toInt(draft[g.id].threshold) ?? ruleThresholds?.[g.id] ?? null }]),
        ),
      });
      const change = delta ? ` · stock ${delta > 0 ? '+' : ''}${delta} (${quantity} pcs)` : '';
      notify(
        line.source.type === 'onestock'
          ? `Segmentation sent to OneStock for ${location.name} · ${type?.code}${change}`
          : `Segmentation updated for ${location.name} · ${type?.code}${change}`,
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
          <button type="button" className="btn btn--primary" disabled={!valid || saving || (!groups.length && !delta)} onClick={save}>
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

      {line.source.type === 'onestock' && !line.eta && tree.byId(line.stockTypeId)?.future && (
        <p className="panel small text-warning">No ETA known for this purchase order in OneStock: the changes cannot be sent.</p>
      )}
      <h3 className="section-title">Stock quantity</h3>
      <div className="stock-adjust">
        <label className="field">
          <span className="field__label">
            Add or remove <span className="muted">(on {type?.code})</span>
          </span>
          <span className={`input-group ${!adjustmentValid || quantity < 0 ? 'is-invalid' : ''}`}>
            <button type="button" className="input-group__addon input-group__btn" onClick={() => step(-1)} aria-label="Remove one">
              −
            </button>
            <input
              inputMode="numeric"
              value={adjustment}
              placeholder="e.g. +5 or -3"
              onChange={(e) => setAdjustment(e.target.value)}
              aria-label="Stock adjustment"
            />
            <button type="button" className="input-group__addon input-group__btn" onClick={() => step(1)} aria-label="Add one">
              +
            </button>
          </span>
        </label>
        <div className="stock-adjust__result">
          <span className="muted small">New stock</span>
          <strong className={quantity < 0 ? 'text-error' : delta ? 'text-accent' : ''}>
            {line.quantity}
            {delta !== 0 && ` → ${adjustmentValid ? quantity : '—'}`} pcs
          </strong>
        </div>
      </div>
      {quantity < 0 && <div className="text-error small">The stock cannot be negative.</div>}

      <h3 className="section-title">Activation period</h3>
      <PeriodField value={period} onChange={setPeriod} />

      {groups.length === 0 && <p className="muted">This stock type has no group: its stock cannot be split.</p>}
      <div className="segment-grid">
        {groups.map((g) => {
          const d = draft[g.id];
          const qValid = isValidInt(d.quantity, false);
          const tValid = isValidInt(d.threshold, true);
          const warn = qValid && tValid && isBelowThreshold(toInt(d.quantity) ?? 0, toInt(d.threshold) ?? ruleThresholds?.[g.id] ?? null);
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
                <span className="field__label">{g.label} threshold <span className="muted">(alert when below)</span></span>
                <span className={`input-group ${!tValid ? 'is-invalid' : ''}`}>
                  <input
                    inputMode="numeric"
                    value={d.threshold}
                    placeholder={ruleThresholds?.[g.id] != null ? `Rule: ${ruleThresholds[g.id]}` : 'None'}
                    onChange={(e) => set(g.id, 'threshold', e.target.value)}
                  />
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
        <span className="muted"> / {quantity} in stock</span>
        {left < 0 && quantity >= 0 && <div className="text-error small">The split exceeds the stock quantity by {-left}.</div>}
      </div>
    </Modal>
  );
}
