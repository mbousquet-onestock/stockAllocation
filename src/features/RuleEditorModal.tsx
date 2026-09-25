import { useState } from 'react';
import { api } from '../api';
import { Checkbox, Modal } from '../components/ui';
import { TrashIcon } from '../components/Icons';
import { useStockTypes } from '../components/StockTypes';
import { useToast } from '../components/Toast';
import type { ActivationPeriod, Criterion, RuleInput, SegmentationRule } from '../types';
import { computeSplit } from '../utils/allocation';
import { plural } from '../utils/format';
import { useAsync } from '../utils/useAsync';
import { CriteriaEditor, ValuesInput } from './CriteriaEditor';
import { isPeriodValid, PeriodField } from './PeriodField';
import { SplitBar } from './SplitBar';

const EXAMPLE_STOCK = 100;
const isInt = (v: string) => v.trim() === '' || /^\d+$/.test(v.trim());
const num = (v: string) => (v.trim() === '' ? 0 : Number(v));

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
  const tree = useStockTypes();
  const src = rule ?? initial;
  const [name, setName] = useState(src?.name ?? '');
  const [enabled, setEnabled] = useState(src?.enabled ?? true);
  const [criteria, setCriteria] = useState<Criterion[]>(src?.criteria ?? [{ attribute: 'category', values: [] }]);
  const [stockTypeIds, setStockTypeIds] = useState<string[]>(src?.stockTypeIds ?? []); // [] = all
  const [purchaseOrders, setPurchaseOrders] = useState<string[]>(src?.purchaseOrders ?? []);
  const [locationIds, setLocationIds] = useState<string[]>(src?.locationIds ?? []); // [] = all
  const [shares, setShares] = useState<Record<string, string>>(() =>
    Object.fromEntries(Object.entries(src?.shares ?? {}).map(([k, v]) => [k, String(v)])),
  );
  const [thresholds, setThresholds] = useState<Record<string, string>>(() =>
    Object.fromEntries(Object.entries(src?.thresholds ?? {}).map(([k, v]) => [k, v == null ? '' : String(v)])),
  );
  const [period, setPeriod] = useState<ActivationPeriod>(src?.period ?? { type: 'always' });
  const [applyNow, setApplyNow] = useState(false);
  const [saving, setSaving] = useState(false);

  const locations = useAsync(() => api.listLocations(), []);
  const criteriaKey = JSON.stringify(criteria);
  const preview = useAsync(() => api.previewCriteria({ criteria }), [criteriaKey]);

  const allTypes = tree.mainTypes.map((t) => t.id);
  const targeted = tree.mainTypes.filter((t) => stockTypeIds.length === 0 || stockTypeIds.includes(t.id));
  const targetedGroups = targeted.flatMap((t) => tree.groupsOf(t.id));
  const anyFuture = targeted.some((t) => t.future);
  const numericShares = Object.fromEntries(targetedGroups.map((g) => [g.id, num(shares[g.id] ?? '')]));
  const typeTotal = (typeId: string) => tree.groupsOf(typeId).reduce((s, g) => s + (numericShares[g.id] ?? 0), 0);
  const valuesValid = targetedGroups.every((g) => isInt(shares[g.id] ?? '') && isInt(thresholds[g.id] ?? ''));
  const sharesValid = targeted.every((t) => typeTotal(t.id) <= 100) && targeted.some((t) => typeTotal(t.id) > 0);
  const criteriaValid = criteria.length > 0 && criteria.every((c) => c.values.length > 0);
  const allLocations = (locations.data ?? []).map((l) => l.id);
  const valid = !!name.trim() && targeted.length > 0 && criteriaValid && valuesValid && sharesValid && isPeriodValid(period);

  const toggleType = (id: string, checked: boolean) => {
    const current = stockTypeIds.length ? stockTypeIds : allTypes;
    const next = checked ? [...current, id] : current.filter((x) => x !== id);
    setStockTypeIds(next.length === allTypes.length ? [] : next);
  };
  /** Group suffix (e.g. "A" for on_hand_A), used to copy a split between stock types. */
  const suffix = (groupCode: string, parentCode: string) =>
    groupCode.toLowerCase().startsWith(parentCode.toLowerCase()) ? groupCode.slice(parentCode.length).replace(/^[_-]/, '') : groupCode;
  const copySplit = (fromId: string) => {
    const from = tree.byId(fromId)!;
    const fromGroups = tree.groupsOf(fromId);
    const nextShares = { ...shares };
    const nextThresholds = { ...thresholds };
    targeted
      .filter((t) => t.id !== fromId)
      .forEach((t) =>
        tree.groupsOf(t.id).forEach((g, i) => {
          const source =
            fromGroups.find((fg) => suffix(fg.code, from.code) === suffix(g.code, t.code)) ?? fromGroups[i];
          nextShares[g.id] = source ? shares[source.id] ?? '' : '';
          nextThresholds[g.id] = source ? thresholds[source.id] ?? '' : '';
        }),
      );
    setShares(nextShares);
    setThresholds(nextThresholds);
  };

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
      stockTypeIds,
      purchaseOrders: anyFuture ? purchaseOrders : [],
      locationIds,
      shares: numericShares,
      thresholds: Object.fromEntries(targetedGroups.map((g) => [g.id, (thresholds[g.id] ?? '').trim() === '' ? null : Number(thresholds[g.id])])),
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

      <h3 className="section-title">2. Stock to segment</h3>
      <div className="panel form-stack">
        <div className="field">
          <span className="field__label">Stock types — the rule applies when the stock of these types is updated</span>
          <div className="inline-checks">
            <Checkbox
              checked={stockTypeIds.length === 0}
              onChange={(checked) => setStockTypeIds(checked ? [] : allTypes.slice(0, 1))}
              label={<strong>All stock types</strong>}
            />
            {tree.mainTypes.map((t) => (
              <Checkbox
                key={t.id}
                checked={stockTypeIds.length === 0 || stockTypeIds.includes(t.id)}
                onChange={(checked) => toggleType(t.id, checked)}
                label={
                  <>
                    {t.label} <code>{t.code}</code>
                    {t.future && <span className="badge badge--future">future</span>}
                  </>
                }
              />
            ))}
            {targeted.length === 0 && <span className="text-error small">Select at least one stock type.</span>}
          </div>
          {stockTypeIds.length === 0 && (
            <span className="muted small">Stock types added later in the settings will also be targeted.</span>
          )}
        </div>
        {anyFuture ? (
          <label className="field">
            <span className="field__label">
              Purchase orders — restrict the rule to these purchase orders (empty = any). With purchase orders, the rule only applies to
              future stock.
            </span>
            <ValuesInput
              values={purchaseOrders}
              onChange={setPurchaseOrders}
              load={(q) => api.listPurchaseOrders(targeted.filter((t) => t.future).map((t) => t.id), q)}
              loadKey={targeted.map((t) => t.id).join()}
              placeholder="Any purchase order — type a PO number and press Enter"
            />
            {purchaseOrders.length > 0 && (
              <span className="muted small">
                Rules are applied by priority: keep this rule above the rules of the same stock type without purchase order.
              </span>
            )}
          </label>
        ) : (
          <span className="muted small">Purchase order restriction is only available when a future stock type (e.g. Container, Planned) is selected.</span>
        )}
        <div className="field">
          <span className="field__label">Stock locations</span>
          <div className="inline-checks">
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
        </div>
      </div>

      <h3 className="section-title">3. Split onto the groups of each stock type (percentage of the stock)</h3>
      {targeted.map((type) => {
        const groups = tree.groupsOf(type.id);
        const total = typeTotal(type.id);
        const typeValuesValid = groups.every((g) => isInt(shares[g.id] ?? '') && isInt(thresholds[g.id] ?? ''));
        return (
          <div className="panel split-type" key={type.id}>
            <div className="split-type__header">
              <strong>
                {type.label} <code>{type.code}</code>
              </strong>
              {type.future && <span className="badge badge--future">future</span>}
              <span className="grow" />
              {targeted.length > 1 && groups.length > 0 && (
                <button type="button" className="link small" onClick={() => copySplit(type.id)}>
                  Copy this split to the other stock types
                </button>
              )}
            </div>
            {groups.length === 0 ? (
              <span className="muted small">No group: the stock of this type stays on {type.code}.</span>
            ) : (
              <>
                <div className="segment-grid">
                  {groups.map((g) => (
                    <div className="segment-grid__row" key={g.id}>
                      <label className="field">
                        <span className="field__label">
                          {g.label} <code>{g.code}</code>
                        </span>
                        <span className={`input-group ${!isInt(shares[g.id] ?? '') ? 'is-invalid' : ''}`}>
                          <input
                            inputMode="numeric"
                            value={shares[g.id] ?? ''}
                            placeholder="0"
                            onChange={(e) => setShares((v) => ({ ...v, [g.id]: e.target.value }))}
                          />
                          <span className="input-group__addon muted">%</span>
                        </span>
                      </label>
                      <label className="field">
                        <span className="field__label">{g.label} threshold</span>
                        <span className={`input-group ${!isInt(thresholds[g.id] ?? '') ? 'is-invalid' : ''}`}>
                          <input
                            inputMode="numeric"
                            value={thresholds[g.id] ?? ''}
                            placeholder="None"
                            onChange={(e) => setThresholds((v) => ({ ...v, [g.id]: e.target.value }))}
                          />
                          <button
                            type="button"
                            className="input-group__addon input-group__btn"
                            onClick={() => setThresholds((v) => ({ ...v, [g.id]: '' }))}
                            disabled={!thresholds[g.id]}
                            aria-label={`Remove ${g.label} threshold`}
                          >
                            <TrashIcon />
                          </button>
                        </span>
                      </label>
                    </div>
                  ))}
                </div>
                <div className="split-type__footer">
                  <strong className={total > 100 ? 'text-error' : ''}>
                    {100 - total} % : stays on {type.code}
                  </strong>
                  {total > 100 && <span className="text-error small">The sum of percentages cannot exceed 100 %.</span>}
                  {typeValuesValid && total > 0 && total <= 100 && (
                    <div className="example">
                      <span className="muted small">
                        Example: {EXAMPLE_STOCK} pieces updated on {type.code}
                      </span>
                      <SplitBar
                        main={type}
                        groups={groups}
                        quantities={computeSplit(EXAMPLE_STOCK, numericShares, groups.map((g) => g.id))}
                        total={EXAMPLE_STOCK}
                        labels
                      />
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        );
      })}
      {targeted.length > 0 && !targeted.some((t) => typeTotal(t.id) > 0) && (
        <span className="muted small">Enter at least one percentage.</span>
      )}

      <h3 className="section-title">4. Activation period</h3>
      <PeriodField value={period} onChange={setPeriod} />
    </Modal>
  );
}
