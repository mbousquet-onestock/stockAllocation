import { useMemo, useState } from 'react';
import { api } from '../api';
import { Checkbox, Modal } from '../components/ui';
import { TrashIcon } from '../components/Icons';
import { useToast } from '../components/Toast';
import { SEGMENTS, segmentRecord } from '../config/segments';
import type { ActivationPeriod, Criterion, RuleInput, RuleMode, SegmentId, SegmentationRule } from '../types';
import { computeQuantities } from '../utils/allocation';
import { plural } from '../utils/format';
import { useAsync } from '../utils/useAsync';
import { CriteriaEditor } from './CriteriaEditor';
import { isPeriodValid, PeriodField } from './PeriodField';

const EXAMPLE_STOCK = 100;

export function RuleEditorModal({
  rule,
  initial,
  onClose,
  onSaved,
}: {
  /** Rule to edit; omitted to create one. */
  rule?: SegmentationRule;
  /** Prefill for a new rule (e.g. criteria on the current item). */
  initial?: Partial<RuleInput>;
  onClose: () => void;
  onSaved: (rule: SegmentationRule) => void;
}) {
  const notify = useToast();
  const src = rule ?? initial;
  const [name, setName] = useState(src?.name ?? '');
  const [enabled, setEnabled] = useState(src?.enabled ?? true);
  const [criteria, setCriteria] = useState<Criterion[]>(src?.criteria ?? [{ attribute: 'category', values: [] }]);
  const [locationIds, setLocationIds] = useState<string[]>(src?.locationIds ?? []); // [] = all
  const [mode, setMode] = useState<RuleMode>(src?.mode ?? 'percentage');
  const [values, setValues] = useState<Record<SegmentId, string>>(() =>
    segmentRecord((id) => (src?.values ? String(src.values[id]) : '')),
  );
  const [thresholds, setThresholds] = useState<Record<SegmentId, string>>(() =>
    segmentRecord((id) => (src?.thresholds?.[id] != null ? String(src.thresholds[id]) : '')),
  );
  const [period, setPeriod] = useState<ActivationPeriod>(src?.period ?? { type: 'always' });
  const [applyNow, setApplyNow] = useState(false);
  const [saving, setSaving] = useState(false);

  const locations = useAsync(() => api.listLocations(), []);
  const criteriaKey = JSON.stringify(criteria);
  const preview = useAsync(() => api.previewCriteria({ criteria }), [criteriaKey]);

  const num = (v: string) => (v.trim() === '' ? 0 : Number(v));
  const isInt = (v: string) => v.trim() === '' || /^\d+$/.test(v.trim());
  const numericValues = segmentRecord((id) => num(values[id]));
  const total = SEGMENTS.reduce((s, seg) => s + numericValues[seg.id], 0);
  const valuesValid = SEGMENTS.every((s) => isInt(values[s.id]) && isInt(thresholds[s.id]));
  const percentValid = mode === 'quantity' || total <= 100;
  const criteriaValid = criteria.length > 0 && criteria.every((c) => c.values.length > 0);
  const allLocations = (locations.data ?? []).map((l) => l.id);

  const valid = !!name.trim() && criteriaValid && valuesValid && percentValid && total > 0 && isPeriodValid(period);

  const example = useMemo(
    () => computeQuantities(EXAMPLE_STOCK, { mode, values: numericValues }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mode, values],
  );
  const exampleRest = EXAMPLE_STOCK - SEGMENTS.reduce((s, seg) => s + example.quantities[seg.id], 0);

  const toggleLocation = (id: string, checked: boolean) => {
    const current = locationIds.length ? locationIds : allLocations;
    const next = checked ? [...current, id] : current.filter((x) => x !== id);
    setLocationIds(next.length === allLocations.length ? [] : next);
  };

  const save = async () => {
    const input: RuleInput = {
      name: name.trim(),
      enabled,
      criteria,
      locationIds,
      mode,
      values: numericValues,
      thresholds: segmentRecord((id) => (thresholds[id].trim() === '' ? null : Number(thresholds[id]))),
      period,
    };
    setSaving(true);
    try {
      const saved = rule ? await api.updateRule(rule.id, input) : await api.createRule(input);
      let message = `Rule "${saved.name}" ${rule ? 'updated' : 'created'}`;
      if (applyNow) {
        const res = await api.applyRulesToCurrentStock(saved.id);
        message += ` — ${plural(res.updated, 'stock line')} re-segmented`;
      }
      notify(message);
      onSaved(saved);
    } catch (e) {
      notify((e as Error).message, 'error');
      setSaving(false);
    }
  };

  const unit = mode === 'percentage' ? '%' : 'pcs';
  const selectedCount = locationIds.length || allLocations.length;

  return (
    <Modal
      title={rule ? 'Edit segmentation rule' : 'New segmentation rule'}
      onClose={onClose}
      width={780}
      footer={
        <>
          <span className="footer-hint">
            <Checkbox checked={applyNow} onChange={setApplyNow} label="Also re-segment the current stock now" />
          </span>
          <button type="button" className="btn btn--secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn--primary" disabled={!valid || saving} onClick={save}>
            {rule ? 'Save' : 'Create rule'}
          </button>
        </>
      }
    >
      <div className="rule-name">
        <label className="field grow">
          <span className="field__label">Rule name</span>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Air fryers – Christmas" autoFocus />
        </label>
        <Checkbox checked={enabled} onChange={setEnabled} label="Enabled" />
      </div>

      <h3 className="section-title">1. Item characteristics</h3>
      <div className="panel">
        <CriteriaEditor criteria={criteria} onChange={setCriteria} />
        <div className="preview">
          {!criteriaValid ? (
            <span className="muted">Choose at least one value for each criterion.</span>
          ) : preview.data ? (
            <>
              <strong>{plural(preview.data.itemCount, 'item')} matched</strong>
              {preview.data.sample.length > 0 && (
                <span className="muted">
                  {' '}
                  — {preview.data.sample.map((i) => i.name).join(', ')}
                  {preview.data.itemCount > preview.data.sample.length && '…'}
                </span>
              )}
            </>
          ) : null}
        </div>
      </div>

      <h3 className="section-title">2. Stock locations</h3>
      <div className="panel inline-checks">
        {(locations.data ?? []).map((l) => (
          <Checkbox
            key={l.id}
            checked={locationIds.length === 0 || locationIds.includes(l.id)}
            onChange={(checked) => toggleLocation(l.id, checked)}
            label={
              <>
                {l.name} <span className="muted">{l.code}</span>
              </>
            }
          />
        ))}
        {selectedCount === 0 && <span className="text-error small">Select at least one stock location.</span>}
      </div>

      <h3 className="section-title">3. Allocation</h3>
      <div className="segmented-control">
        <button type="button" className={mode === 'percentage' ? 'is-active' : ''} onClick={() => setMode('percentage')}>
          Percentage of stock
        </button>
        <button type="button" className={mode === 'quantity' ? 'is-active' : ''} onClick={() => setMode('quantity')}>
          Fixed quantity per location
        </button>
      </div>
      <div className="segment-grid">
        {SEGMENTS.map((seg) => (
          <div className="segment-grid__row" key={seg.id}>
            <label className="field">
              <span className="field__label">{seg.label}</span>
              <span className={`input-group ${!isInt(values[seg.id]) ? 'is-invalid' : ''}`}>
                <input inputMode="numeric" value={values[seg.id]} placeholder="0" onChange={(e) => setValues((v) => ({ ...v, [seg.id]: e.target.value }))} />
                <span className="input-group__addon muted">{unit}</span>
              </span>
            </label>
            <label className="field">
              <span className="field__label">{seg.label} threshold</span>
              <span className={`input-group ${!isInt(thresholds[seg.id]) ? 'is-invalid' : ''}`}>
                <input
                  inputMode="numeric"
                  value={thresholds[seg.id]}
                  placeholder="None"
                  onChange={(e) => setThresholds((v) => ({ ...v, [seg.id]: e.target.value }))}
                />
                <button
                  type="button"
                  className="input-group__addon input-group__btn"
                  onClick={() => setThresholds((v) => ({ ...v, [seg.id]: '' }))}
                  disabled={thresholds[seg.id] === ''}
                  aria-label={`Remove ${seg.label} threshold`}
                >
                  <TrashIcon />
                </button>
              </span>
            </label>
          </div>
        ))}
      </div>

      <div className="non-allocated">
        {mode === 'percentage' ? (
          <strong className={!percentValid ? 'text-error' : ''}>{100 - total} % : Non allocated</strong>
        ) : (
          <strong>{total} pcs allocated per stock location, the rest stays non allocated</strong>
        )}
        {!percentValid && <div className="text-error small">The sum of percentages cannot exceed 100 %.</div>}
      </div>

      {valuesValid && percentValid && total > 0 && (
        <div className="example">
          <span className="muted">Example on an import of {EXAMPLE_STOCK} pieces:</span>
          <div className="stack-bar">
            {SEGMENTS.map((seg, i) =>
              example.quantities[seg.id] > 0 ? (
                <span key={seg.id} className={`stack-bar__part seg-${i}`} style={{ flex: example.quantities[seg.id] }} title={seg.label}>
                  {seg.label} {example.quantities[seg.id]}
                </span>
              ) : null,
            )}
            {exampleRest > 0 && (
              <span className="stack-bar__part seg-rest" style={{ flex: exampleRest }}>
                Non allocated {exampleRest}
              </span>
            )}
          </div>
          {example.capped && (
            <div className="text-warning small">
              Quantities exceed the stock: they are capped in the order {SEGMENTS.map((s) => s.label).join(' → ')}.
            </div>
          )}
        </div>
      )}

      <h3 className="section-title">4. Activation period</h3>
      <PeriodField value={period} onChange={setPeriod} />
    </Modal>
  );
}
