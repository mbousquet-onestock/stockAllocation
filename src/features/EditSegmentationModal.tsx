import { useState } from 'react';
import { api } from '../api';
import { ItemIdentity, Modal } from '../components/ui';
import { TrashIcon, WarehouseIcon, WarningIcon } from '../components/Icons';
import { useToast } from '../components/Toast';
import { SEGMENTS, segmentRecord } from '../config/segments';
import type { Allocation, Item, SegmentId, StockLocation } from '../types';
import { isBelowThreshold } from '../utils/allocation';
import { isPeriodValid, PeriodField } from './PeriodField';

type Draft = Record<SegmentId, { quantity: string; threshold: string }>;

const toInt = (v: string): number | null => (v.trim() === '' ? null : Number(v));
const isValidInt = (v: string, optional: boolean) =>
  (optional && v.trim() === '') || (/^\d+$/.test(v.trim()) && Number.isSafeInteger(Number(v)));

export function EditSegmentationModal({
  item,
  location,
  allocation,
  onClose,
  onSaved,
}: {
  item: Item;
  location: StockLocation;
  allocation: Allocation;
  onClose: () => void;
  onSaved: () => void;
}) {
  const notify = useToast();
  const [period, setPeriod] = useState(allocation.period);
  const [draft, setDraft] = useState<Draft>(() =>
    segmentRecord((id) => ({
      quantity: String(allocation.segments[id].quantity),
      threshold: allocation.segments[id].threshold === null ? '' : String(allocation.segments[id].threshold),
    })),
  );
  const [saving, setSaving] = useState(false);

  const set = (id: SegmentId, field: 'quantity' | 'threshold', value: string) =>
    setDraft((d) => ({ ...d, [id]: { ...d[id], [field]: value } }));

  const allocated = SEGMENTS.reduce((s, seg) => s + (toInt(draft[seg.id].quantity) ?? 0), 0);
  const remaining = allocation.totalStock - allocated;
  const fieldsValid = SEGMENTS.every(
    (s) => isValidInt(draft[s.id].quantity, false) && isValidInt(draft[s.id].threshold, true),
  );
  const valid = fieldsValid && remaining >= 0 && isPeriodValid(period);

  const save = async () => {
    setSaving(true);
    try {
      await api.updateAllocation({
        ...allocation,
        period,
        segments: segmentRecord((id) => ({
          quantity: toInt(draft[id].quantity) ?? 0,
          threshold: toInt(draft[id].threshold),
        })),
      });
      notify(`Segmentation updated for ${location.name}`);
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
          <button type="button" className="btn btn--primary" disabled={!valid || saving} onClick={save}>
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
        <div>
          <div>{location.name}</div>
          <div className="muted">{location.code}</div>
        </div>
      </div>

      <h3 className="section-title">Activation period</h3>
      <PeriodField value={period} onChange={setPeriod} />

      <div className="segment-grid">
        {SEGMENTS.map((seg) => {
          const d = draft[seg.id];
          const qValid = isValidInt(d.quantity, false);
          const tValid = isValidInt(d.threshold, true);
          const warn = qValid && tValid && isBelowThreshold(toInt(d.quantity) ?? 0, toInt(d.threshold));
          return (
            <div className="segment-grid__row" key={seg.id}>
              <label className="field">
                <span className="field__label">{seg.label}</span>
                <span className={`input-group ${!qValid ? 'is-invalid' : ''}`}>
                  <input inputMode="numeric" value={d.quantity} onChange={(e) => set(seg.id, 'quantity', e.target.value)} />
                  {warn && (
                    <span className="input-group__addon text-warning" title={`Below threshold (${d.threshold})`}>
                      <WarningIcon />
                    </span>
                  )}
                </span>
              </label>
              <label className="field">
                <span className="field__label">{seg.label} threshold</span>
                <span className={`input-group ${!tValid ? 'is-invalid' : ''}`}>
                  <input inputMode="numeric" value={d.threshold} placeholder="None" onChange={(e) => set(seg.id, 'threshold', e.target.value)} />
                  <button
                    type="button"
                    className="input-group__addon input-group__btn"
                    onClick={() => set(seg.id, 'threshold', '')}
                    aria-label={`Remove ${seg.label} threshold`}
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
        <strong className={remaining < 0 ? 'text-error' : ''}>
          {fieldsValid ? remaining : '—'} : Non allocated
        </strong>
        <span className="muted"> / {allocation.totalStock} in stock</span>
        {remaining < 0 && <div className="text-error small">Allocated quantities exceed the total stock by {-remaining}.</div>}
      </div>
    </Modal>
  );
}
