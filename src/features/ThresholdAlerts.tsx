import { useStockTypes } from '../components/StockTypes';
import { Spinner } from '../components/ui';
import type { ThresholdAlert } from '../types';

export const ALL_ALERTS = 'all';

/** Stock below threshold counted by a tile: every alert, or the alerts of one segment. */
export function alertCount(alerts: ThresholdAlert[], tile: string): number {
  return alerts.reduce((n, a) => n + a.lines.filter((l) => tile === ALL_ALERTS || l.groupId === tile).length, 0);
}

/** Items of an alert tile: every item below a threshold, or the items below the threshold of one segment. */
export function alertItemIds(alerts: ThresholdAlert[], tile: string): string[] {
  return alerts.filter((a) => tile === ALL_ALERTS || a.lines.some((l) => l.groupId === tile)).map((a) => a.item.id);
}

/**
 * Item allocation: alert counters. Each stock below its threshold (segment × location × purchase order) counts one:
 * "Total" counts them all, then one tile per segment (group stock type). A click filters the item list on the items
 * holding these stocks.
 */
export function ThresholdAlerts({
  alerts,
  loading,
  error,
  limited,
  selected,
  onSelect,
}: {
  alerts: ThresholdAlert[] | undefined;
  loading: boolean;
  error?: Error;
  limited?: number;
  selected?: string;
  onSelect: (tile: string | undefined) => void;
}) {
  const tree = useStockTypes();
  const groups = tree.ordered.filter((t) => t.parentId !== null);
  const count = (tile: string) => (alerts ? alertCount(alerts, tile) : 0);
  const tile = (id: string, label: string, title: string, kind: 'total' | 'segment') => {
    const n = count(id);
    return (
      <button
        type="button"
        key={id}
        className={`alert-counter alert-counter--${kind} ${n ? 'has-alerts' : ''} ${selected === id ? 'is-selected' : ''}`}
        onClick={() => onSelect(selected === id ? undefined : id)}
        title={title}
        aria-pressed={selected === id}
      >
        <span className="alert-counter__label">
          <span className="alert-counter__dot" />
          {label}
        </span>
        <span className="alert-counter__value">{alerts ? n : '–'}</span>
      </button>
    );
  };

  return (
    <section className="alerts">
      <div className="alerts__header">
        <strong>Alerts</strong>
        {(limited || selected) && (
          <span className="muted small">
            {limited ? `First ${limited} items checked` : ''}
            {limited && selected ? ' · ' : ''}
            {selected ? 'click the tile again to show every item' : ''}
          </span>
        )}
        {loading && <Spinner />}
        {error && <span className="text-error small">{error.message}</span>}
      </div>
      <div className="alerts__counters">
        {tile(ALL_ALERTS, 'Total', 'Stocks below their alert threshold', 'total')}
        {groups.map((g) => {
          const main = g.parentId ? tree.byId(g.parentId) : undefined;
          return tile(g.id, g.code, `${main?.label ?? ''} › ${g.label}: stocks below the threshold of this segment`, 'segment');
        })}
      </div>
    </section>
  );
}
