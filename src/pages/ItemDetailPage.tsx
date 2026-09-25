import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { useDataVersion } from '../components/DataVersion';
import { ArrowBackIcon, WarningIcon } from '../components/Icons';
import { useStockTypes } from '../components/StockTypes';
import { ItemIdentity, Pagination, SortHeader, Spinner } from '../components/ui';
import { ApplyRulesOnestockModal } from '../features/ApplyRulesOnestockModal';
import { EditStockLineModal } from '../features/EditStockLineModal';
import { RuleEditorModal } from '../features/RuleEditorModal';
import { SplitBar } from '../features/SplitBar';
import { StockLineSearch, type LineFilterOption } from '../features/StockLineSearch';
import type { Sort, StockLineRow } from '../types';
import { familyTotal, isActive } from '../utils/allocation';
import { formatPeriod, todayIso } from '../utils/format';

const NO_PO = '__none__';

/** Suffix of a group code after its main type code: on_hand_A → "A". */
const groupSuffix = (groupCode: string, mainCode: string) =>
  groupCode.toLowerCase().startsWith(mainCode.toLowerCase()) ? groupCode.slice(mainCode.length).replace(/^[_-]/, '') || groupCode : groupCode;

/** ETA of future stock (unix seconds) → dd/mm/yyyy, or a range. */
function formatEta(eta: { start: number; end: number }) {
  const d = (t: number) => new Date(t * 1000).toLocaleDateString('fr-FR');
  return eta.start === eta.end || d(eta.start) === d(eta.end) ? d(eta.start) : `${d(eta.start)} → ${d(eta.end)}`;
}
import { useAsync } from '../utils/useAsync';

type RowSortKey = 'location' | 'type' | 'po' | 'quantity' | 'remaining' | 'period';

export function ItemDetailPage() {
  const { itemId = '' } = useParams();
  const { version, bump } = useDataVersion();
  const tree = useStockTypes();
  const detail = useAsync(() => api.getItemDetail(itemId), [itemId, version]);
  const [typeFilter, setTypeFilter] = useState<string>('');
  /** Search of the stock lines: free text + exact filters (purchase order, stock location, without PO). */
  const [lineText, setLineText] = useState('');
  const [lineFilters, setLineFilters] = useState<LineFilterOption[]>([]);
  const poFilter = lineFilters.find((f) => f.kind === 'po' || f.kind === 'no-po');
  const setPoFilter = (po: string) =>
    setLineFilters((fs) => [...fs.filter((f) => f.kind === 'location'), ...(po ? [{ kind: 'po' as const, value: po, label: po }] : [])]);
  const [sort, setSort] = useState<Sort<RowSortKey>>();
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [editing, setEditing] = useState<StockLineRow | null>(null);
  const [creatingRule, setCreatingRule] = useState(false);
  const [applying, setApplying] = useState(false);
  const today = todayIso();
  const navigate = useNavigate();
  // Go back to the list keeping its filters, or to the list when opened directly.
  const goBack = () => ((window.history.state?.idx ?? 0) > 0 ? navigate(-1) : navigate('/items'));

  const lineQuery = lineText.trim().toLowerCase();
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
    const list = (detail.data?.rows ?? []).filter(
      (r) =>
        (!typeFilter || r.line.stockTypeId === typeFilter) &&
        lineFilters.every((f) =>
          f.kind === 'no-po' ? !r.line.purchaseOrder : f.kind === 'po' ? r.line.purchaseOrder === f.value : r.line.locationId === f.value,
        ) &&
        (!lineQuery ||
          [r.line.purchaseOrder ?? '', r.location.name, r.location.code, tree.label(r.line.stockTypeId), tree.code(r.line.stockTypeId)]
            .join(' ')
            .toLowerCase()
            .includes(lineQuery)),
    );
    const s = sort ?? { key: 'type' as const, direction: 'asc' as const };
    const dir = s.direction === 'asc' ? 1 : -1;
    return [...list].sort((a, b) => {
      const va = rowValue(a, s.key);
      const vb = rowValue(b, s.key);
      if (va !== vb) return va < vb ? -dir : dir;
      return a.location.name.localeCompare(b.location.name);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail.data, sort, typeFilter, lineFilters, lineQuery, typePosition]);

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

  const { summary, onestock, notices = [] } = detail.data;
  const hasEta = detail.data.rows.some((r) => r.line.eta);
  // Purchase orders of the item (in the current stock type filter), with their total quantity and ETA.
  const purchaseOrders = [
    ...detail.data.rows
      .filter((r) => r.line.purchaseOrder && (!typeFilter || r.line.stockTypeId === typeFilter))
      .reduce((m, r) => {
        const po = r.line.purchaseOrder!;
        const cur = m.get(po) ?? { value: po, quantity: 0, eta: r.line.eta ? formatEta(r.line.eta) : undefined };
        cur.quantity += r.line.quantity;
        return m.set(po, cur);
      }, new Map<string, { value: string; quantity: number; eta?: string }>())
      .values(),
  ].sort((a, b) => a.value.localeCompare(b.value));
  const lineOptions: LineFilterOption[] = [
    ...purchaseOrders.map((po) => ({
      kind: 'po' as const,
      value: po.value,
      label: po.value,
      detail: `${po.quantity} pcs${po.eta ? ` · ETA ${po.eta}` : ''}`,
    })),
    ...(purchaseOrders.length ? [{ kind: 'no-po' as const, value: NO_PO, label: 'Without purchase order' }] : []),
    ...[...new Map(detail.data.rows.map((r) => [r.location.id, r.location])).values()].map((l) => ({
      kind: 'location' as const,
      value: l.id,
      label: l.name,
      detail: l.code !== l.name ? l.code : undefined,
    })),
  ];
  // One column per group suffix (A, B…), shared by every stock type of the lines.
  const suffixes = [
    ...new Set(
      rows.flatMap((r) => {
        const t = tree.byId(r.line.stockTypeId);
        return tree.groupsOf(r.line.stockTypeId).map((g) => groupSuffix(g.code, t?.code ?? ''));
      }),
    ),
  ].sort();
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
        {detail.data.onestock && (
          <button type="button" className="btn btn--secondary" onClick={() => setApplying(true)}>
            Apply rules → OneStock
          </button>
        )}
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
                setLineFilters((fs) => fs.filter((f) => f.kind === 'location'));
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
          {onestock && <span className="badge badge--rule">Stock from OneStock · changes are sent with stock_import</span>}
          <StockLineSearch
            text={lineText}
            onText={(t) => {
              setLineText(t);
              setPage(0);
            }}
            filters={lineFilters}
            onFilters={(f) => {
              setLineFilters(f);
              setPage(0);
            }}
            options={lineOptions}
          />
          {typeFilter && (
            <button type="button" className="chip chip--selected" onClick={() => setTypeFilter('')}>
              {tree.label(typeFilter)} ×
            </button>
          )}
          <span className="grow" />
          {pagination}
        </div>
        {notices.map((n) => (
          <div key={n} className="notice text-warning small">
            {n}
          </div>
        ))}
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
                {suffixes.map((sfx) => (
                  <th key={sfx} className="col-num col-group-cell" title={`Quantity on the group ${sfx} of the stock type`}>
                    Group {sfx}
                  </th>
                ))}
                <th className="col-num" title="Quantity left on the main stock type">
                  <SortHeader label="Not split" sortKey="remaining" sort={sort} onSort={onSort} />
                </th>
                <th className="col-split">Split</th>
                <th>
                  <SortHeader label="Activation period" sortKey="period" sort={sort} onSort={onSort} />
                </th>
                {hasEta && <th>ETA</th>}
                {!onestock && <th>Source</th>}
                <th>Rule at next update</th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map((r) => {
                const type = tree.byId(r.line.stockTypeId);
                const groups = tree.groupsOf(r.line.stockTypeId);
                const active = isActive(r.line.period, today);
                return (
                  <tr
                    key={r.line.id}
                    className="is-clickable"
                    onClick={() => setEditing(r)}
                    title={onestock ? 'Edit segmentation (sent to OneStock)' : 'Edit segmentation'}
                  >
                    <td>
                      <div>{r.location.name}</div>
                      <div className="muted">{r.location.code}</div>
                    </td>
                    <td>
                      <div>{type?.label ?? r.line.stockTypeId}</div>
                      <code className="small">{type?.code}</code>
                    </td>
                    <td>
                      {r.line.purchaseOrder ? (
                        <button
                          type="button"
                          className="chip chip--po chip--clickable"
                          title="Filter on this purchase order"
                          onClick={(e) => {
                            e.stopPropagation();
                            setPoFilter(poFilter?.value === r.line.purchaseOrder ? '' : r.line.purchaseOrder!);
                            setPage(0);
                          }}
                        >
                          {r.line.purchaseOrder}
                        </button>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td className="col-num">
                      <strong>{r.line.quantity}</strong>
                    </td>
                    {suffixes.map((sfx) => {
                      const g = groups.find((x) => groupSuffix(x.code, type?.code ?? '') === sfx);
                      if (!g) return <td key={sfx} className="col-num col-group-cell muted">—</td>;
                      const q = r.line.split[g.id]?.quantity ?? 0;
                      const warn = r.warnings.includes(g.id);
                      return (
                        <td key={sfx} className="col-num col-group-cell" title={`${g.code}${warn ? ' — below threshold' : ''}`}>
                          <span className={`qty ${warn ? 'qty--warning' : q ? '' : 'qty--zero'}`}>
                            {warn && <WarningIcon width={12} height={12} />}
                            {q}
                          </span>
                        </td>
                      );
                    })}
                    <td className="col-num">
                      <span className={r.remaining ? '' : 'qty--zero'}>{r.remaining}</span>
                    </td>
                    <td className="col-split">
                      {groups.length > 0 && r.line.quantity > 0 && type ? (
                        <>
                          <SplitBar main={type} groups={groups} quantities={Object.fromEntries(groups.map((g) => [g.id, r.line.split[g.id]?.quantity ?? 0]))} total={r.line.quantity} mini />
                          <div className="split-pct">
                            {groups.map((g) => (
                              <span key={g.id}>
                                {groupSuffix(g.code, type.code)} {Math.round(((r.line.split[g.id]?.quantity ?? 0) / r.line.quantity) * 100)}%
                              </span>
                            ))}
                          </div>
                        </>
                      ) : (
                        <span className="muted small">{groups.length ? '—' : 'No group'}</span>
                      )}
                    </td>
                    <td>
                      <span className={`badge ${active ? 'badge--success' : 'badge--muted'}`} title={active ? 'Active' : 'Inactive today'}>
                        {formatPeriod(r.line.period)}
                      </span>
                    </td>
                    {hasEta && <td className="small">{r.line.eta ? formatEta(r.line.eta) : <span className="muted">—</span>}</td>}
                    {!onestock && (
                      <td>
                        {r.line.source.type === 'rule' ? (
                          <span className="badge badge--rule">Rule: {r.rule?.name ?? 'deleted'}</span>
                        ) : r.line.source.type === 'manual' ? (
                          <span className="badge">Manual</span>
                        ) : (
                          <span className="badge badge--muted">No rule</span>
                        )}
                      </td>
                    )}
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
      {applying && (
        <ApplyRulesOnestockModal
          itemIds={[item.id]}
          onClose={() => setApplying(false)}
          onDone={() => {
            setApplying(false);
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
