import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { ConfirmModal } from '../components/ConfirmModal';
import { useDataVersion } from '../components/DataVersion';
import { ArrowDownIcon, ArrowUpIcon, CopyIcon, DownloadIcon, PlayIcon, TrashIcon } from '../components/Icons';
import { useToast } from '../components/Toast';
import { ItemIdentity, Pagination, Spinner } from '../components/ui';
import { ATTRIBUTES, attributeLabel } from '../config/attributes';
import { SEGMENTS } from '../config/segments';
import { RuleEditorModal } from '../features/RuleEditorModal';
import { StockImportModal } from '../features/StockImportModal';
import type { AttributeKey, RuleInput, SegmentationRule, StockLocation } from '../types';
import { formatPeriod, plural, todayIso } from '../utils/format';
import { toRuleInput } from '../utils/rules';
import { useAsync, useDebounced } from '../utils/useAsync';

type ModalState =
  | { type: 'edit'; rule?: SegmentationRule; initial?: Partial<RuleInput> }
  | { type: 'delete'; rule: SegmentationRule }
  | { type: 'applyAll' }
  | { type: 'import' }
  | null;

function RuleAllocation({ rule }: { rule: SegmentationRule }) {
  const unit = rule.mode === 'percentage' ? '%' : ' pcs';
  const total = SEGMENTS.reduce((s, seg) => s + rule.values[seg.id], 0);
  return (
    <div className="rule-alloc">
      <div className="rule-alloc__values">
        {SEGMENTS.map((seg, i) => (
          <span key={seg.id} title={seg.label}>
            <i className={`legend seg-${i}`} />
            {rule.values[seg.id]}
            {unit}
          </span>
        ))}
      </div>
      {rule.mode === 'percentage' && (
        <div className="stack-bar stack-bar--mini">
          {SEGMENTS.map((seg, i) =>
            rule.values[seg.id] > 0 ? <span key={seg.id} className={`stack-bar__part seg-${i}`} style={{ flex: rule.values[seg.id] }} /> : null,
          )}
          {total < 100 && <span className="stack-bar__part seg-rest" style={{ flex: 100 - total }} />}
        </div>
      )}
      {rule.mode === 'quantity' && <span className="muted small">fixed per location</span>}
    </div>
  );
}

const locationNames = (ids: string[], all: StockLocation[]) =>
  ids.length === 0 ? 'All' : ids.map((id) => all.find((l) => l.id === id)?.name ?? id).join(', ');

export function RulesPage() {
  const { version, bump } = useDataVersion();
  const notify = useToast();
  const [params, setParams] = useSearchParams();
  const search = params.get('q') ?? '';
  const attribute = (params.get('attr') as AttributeKey | null) ?? undefined;
  const page = Number(params.get('page') ?? 0);
  const pageSize = Number(params.get('size') ?? 25);
  const [searchInput, setSearchInput] = useState(search);
  const debouncedSearch = useDebounced(searchInput);
  const [modal, setModal] = useState<ModalState>(null);
  const today = todayIso();

  const update = (patch: Record<string, string | undefined>) => {
    const next = new URLSearchParams(params);
    Object.entries(patch).forEach(([k, v]) => (v === undefined || v === '' ? next.delete(k) : next.set(k, v)));
    setParams(next, { replace: true });
  };
  useEffect(() => {
    if (debouncedSearch !== search) update({ q: debouncedSearch, page: undefined });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch]);

  const list = useAsync(() => api.listRules({ search, attribute, page, pageSize }), [search, attribute, page, pageSize, version]);
  const locations = useAsync(() => api.listLocations(), []);
  const rows = list.data?.data ?? [];
  const matched = list.data?.matchedItem;

  const run = async (action: () => Promise<unknown>, message?: string) => {
    try {
      await action();
      if (message) notify(message);
      bump();
    } catch (e) {
      notify((e as Error).message, 'error');
    }
  };

  const duplicate = (rule: SegmentationRule) => {
    setModal({ type: 'edit', initial: { ...toRuleInput(rule), name: `${rule.name} (copy)`, enabled: false } });
  };

  const pagination = list.data && (
    <Pagination
      page={page}
      pageSize={pageSize}
      total={list.data.total}
      onPage={(p) => update({ page: String(p) })}
      onPageSize={(s) => update({ size: String(s), page: undefined })}
    />
  );

  return (
    <div className="card page">
      <div className="toolbar">
        <select className="select" value={attribute ?? ''} onChange={(e) => update({ attr: e.target.value || undefined, page: undefined })} aria-label="Characteristic">
          <option value="">All characteristics</option>
          {ATTRIBUTES.map((a) => (
            <option key={a.key} value={a.key}>
              {a.label}
            </option>
          ))}
        </select>
        <input
          className="input grow"
          placeholder={attribute ? `Search a ${attributeLabel(attribute).toLowerCase()}` : 'Search a rule, SKU, category, brand, season…'}
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
        />
        <button type="button" className="btn btn--primary" onClick={() => setModal({ type: 'edit' })}>
          New segmentation rule
        </button>
        <button type="button" className="btn btn--secondary" onClick={() => setModal({ type: 'import' })}>
          <DownloadIcon /> Stock import
        </button>
        <button type="button" className="btn btn--secondary" onClick={() => setModal({ type: 'applyAll' })} title="Re-segment the current stock with the rules">
          <PlayIcon /> Apply rules
        </button>
      </div>

      <p className="muted small hint">
        Rules are applied at stock import, by priority: for each item and stock location, the first enabled rule whose
        characteristics all match computes the segmentation.
      </p>

      {matched && (
        <div className="matched-item">
          <ItemIdentity item={matched.item} />
          <span className="grow" />
          <span>
            Effective rule:{' '}
            <strong>{rows.find((r) => r.rule.id === matched.effectiveRuleId)?.rule.name ?? (matched.effectiveRuleId ? '—' : 'none')}</strong>
          </span>
          <Link className="btn btn--secondary" to={`/items/${matched.item.id}`}>
            See allocation
          </Link>
        </div>
      )}

      <div className="list-header">
        <strong>{list.data ? plural(list.data.total, 'rule') : ''}</strong>
        <span className="grow" />
        {pagination}
      </div>

      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th className="col-priority">Priority</th>
              <th>Rule</th>
              <th>Item characteristics</th>
              <th>Stock locations</th>
              <th>
                Allocation
                <div className="legend-row">
                  {SEGMENTS.map((s, i) => (
                    <span key={s.id}>
                      <i className={`legend seg-${i}`} /> {s.label}
                    </span>
                  ))}
                </div>
              </th>
              <th>Activation period</th>
              <th>Items</th>
              <th className="col-actions" />
            </tr>
          </thead>
          <tbody className={list.loading ? 'is-loading' : ''}>
            {rows.map(({ rule, matchedItemCount }) => {
              const active = rule.period.type === 'always' || (rule.period.start <= today && today <= rule.period.end);
              const isEffective = matched?.effectiveRuleId === rule.id;
              return (
                <tr
                  key={rule.id}
                  className={`is-clickable ${rule.enabled ? '' : 'is-disabled'} ${isEffective ? 'is-highlighted' : ''}`}
                  onClick={() => setModal({ type: 'edit', rule })}
                >
                  <td className="col-priority" onClick={(e) => e.stopPropagation()}>
                    <div className="priority">
                      <span className="priority__num">{rule.priority}</span>
                      <span className="priority__arrows">
                        <button type="button" className="icon-btn icon-btn--sm" disabled={rule.priority === 1} onClick={() => run(() => api.moveRule(rule.id, -1))} aria-label="Move up">
                          <ArrowUpIcon />
                        </button>
                        <button
                          type="button"
                          className="icon-btn icon-btn--sm"
                          disabled={rule.priority === list.data?.ruleCount}
                          onClick={() => run(() => api.moveRule(rule.id, 1))}
                          aria-label="Move down"
                        >
                          <ArrowDownIcon />
                        </button>
                      </span>
                    </div>
                  </td>
                  <td>
                    <div className="rule-title">
                      {rule.name}
                      {!rule.enabled && <span className="badge badge--muted">Disabled</span>}
                      {isEffective && <span className="badge badge--success">Effective</span>}
                    </div>
                    <div className="muted small">Updated {new Date(rule.updatedAt).toLocaleDateString('fr-FR')}</div>
                  </td>
                  <td>
                    <div className="criteria-chips">
                      {rule.criteria.map((c) => (
                        <span className="chip chip--criterion" key={c.attribute}>
                          <span className="muted">{attributeLabel(c.attribute)}:</span> {c.values.join(', ')}
                        </span>
                      ))}
                    </div>
                  </td>
                  <td>{locationNames(rule.locationIds, locations.data ?? [])}</td>
                  <td>
                    <RuleAllocation rule={rule} />
                  </td>
                  <td>
                    <span className={`badge ${active ? 'badge--success' : 'badge--muted'}`}>{formatPeriod(rule.period)}</span>
                  </td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <Link to={`/items?rule=${rule.id}`} className="badge badge--link" title="See the matched items and their allocation">
                      {matchedItemCount}
                    </Link>
                  </td>
                  <td className="col-actions" onClick={(e) => e.stopPropagation()}>
                    <label className="switch" title={rule.enabled ? 'Disable' : 'Enable'}>
                      <input
                        type="checkbox"
                        checked={rule.enabled}
                        onChange={(e) => {
                          run(() => api.updateRule(rule.id, { ...toRuleInput(rule), enabled: e.target.checked }), `Rule ${e.target.checked ? 'enabled' : 'disabled'}`);
                        }}
                      />
                      <span />
                    </label>
                    <button type="button" className="icon-btn" onClick={() => duplicate(rule)} aria-label="Duplicate" title="Duplicate">
                      <CopyIcon />
                    </button>
                    <button type="button" className="icon-btn" onClick={() => setModal({ type: 'delete', rule })} aria-label="Delete" title="Delete">
                      <TrashIcon />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {list.loading && !list.data && <Spinner />}
        {list.data?.total === 0 && (
          <div className="muted empty">
            No rule found.{' '}
            <button type="button" className="link" onClick={() => setModal({ type: 'edit' })}>
              Create one
            </button>
          </div>
        )}
      </div>

      <div className="list-footer">{pagination}</div>

      {modal?.type === 'edit' && (
        <RuleEditorModal
          rule={modal.rule}
          initial={modal.initial}
          onClose={() => setModal(null)}
          onSaved={() => {
            setModal(null);
            bump();
          }}
        />
      )}
      {modal?.type === 'delete' && (
        <ConfirmModal
          title="Delete rule"
          confirmLabel="Delete"
          danger
          onClose={() => setModal(null)}
          onConfirm={() => {
            setModal(null);
            run(() => api.deleteRule(modal.rule.id), `Rule "${modal.rule.name}" deleted`);
          }}
        >
          <p>
            Delete <strong>{modal.rule.name}</strong>? The current allocations keep their quantities until the next stock import.
          </p>
        </ConfirmModal>
      )}
      {modal?.type === 'applyAll' && (
        <ConfirmModal
          title="Apply rules to current stock"
          confirmLabel="Apply rules"
          onClose={() => setModal(null)}
          onConfirm={() => {
            setModal(null);
            run(async () => {
              const res = await api.applyRulesToCurrentStock();
              notify(`${plural(res.updated, 'stock line')} re-segmented: ${res.byRule} by a rule, ${res.withoutRule} without rule`);
            });
          }}
        >
          <p>
            The whole current stock will be segmented again as during a stock import. <strong>Manual segmentations will be
            replaced.</strong>
          </p>
        </ConfirmModal>
      )}
      {modal?.type === 'import' && (
        <StockImportModal
          onClose={() => setModal(null)}
          onImported={() => {
            setModal(null);
            bump();
          }}
        />
      )}
    </div>
  );
}
