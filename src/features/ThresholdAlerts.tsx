import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useDataVersion } from '../components/DataVersion';
import { WarningIcon } from '../components/Icons';
import { useStockTypes } from '../components/StockTypes';
import { ItemThumb, Spinner } from '../components/ui';
import type { ThresholdAlert } from '../types';
import { plural } from '../utils/format';
import { useAsync } from '../utils/useAsync';

const COLLAPSED_KEY = 'stock-allocation:alerts-collapsed';
const FIRST_TILES = 8;
const LINES_PER_TILE = 3;

const readCollapsed = () => {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === '1';
  } catch {
    return false;
  }
};

/** Item allocation: one tile per item having a segment below its alert threshold, most missing first. */
export function ThresholdAlerts() {
  const navigate = useNavigate();
  const tree = useStockTypes();
  const { version } = useDataVersion();
  const data = useAsync(() => api.getThresholdAlerts(), [version]);
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [segment, setSegment] = useState<string>();
  const [showAll, setShowAll] = useState(false);

  const alerts = useMemo(() => {
    const all = data.data?.alerts ?? [];
    if (!segment) return all;
    return all.map((a) => ({ ...a, lines: a.lines.filter((l) => l.groupId === segment) })).filter((a) => a.lines.length);
  }, [data.data, segment]);
  const segments = useMemo(() => {
    const count = new Map<string, number>();
    (data.data?.alerts ?? []).forEach((a) => new Set(a.lines.map((l) => l.groupId)).forEach((g) => count.set(g, (count.get(g) ?? 0) + 1)));
    return tree.ordered.filter((t) => count.has(t.id)).map((t) => ({ id: t.id, code: t.code, items: count.get(t.id)! }));
  }, [data.data, tree]);

  const toggle = () =>
    setCollapsed((v) => {
      try {
        localStorage.setItem(COLLAPSED_KEY, v ? '0' : '1');
      } catch {
        /* ignore */
      }
      return !v;
    });

  if (data.loading && !data.data)
    return (
      <div className="alerts alerts--loading">
        <Spinner /> <span className="muted small">Checking the alert thresholds…</span>
      </div>
    );
  if (data.error) return <div className="alerts muted small">Threshold alerts unavailable: {data.error.message}</div>;
  const total = data.data?.alerts.length ?? 0;
  if (!total) return null;
  const lineCount = (data.data?.alerts ?? []).reduce((s, a) => s + a.lines.length, 0);
  const shown = showAll ? alerts : alerts.slice(0, FIRST_TILES);

  return (
    <section className="alerts">
      <div className="alerts__header">
        <button type="button" className="alerts__title" onClick={toggle} aria-expanded={!collapsed}>
          <WarningIcon width={16} height={16} />
          <strong>Below threshold</strong>
          <span className="muted">
            {plural(total, 'item')} · {plural(lineCount, 'segment')}
            {data.data?.limited && ` (first ${data.data.checkedItems} items checked)`}
          </span>
          <span className="alerts__chevron">{collapsed ? '▸' : '▾'}</span>
        </button>
        {!collapsed && segments.length > 1 && (
          <div className="alerts__filters">
            <button type="button" className={`chip ${!segment ? 'chip--selected' : ''}`} onClick={() => setSegment(undefined)}>
              All
            </button>
            {segments.map((s) => (
              <button
                type="button"
                key={s.id}
                className={`chip ${segment === s.id ? 'chip--selected' : ''}`}
                onClick={() => setSegment(segment === s.id ? undefined : s.id)}
              >
                {s.code} <span className="muted">{s.items}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {!collapsed && (
        <>
          <div className="alerts__grid">
            {shown.map((a) => (
              <AlertTile key={a.item.id} alert={a} onOpen={() => navigate(`/items/${encodeURIComponent(a.item.id)}`)} />
            ))}
          </div>
          {alerts.length > FIRST_TILES && (
            <button type="button" className="link small" onClick={() => setShowAll((v) => !v)}>
              {showAll ? 'Show less' : `Show all ${plural(alerts.length, 'item')}`}
            </button>
          )}
        </>
      )}
    </section>
  );
}

function AlertTile({ alert, onOpen }: { alert: ThresholdAlert; onOpen: () => void }) {
  const tree = useStockTypes();
  const empty = alert.lines.some((l) => l.quantity === 0);
  return (
    <button type="button" className={`alert-tile ${empty ? 'is-empty' : ''}`} onClick={onOpen} title="Open the item allocation">
      <div className="alert-tile__head">
        <ItemThumb item={alert.item} size={36} />
        <div className="alert-tile__name">
          <div className="alert-tile__title">{alert.item.name}</div>
          <div className="muted small alert-tile__sku">{alert.item.sku}</div>
        </div>
        <span className="alert-tile__count">{alert.lines.length}</span>
      </div>
      <ul className="alert-tile__lines">
        {alert.lines.slice(0, LINES_PER_TILE).map((l, i) => {
          const pct = l.threshold ? Math.min(100, (l.quantity / l.threshold) * 100) : 0;
          return (
            <li key={i}>
              <div className="alert-tile__line">
                <span className="alert-tile__where">
                  <code>{tree.code(l.groupId)}</code> {l.location.name}
                  {l.purchaseOrder && <span className="muted"> · {l.purchaseOrder}</span>}
                </span>
                <span className={`alert-tile__qty ${l.quantity === 0 ? 'is-empty' : ''}`}>
                  {l.quantity} <span className="muted">/ {l.threshold}</span>
                </span>
              </div>
              <div className="alert-tile__bar">
                <span style={{ width: `${pct}%` }} className={l.quantity === 0 ? 'is-empty' : ''} />
              </div>
            </li>
          );
        })}
      </ul>
      {alert.lines.length > LINES_PER_TILE && <div className="muted small">+ {plural(alert.lines.length - LINES_PER_TILE, 'other segment')}</div>}
    </button>
  );
}
