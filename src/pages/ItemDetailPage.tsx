import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { useDataVersion } from '../components/DataVersion';
import { ArrowBackIcon, DownloadIcon, WarningIcon } from '../components/Icons';
import { ItemIdentity, Pagination, QtyBadge, SortHeader, Spinner } from '../components/ui';
import { SEGMENTS } from '../config/segments';
import { RuleEditorModal } from '../features/RuleEditorModal';
import { EditSegmentationModal } from '../features/EditSegmentationModal';
import { FileImportModal } from '../features/FileImportModal';
import type { LocationRow, SegmentId, Sort } from '../types';
import { isActive } from '../utils/allocation';
import { formatPeriod, todayIso } from '../utils/format';
import { useAsync } from '../utils/useAsync';

type RowSortKey = 'location' | SegmentId | 'nonAllocated' | 'totalStock' | 'period';

function rowValue(r: LocationRow, key: RowSortKey): string | number {
  switch (key) {
    case 'location':
      return r.location.name.toLowerCase();
    case 'nonAllocated':
      return r.nonAllocated;
    case 'totalStock':
      return r.allocation.totalStock;
    case 'period':
      return r.allocation.period.type === 'always' ? '' : r.allocation.period.start;
    default:
      return r.allocation.segments[key].quantity;
  }
}

export function ItemDetailPage() {
  const { itemId = '' } = useParams();
  const { version, bump } = useDataVersion();
  const detail = useAsync(() => api.getItemDetail(itemId), [itemId, version]);
  const [sort, setSort] = useState<Sort<RowSortKey>>();
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [editing, setEditing] = useState<LocationRow | null>(null);
  const [modal, setModal] = useState<'add' | 'import' | null>(null);
  const today = todayIso();
  const navigate = useNavigate();
  // Go back to the list keeping its filters, or to the list when opened directly.
  const goBack = () => ((window.history.state?.idx ?? 0) > 0 ? navigate(-1) : navigate('/items'));

  const rows = useMemo(() => {
    const list = detail.data?.rows ?? [];
    if (!sort) return list;
    const dir = sort.direction === 'asc' ? 1 : -1;
    return [...list].sort((a, b) => {
      const va = rowValue(a, sort.key);
      const vb = rowValue(b, sort.key);
      return va < vb ? -dir : va > vb ? dir : 0;
    });
  }, [detail.data, sort]);

  const onSort = (key: RowSortKey) =>
    setSort((s) => (s?.key !== key ? { key, direction: 'asc' } : s.direction === 'asc' ? { key, direction: 'desc' } : undefined));

  if (detail.error)
    return (
      <div className="card page">
        <Link to="/items" className="btn btn--secondary">
          <ArrowBackIcon /> Back
        </Link>
        <p className="text-error">{detail.error.message}</p>
      </div>
    );
  if (!detail.data) return <Spinner />;

  const { summary, effectiveRules: effective } = detail.data;
  const item = summary.item;
  const pageRows = rows.slice(page * pageSize, (page + 1) * pageSize);
  const pagination = (
    <Pagination
      page={page}
      pageSize={pageSize}
      total={rows.length}
      onPage={setPage}
      onPageSize={(s) => {
        setPageSize(s);
        setPage(0);
      }}
    />
  );

  const kpis: Array<{ label: string; value: number; warning?: boolean }> = [
    ...SEGMENTS.map((s) => ({ label: `Total ${s.label}`, value: summary.totals[s.id], warning: summary.warnings.includes(s.id) })),
    { label: 'Total Non allocated', value: summary.nonAllocated },
    { label: 'Total Stock', value: summary.totalStock },
  ];

  return (
    <div className="detail">
      <div className="card detail-header">
        <button type="button" className="btn btn--secondary" onClick={goBack}>
          <ArrowBackIcon /> Back
        </button>
        <ItemIdentity item={item} detailed />
        <span className="grow" />
        <button type="button" className="btn btn--primary" onClick={() => setModal('add')}>
          Create a rule for this item
        </button>
        <button type="button" className="btn btn--secondary" onClick={() => setModal('import')}>
          <DownloadIcon /> File import
        </button>
      </div>

      <div className="kpis">
        {kpis.map((k) => (
          <div className="card kpi" key={k.label}>
            <div className="kpi__label">{k.label}</div>
            <div className="kpi__value">
              {k.value}
              {k.warning && (
                <span className="badge badge--warning">
                  <WarningIcon width={12} height={12} /> Warning
                </span>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="card page">
        <div className="list-header">
          <span className="grow" />
          {pagination}
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>
                  <SortHeader label="Stock location" sortKey="location" sort={sort} onSort={onSort} />
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
                  <SortHeader label="Activation period" sortKey="period" sort={sort} onSort={onSort} />
                </th>
                <th>Source</th>
                <th>Rule at next stock import</th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map((r) => {
                const active = isActive(r.allocation, today);
                return (
                  <tr key={r.location.id} className="is-clickable" onClick={() => setEditing(r)} title="Edit segmentation">
                    <td>
                      <div>{r.location.name}</div>
                      <div className="muted">{r.location.code}</div>
                    </td>
                    {SEGMENTS.map((s) => (
                      <td key={s.id}>
                        <QtyBadge value={r.allocation.segments[s.id].quantity} warning={r.warnings.includes(s.id)} />
                      </td>
                    ))}
                    <td>{r.nonAllocated}</td>
                    <td>{r.allocation.totalStock}</td>
                    <td>
                      <span className={`badge ${active ? 'badge--success' : 'badge--muted'}`} title={active ? 'Active' : 'Inactive today'}>
                        {formatPeriod(r.allocation.period)}
                      </span>
                    </td>
                    <td>
                      {r.allocation.source.type === 'rule' ? (
                        <span className="badge badge--rule">Rule: {r.rule?.name ?? 'deleted'}</span>
                      ) : r.allocation.source.type === 'manual' ? (
                        <span className="badge">Manual</span>
                      ) : (
                        <span className="badge badge--muted">No rule</span>
                      )}
                    </td>
                    <td onClick={(e) => e.stopPropagation()}>
                      {effective[r.location.id] ? (
                        <Link to={`/?q=${encodeURIComponent(item.sku)}`} className="link">
                          {effective[r.location.id]!.name}
                        </Link>
                      ) : (
                        <span className="muted">None</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {rows.length === 0 && <div className="muted empty">No stock for this item</div>}
        </div>
        <div className="list-footer">{pagination}</div>
      </div>

      {editing && (
        <EditSegmentationModal
          item={item}
          location={editing.location}
          allocation={editing.allocation}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            bump();
          }}
        />
      )}
      {modal === 'add' && (
        <RuleEditorModal
          initial={{ name: item.name, criteria: [{ attribute: 'sku', values: [item.sku] }] }}
          onClose={() => setModal(null)}
          onSaved={() => {
            setModal(null);
            bump();
          }}
        />
      )}
      {modal === 'import' && (
        <FileImportModal
          sample={detail.data.rows.map((r) => ({ sku: item.sku, locationCode: r.location.code }))}
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
