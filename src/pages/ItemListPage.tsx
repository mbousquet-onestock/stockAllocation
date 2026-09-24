import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { useDataVersion } from '../components/DataVersion';
import { DownloadIcon, WarningIcon } from '../components/Icons';
import { Checkbox, ItemIdentity, Pagination, QtyBadge, SortHeader, Spinner } from '../components/ui';
import { SEGMENTS, segmentLabel } from '../config/segments';
import { AddSegmentationModal } from '../features/AddSegmentationModal';
import { FileImportModal } from '../features/FileImportModal';
import type { Item, ItemSortKey, SegmentId, Sort } from '../types';
import { plural } from '../utils/format';
import { useAsync, useDebounced } from '../utils/useAsync';

export function ItemListPage() {
  const navigate = useNavigate();
  const { version, bump } = useDataVersion();
  const [params, setParams] = useSearchParams();
  const search = params.get('q') ?? '';
  const page = Number(params.get('page') ?? 0);
  const pageSize = Number(params.get('size') ?? 25);
  const warningSegment = (params.get('warning') as SegmentId | null) ?? undefined;
  const sortParam = params.get('sort');
  const sort: Sort<ItemSortKey> | undefined = sortParam
    ? { key: sortParam.replace(/^-/, '') as ItemSortKey, direction: sortParam.startsWith('-') ? 'desc' : 'asc' }
    : undefined;

  const [searchInput, setSearchInput] = useState(search);
  const debouncedSearch = useDebounced(searchInput);
  const [selected, setSelected] = useState<Map<string, Item>>(new Map());
  const [modal, setModal] = useState<'add' | 'import' | null>(null);

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
    () => api.listItems({ search, page, pageSize, sort, warningSegment }),
    [search, page, pageSize, sortParam, warningSegment, version],
  );
  const warnings = useAsync(() => api.getWarningSummary(), [version]);

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
        <input className="input grow" placeholder="Search" value={searchInput} onChange={(e) => setSearchInput(e.target.value)} />
        <button type="button" className="btn btn--primary" onClick={() => setModal('add')}>
          {selected.size ? `Add segmentation to ${plural(selected.size, 'item')}` : 'Add item segmentation'}
        </button>
        <button type="button" className="btn btn--secondary" onClick={() => setModal('import')}>
          <DownloadIcon /> File import
        </button>
      </div>

      {(warnings.data?.length ?? 0) > 0 && (
        <div className="chips">
          {warnings.data!.map((w) => (
            <button
              type="button"
              key={w.segment}
              className={`chip chip--warning ${warningSegment === w.segment ? 'is-active' : ''}`}
              onClick={() => update({ warning: warningSegment === w.segment ? undefined : w.segment, page: undefined })}
            >
              <WarningIcon width={12} height={12} />
              {plural(w.itemCount, 'item')} - Below threshold – {segmentLabel(w.segment)}
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
        <span className="grow" />
        {pagination}
      </div>

      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th className="col-check" />
              <th className="col-dot" />
              <th>
                <SortHeader label="item" sortKey="item" sort={sort} onSort={onSort} />
              </th>
              {SEGMENTS.map((s) => (
                <th key={s.id}>
                  <SortHeader label={s.label} sortKey={s.id} sort={sort} onSort={onSort} />
                </th>
              ))}
              <th>
                <SortHeader label="Non allocated" sortKey="nonAllocated" sort={sort} onSort={onSort} />
              </th>
              <th>
                <SortHeader label="Total stock" sortKey="totalStock" sort={sort} onSort={onSort} />
              </th>
              <th>
                <SortHeader label="Active segments" sortKey="activeSegments" sort={sort} onSort={onSort} />
              </th>
            </tr>
          </thead>
          <tbody className={list.loading ? 'is-loading' : ''}>
            {rows.map((r) => (
              <tr key={r.item.id} className="is-clickable" onClick={() => navigate(`/items/${r.item.id}`)}>
                <td className="col-check">
                  <Checkbox checked={selected.has(r.item.id)} onChange={(c) => toggle(r.item, c)} />
                </td>
                <td className="col-dot">{r.warnings.length > 0 && <span className="dot" title="Below threshold" />}</td>
                <td>
                  <ItemIdentity item={r.item} />
                </td>
                {SEGMENTS.map((s) => (
                  <td key={s.id}>
                    <QtyBadge value={r.totals[s.id]} warning={r.warnings.includes(s.id)} />
                  </td>
                ))}
                <td>
                  <QtyBadge value={r.nonAllocated} />
                </td>
                <td>
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
        <AddSegmentationModal
          initialItems={[...selected.values()]}
          onClose={() => setModal(null)}
          onApplied={() => {
            setModal(null);
            setSelected(new Map());
            bump();
          }}
        />
      )}
      {modal === 'import' && (
        <FileImportModal
          sample={[...selected.values()].map((i) => ({ sku: i.sku, locationCode: '0001' }))}
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
