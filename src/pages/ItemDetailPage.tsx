import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { useDataVersion } from '../components/DataVersion';
import { ArrowBackIcon, WarningIcon } from '../components/Icons';
import { useStockTypes } from '../components/StockTypes';
import { ItemIdentity, Pagination, QtyBadge, SortHeader, Spinner } from '../components/ui';
import { EditStockLineModal } from '../features/EditStockLineModal';
import { RuleEditorModal } from '../features/RuleEditorModal';
import { SplitBar } from '../features/SplitBar';
import type { Sort, StockLineRow } from '../types';
import { familyTotal, isActive } from '../utils/allocation';
import { formatPeriod, todayIso } from '../utils/format';
import { useAsync } from '../utils/useAsync';

type RowSortKey = 'location' | 'type' | 'po' | 'quantity' | 'remaining' | 'period';

export function ItemDetailPage() {
  const { itemId = '' } = useParams();
  const { version, bump } = useDataVersion();
  const tree = useStockTypes();
  const detail = useAsync(() => api.getItemDetail(itemId), [itemId, version]);
  const [typeFilter, setTypeFilter] = useState<string>('');
  const [sort, setSort] = useState<Sort<RowSortKey>>();
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [editing, setEditing] = useState<StockLineRow | null>(null);
  const [creatingRule, setCreatingRule] = useState(false);
  const today = todayIso();
  const navigate = useNavigate();
  // Go back to the list keeping its filters, or to the list when opened directly.
  const goBack = () => ((window.history.state?.idx ?? 0) > 0 ? navigate(-1) : navigate('/items'));

  const typePosition = useMemo(() => new Map(tree.ordered.map((t, i) => [t.id, i])), [tree]);
  const rowValue = (r: StockLineRow, key: RowSortKey): string | number => {
    switch (key) {
      case 'location':
        return r.location.name.toLowerCase();
      case 'type':
        return typePosition.get(r.line.stockTypeId) ?? 0;
      case 'po':
        return r.line.purchaseOrder ?? '';
      case 'quantity':
        return r.line.quantity;
      case 'remaining':
        return r.remaining;
      case 'period':
        return r.line.period.type === 'always' ? '' : r.line.period.start;
    }
  };

  const rows = useMemo(() => {
    const list = (detail.data?.rows ?? []).filter((r) => !typeFilter || r.line.stockTypeId === typeFilter);
    const s = sort ?? { key: 'type' as const, direction: 'asc' as const };
    const dir = s.direction === 'asc' ? 1 : -1;
    return [...list].sort((a, b) => {
      const va = rowValue(a, s.key);
      const vb = rowValue(b, s.key);
      if (va !== vb) return va < vb ? -dir : dir;
      return a.location.name.localeCompare(b.location.name);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail.data, sort, typeFilter, typePosition]);

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

  const { summary } = detail.data;
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

  return (
    <div className="detail">
      <div className="card detail-header">
        <button type="button" className="btn btn--secondary" onClick={goBack}>
          <ArrowBackIcon /> Back
        </button>
        <ItemIdentity item={item} detailed />
        <span className="grow" />
        <button type="button" className="btn btn--primary" onClick={() => setCreatingRule(true)}>
          Create a rule for this item
        </button>
      </div>

      <div className="kpis">
        {tree.mainTypes.map((m) => {
          const family = tree.family(m.id);
          const groups = tree.groupsOf(m.id);
          const total = familyTotal(summary.totals, tree, m.id);
          return (
            <button
              type="button"
              className={`card kpi kpi--button ${typeFilter === m.id ? 'is-active' : ''}`}
              key={m.id}
              onClick={() => {
                setTypeFilter(typeFilter === m.id ? '' : m.id);
                setPage(0);
              }}
              title="Filter the stock lines on this type"
            >
              <div className="kpi__label">
                Total {m.label}
                {m.future && <span className="badge badge--future">future</span>}
              </div>
              <div className="kpi__value">
                {total}
                {family.some((t) => summary.warnings.includes(t.id)) && (
                  <span className="badge badge--warning">
                    <WarningIcon width={12} height={12} /> Warning
                  </span>
                )}
              </div>
              {total > 0 && <SplitBar main={m} groups={groups} quantities={summary.totals} total={total} mini />}
              <div className="kpi__breakdown">
                {family.map((t) => (
                  <span key={t.id} className={summary.warnings.includes(t.id) ? 'text-warning' : ''}>
                    {t.code} <strong>{summary.totals[t.id] ?? 0}</strong>
                  </span>
                ))}
              </div>
            </button>
          );
        })}
        <div className="card kpi">
          <div className="kpi__label">Total Stock</div>
          <div className="kpi__value">{summary.totalStock}</div>
        </div>
      </div>

      <div className="card page">
        <div className="list-header">
          <strong>Stock lines</strong>
          {typeFilter && (
            <button type="button" className="chip chip--selected" onClick={() => setTypeFilter('')}>
              {tree.label(typeFilter)} ×
            </button>
          )}
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
                <th>
                  <SortHeader label="Stock type" sortKey="type" sort={sort} onSort={onSort} />
                </th>
                <th>
                  <SortHeader label="Purchase order" sortKey="po" sort={sort} onSort={onSort} />
                </th>
                <th>
                  <SortHeader label="Quantity" sortKey="quantity" sort={sort} onSort={onSort} />
                </th>
                <th>Split onto groups</th>
                <th>
                  <SortHeader label="Stays on type" sortKey="remaining" sort={sort} onSort={onSort} />
                </th>
                <th>
                  <SortHeader label="Activation period" sortKey="period" sort={sort} onSort={onSort} />
                </th>
                <th>Source</th>
                <th>Rule at next update</th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map((r) => {
                const type = tree.byId(r.line.stockTypeId);
                const groups = tree.groupsOf(r.line.stockTypeId);
                const active = isActive(r.line.period, today);
                return (
                  <tr key={r.line.id} className="is-clickable" onClick={() => setEditing(r)} title="Edit segmentation">
                    <td>
                      <div>{r.location.name}</div>
                      <div className="muted">{r.location.code}</div>
                    </td>
                    <td>
                      <div>{type?.label ?? r.line.stockTypeId}</div>
                      <code className="small">{type?.code}</code>
                    </td>
                    <td>{r.line.purchaseOrder ? <span className="chip chip--po">{r.line.purchaseOrder}</span> : <span className="muted">—</span>}</td>
                    <td>{r.line.quantity}</td>
                    <td>
                      <div className="split-cell">
                        {groups.length === 0 && <span className="muted small">No group</span>}
                        {groups.map((g) => (
                          <span key={g.id} className="split-cell__item">
                            <span className="muted small">{g.code}</span>
                            <QtyBadge value={r.line.split[g.id]?.quantity ?? 0} warning={r.warnings.includes(g.id)} />
                          </span>
                        ))}
                      </div>
                    </td>
                    <td>{r.remaining}</td>
                    <td>
                      <span className={`badge ${active ? 'badge--success' : 'badge--muted'}`} title={active ? 'Active' : 'Inactive today'}>
                        {formatPeriod(r.line.period)}
                      </span>
                    </td>
                    <td>
                      {r.line.source.type === 'rule' ? (
                        <span className="badge badge--rule">Rule: {r.rule?.name ?? 'deleted'}</span>
                      ) : r.line.source.type === 'manual' ? (
                        <span className="badge">Manual</span>
                      ) : (
                        <span className="badge badge--muted">No rule</span>
                      )}
                    </td>
                    <td onClick={(e) => e.stopPropagation()}>
                      {r.nextRule ? (
                        <Link to={`/?q=${encodeURIComponent(item.sku)}`} className="link">
                          {r.nextRule.name}
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
        <EditStockLineModal
          item={item}
          location={editing.location}
          line={editing.line}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            bump();
          }}
        />
      )}
      {creatingRule && (
        <RuleEditorModal
          initial={{ name: item.name, criteria: [{ attribute: 'sku', values: [item.sku] }] }}
          onClose={() => setCreatingRule(false)}
          onSaved={() => {
            setCreatingRule(false);
            bump();
          }}
        />
      )}
    </div>
  );
}
