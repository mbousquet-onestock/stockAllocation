import type { StockType } from '../types';

/** Horizontal bar: quantities of each group, then the rest left on the main stock type. */
export function SplitBar({
  main,
  groups,
  quantities,
  total,
  labels,
  mini,
}: {
  main: StockType;
  groups: StockType[];
  quantities: Record<string, number>;
  total: number;
  labels?: boolean;
  mini?: boolean;
}) {
  const rest = total - groups.reduce((s, g) => s + (quantities[g.id] ?? 0), 0);
  return (
    <div className={`stack-bar ${mini ? 'stack-bar--mini' : ''}`}>
      {groups.map((g, i) =>
        (quantities[g.id] ?? 0) > 0 ? (
          <span key={g.id} className={`stack-bar__part seg-${i % 4}`} style={{ flex: quantities[g.id] }} title={`${g.code}: ${quantities[g.id]}`}>
            {labels && `${g.code} ${quantities[g.id]}`}
          </span>
        ) : null,
      )}
      {rest > 0 && (
        <span className="stack-bar__part seg-rest" style={{ flex: rest }} title={`${main.code}: ${rest}`}>
          {labels && `${main.code} ${rest}`}
        </span>
      )}
    </div>
  );
}
