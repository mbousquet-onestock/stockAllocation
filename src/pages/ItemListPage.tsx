import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { useDataVersion } from '../components/DataVersion';
import { CloseIcon, DownloadIcon, WarningIcon } from '../components/Icons';
import { Checkbox, ItemIdentity, Pagination, QtyBadge, SortHeader, Spinner } from '../components/ui';
import { useStockTypes } from '../components/StockTypes';
import { refreshAllStock, stockReadAt, useOnestockStock } from '../api/onestock';
import { ApplyRulesOnestockModal } from '../features/ApplyRulesOnestockModal';
import { ItemSearch } from '../features/ItemSearch';
import { RuleEditorModal } from '../features/RuleEditorModal';
import { StockImportModal } from '../features/StockImportModal';
import type { Item, ItemSortKey, Sort } from '../types';
import { plural } from '../utils/format';
import { useAsync, useDebounced } from '../utils/useAsync';

export function ItemListPage() {
  const navigate = useNavigate();
  const { version, bump } = useDataVersion();
  const [params, setParams] = useSearchParams();
  const search = params.get('q') ?? '';
  const page = Number(params.get('page') ?? 0);
  const pageSize = Number(params.get('size') ?? 25);
  const warningType = params.get('warning') ?? undefined;
  const tree = useStockTypes();
  const segments = tree.ordered;
  const ruleId = params.get('rule') ?? undefined;
  const sortParam = params.get('sort');
  const sort: Sort<ItemSortKey> | undefined = sortParam
    ? { key: sortParam.replace(/^-/, '') as ItemSortKey, direction: sortParam.startsWith('-') ? 'desc' : 'asc' }
    : undefined;

  const [searchInput, setSearchInput] = useState(search);
  const debouncedSearch = useDebounced(searchInput);
  const [selected, setSelected] = useState<Map<string, Item>>(new Map());
  const [modal, setModal] = useState<'add' | 'import' | 'applyOnestock' | null>(null);

  const update = (patch: Record<string, string | undefined>) => {
    const next = new URLSearchParams(params);
    Object.entries(patch).forEach(([k, v]) => (v === undefined || v === '' ? next.delete(k) : next.set(k, v)));
    setParams(next, { replace: true });
  };

  useEffect(() => {
    if (debouncedSearch !== search) update({ q: debouncedSearch, page: undefined });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch]);

  const list = useAsync(
    () => api.listItems({ search, page, pageSize, sort, warningType, ruleId }),
    [search, page, pageSize, sortParam, warningType, ruleId, version],
  );
  const rule = useAsync(() => (ruleId ? api.getRule(ruleId) : Promise.resolve(undefined)), [ruleId, version]);
  const warnings = useAsync(() => api.getWarningSummary(), [version]);
  // Warning chips are computed on the local stock: hidden when the stock comes from OneStock.
  const onestockStock = useOnestockStock();

  const rows = list.data?.data ?? [];
  const pageSelected = rows.filter((r) => selected.has(r.item.id)).length;

  const toggle = (item: Item, checked: boolean) =>
    setSelected((m) => {
      const next = new Map(m);
      if (checked) next.set(item.id, item);
      else next.delete(item.id);
      return next;
    });
  const toggleAll = (checked: boolean) =>
    setSelected((m) => {
      const next = new Map(m);
      rows.forEach((r) => (checked ? next.set(r.item.id, r.item) : next.delete(r.item.id)));
      return next;
    });

  const onSort = (key: ItemSortKey) => {
    const value = sort?.key !== key ? key : sort.direction === 'asc' ? `-${key}` : undefined;
    update({ sort: value, page: undefined });
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
        <ItemSearch value={searchInput} onChange={setSearchInput} onPick={(item) => navigate(`/items/${encodeURIComponent(item.id)}`)} />
        <button type="button" className="btn btn--primary" onClick={() => setModal('add')}>
          {selected.size ? `Create a rule for ${plural(selected.size, 'item')}` : 'New segmentation rule'}
        </button>
        {selected.size > 0 && useOnestockStock() && (
          <button type="button" className="btn btn--secondary" onClick={() => setModal('applyOnestock')}>
            Apply rules → OneStock ({selected.size})
          </button>
        )}
        <button type="button" className="btn btn--secondary" onClick={() => setModal('import')}>
          <DownloadIcon /> Stock import
        </button>
      </div>

      {(ruleId || (!onestockStock && (warnings.data?.length ?? 0) > 0)) && (
        <div className="chips">
          {ruleId && (
            <span className="chip chip--selected">
              Matched by rule: {rule.data?.name ?? '…'}
              <button type="button" onClick={() => update({ rule: undefined, page: undefined })} aria-label="Remove rule filter">
                <CloseIcon width={12} height={12} />
              </button>
            </span>
          )}
          {(onestockStock ? [] : warnings.data ?? []).map((w) => (
            <button
              type="button"
              key={w.stockTypeId}
              className={`chip chip--warning ${warningType === w.stockTypeId ? 'is-active' : ''}`}
              onClick={() => update({ warning: warningType === w.stockTypeId ? undefined : w.stockTypeId, page: undefined })}
            >
              <WarningIcon width={12} height={12} />
              {plural(w.itemCount, 'item')} - Below threshold – {tree.code(w.stockTypeId)}
            </button>
          ))}
        </div>
      )}

      <div className="list-header">
        <Checkbox
          checked={rows.length > 0 && pageSelected === rows.length}
          indeterminate={pageSelected > 0}
          onChange={toggleAll}
          label="Select all"
        />
        {selected.size > 0 && (
          <span className="muted small">
            {plural(selected.size, 'item')} selected ·{' '}
            <button type="button" className="link" onClick={() => setSelected(new Map())}>
              Clear
            </button>
          </span>
        )}
        {!sort && <span className="muted small">Items with stock first</span>}
        {onestockStock && list.data && (
          <span className="muted small">
            · Stock read from OneStock{stockReadAt() ? ` at ${new Date(stockReadAt()!).toLocaleTimeString('fr-FR')}` : ''} ·{' '}
            <button
              type="button"
              className="link"
              onClick={() => {
                refreshAllStock();
                bump();
              }}
            >
              Refresh stock
            </button>
          </span>
        )}
        <span className="grow" />
        {pagination}
      </div>

      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr className="table__group-row">
              <th colSpan={3} />
              {tree.mainTypes.map((m) => (
                <th key={m.id} colSpan={tree.family(m.id).length} className="col-group">
                  {m.label}
                  {m.future && <span className="badge badge--future">future</span>}
                </th>
              ))}
              <th colSpan={2} />
            </tr>
            <tr>
              <th className="col-check" />
              <th className="col-dot" />
              <th className="col-item">
                <SortHeader label="item" sortKey="item" sort={sort} onSort={onSort} />
              </th>
              {segments.map((t) => (
                <th key={t.id} className={t.parentId === null ? 'col-group-start' : ''} title={t.label}>
                  <SortHeader label={t.code} sortKey={t.id} sort={sort} onSort={onSort} />
                </th>
              ))}
              <th className="col-group-start">
                <SortHeader label="Total stock" sortKey="totalStock" sort={sort} onSort={onSort} />
              </th>
              <th>
                <SortHeader label="Active segments" sortKey="activeSegments" sort={sort} onSort={onSort} />
              </th>
            </tr>
          </thead>
          <tbody className={list.loading ? 'is-loading' : ''}>
            {rows.map((r) => (
              <tr key={r.item.id} className="is-clickable" onClick={() => navigate(`/items/${encodeURIComponent(r.item.id)}`)}>
                <td className="col-check">
                  <Checkbox checked={selected.has(r.item.id)} onChange={(c) => toggle(r.item, c)} />
                </td>
                <td className="col-dot">{r.warnings.length > 0 && <span className="dot" title="Below threshold" />}</td>
                <td>
                  <ItemIdentity item={r.item} />
                </td>
                {segments.map((t) => (
                  <td key={t.id} className={t.parentId === null ? 'col-group-start' : ''}>
                    <QtyBadge value={r.totals[t.id] ?? 0} warning={r.warnings.includes(t.id)} muted={!r.totals[t.id]} />
                  </td>
                ))}
                <td className="col-group-start">
                  <QtyBadge value={r.totalStock} />
                </td>
                <td>
                  <QtyBadge value={r.activeSegments} tone="success" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {list.loading && !list.data && <Spinner />}
        {list.error && <div className="text-error empty">{list.error.message}</div>}
        {list.data?.total === 0 && <div className="muted empty">No item matches your search</div>}
      </div>

      <div className="list-footer">{pagination}</div>

      {modal === 'add' && (
        <RuleEditorModal
          initial={
            selected.size
              ? { criteria: [{ attribute: 'sku', values: [...selected.values()].map((i) => i.sku) }] }
              : undefined
          }
          onClose={() => setModal(null)}
          onSaved={() => {
            setModal(null);
            setSelected(new Map());
            bump();
          }}
        />
      )}
      {modal === 'applyOnestock' && (
        <ApplyRulesOnestockModal
          itemIds={[...selected.keys()]}
          onClose={() => setModal(null)}
          onDone={() => {
            setModal(null);
            setSelected(new Map());
            bump();
          }}
        />
      )}
      {modal === 'import' && (
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
