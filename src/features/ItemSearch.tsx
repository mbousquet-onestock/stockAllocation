import { useEffect, useState } from 'react';
import { api } from '../api';
import { ItemThumb } from '../components/ui';
import type { Item } from '../types';
import { useAsync, useDebounced } from '../utils/useAsync';

/** Item search box with completion: suggestions while typing, Enter filters the list, click opens the item. */
export function ItemSearch({ value, onChange, onPick }: { value: string; onChange: (v: string) => void; onPick: (item: Item) => void }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const debounced = useDebounced(value, 200);
  const suggestions = useAsync(() => (debounced.trim().length >= 2 ? api.searchItems(debounced, 8) : Promise.resolve([])), [debounced]);
  const list = suggestions.data ?? [];
  useEffect(() => setActive(-1), [debounced]);

  return (
    <div className="item-search grow" onBlur={() => setTimeout(() => setOpen(false), 150)}>
      <input
        className="input"
        placeholder="Search an item (name, SKU…)"
        value={value}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') setActive((a) => Math.min(list.length - 1, a + 1));
          else if (e.key === 'ArrowUp') setActive((a) => Math.max(-1, a - 1));
          else if (e.key === 'Enter') {
            if (active >= 0 && list[active]) onPick(list[active]);
            setOpen(false);
          } else if (e.key === 'Escape') setOpen(false);
        }}
      />
      {open && debounced.trim().length >= 2 && (
        <div className="dropdown">
          {suggestions.loading && !list.length && <div className="dropdown__option muted">Searching…</div>}
          {suggestions.error && <div className="dropdown__option text-error">{suggestions.error.message}</div>}
          {!suggestions.loading && !suggestions.error && !list.length && <div className="dropdown__option muted">No item found</div>}
          {list.map((item, i) => (
            <button
              type="button"
              key={item.id}
              className={`dropdown__option ${i === active ? 'is-active' : ''}`}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => onPick(item)}
            >
              <ItemThumb item={item} size={28} />
              <span className="grow">
                <div>{item.name}</div>
                <div className="muted small">{item.sku}</div>
              </span>
              {item.specs[0] && <span className="muted small">{item.specs[0]}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
