import { useStockTypes } from '../components/StockTypes';
import { Spinner } from '../components/ui';
import type { ThresholdAlert } from '../types';

export const ALL_ALERTS = 'all';

/** Items of an alert tile: every item below a threshold, or the items below the threshold of one segment. */
export function alertItemIds(alerts: ThresholdAlert[], tile: string): string[] {
  return alerts.filter((a) => tile === ALL_ALERTS || a.lines.some((l) => l.groupId === tile)).map((a) => a.item.id);
}

/**
 * Item allocation: alert counters. "Total" = items with at least one segment below its threshold, then one tile per
 * segment (group stock type) with the number of items below its threshold. A click filters the item list.
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
  const count = (tile: string) => (alerts ? alertItemIds(alerts, tile).length : 0);
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
        <span className="muted small">
          Items with stock below the alert threshold
          {limited ? ` (first ${limited} items checked)` : ''}
          {selected ? ' · click the tile again to show every item' : ''}
        </span>
        {loading && <Spinner />}
        {error && <span className="text-error small">{error.message}</span>}
      </div>
      <div className="alerts__counters">
        {tile(ALL_ALERTS, 'Total', 'Items with at least one segment below its threshold', 'total')}
        {groups.map((g) => {
          const main = g.parentId ? tree.byId(g.parentId) : undefined;
          return tile(g.id, g.code, `${main?.label ?? ''} › ${g.label}: items below the threshold of this segment`, 'segment');
        })}
      </div>
    </section>
  );
}
