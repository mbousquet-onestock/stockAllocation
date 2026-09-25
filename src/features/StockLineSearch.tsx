import { useState } from 'react';
import { CloseIcon, SearchIcon } from '../components/Icons';

export interface LineFilterOption {
  kind: 'po' | 'location' | 'no-po';
  value: string;
  label: string;
  detail?: string;
}

/**
 * Search box of the item stock lines: the text filters the lines (purchase order, location, stock type) as you type;
 * suggestions set an exact filter (a purchase order, a stock location, or "without purchase order").
 */
export function StockLineSearch({
  text,
  onText,
  filters,
  onFilters,
  options,
}: {
  text: string;
  onText: (t: string) => void;
  filters: LineFilterOption[];
  onFilters: (f: LineFilterOption[]) => void;
  options: LineFilterOption[];
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const q = text.trim().toLowerCase();
  const suggestions = options
    .filter((o) => !filters.some((f) => f.kind === o.kind && f.value === o.value))
    // One exact filter per kind: a purchase order replaces the previous one, etc.
    .filter((o) => !q || `${o.label} ${o.value} ${o.detail ?? ''}`.toLowerCase().includes(q))
    .slice(0, 12);
  const pick = (o: LineFilterOption) => {
    const kindOf = (k: LineFilterOption['kind']) => (k === 'no-po' ? 'po' : k);
    onFilters([...filters.filter((f) => kindOf(f.kind) !== kindOf(o.kind)), o]);
    onText('');
    setActive(-1);
  };

  return (
    <div className="line-search" onBlur={() => setTimeout(() => setOpen(false), 150)}>
      <div className="line-search__box">
        <SearchIcon />
        {filters.map((f) => (
          <span className={`chip chip--selected ${f.kind === 'po' ? 'chip--po' : ''}`} key={`${f.kind}:${f.value}`}>
            {f.kind === 'location' ? '📍 ' : ''}
            {f.label}
            <button type="button" onClick={() => onFilters(filters.filter((x) => x !== f))} aria-label={`Remove ${f.label}`}>
              <CloseIcon width={12} height={12} />
            </button>
          </span>
        ))}
        <input
          value={text}
          placeholder={filters.length ? 'Refine…' : 'Search a purchase order, a stock location, a stock type…'}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            onText(e.target.value);
            setOpen(true);
            setActive(-1);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') setActive((a) => Math.min(suggestions.length - 1, a + 1));
            else if (e.key === 'ArrowUp') setActive((a) => Math.max(-1, a - 1));
            else if (e.key === 'Enter' && active >= 0 && suggestions[active]) pick(suggestions[active]);
            else if (e.key === 'Escape') setOpen(false);
            else if (e.key === 'Backspace' && !text && filters.length) onFilters(filters.slice(0, -1));
          }}
        />
      </div>
      {open && suggestions.length > 0 && (
        <div className="dropdown">
          {suggestions.map((o, i) => (
            <button
              type="button"
              key={`${o.kind}:${o.value}`}
              className={`dropdown__option ${i === active ? 'is-active' : ''}`}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(o)}
            >
              <span className="line-search__kind muted small">
                {o.kind === 'po' ? 'Purchase order' : o.kind === 'location' ? 'Stock location' : 'Filter'}
              </span>
              <span className="grow">{o.label}</span>
              {o.detail && <span className="muted small">{o.detail}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
