import { useState } from 'react';
import { api } from '../api';
import { CloseIcon, TrashIcon } from '../components/Icons';
import { ATTRIBUTES, attributeLabel } from '../config/attributes';
import type { AttributeKey, Criterion } from '../types';
import { plural } from '../utils/format';
import { useAsync, useDebounced } from '../utils/useAsync';

/** Multi-value input with suggestions from the existing values of an item characteristic. */
function ValuesInput({
  attribute,
  values,
  onChange,
}: {
  attribute: AttributeKey;
  values: string[];
  onChange: (values: string[]) => void;
}) {
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const debounced = useDebounced(text, 150);
  const suggestions = useAsync(() => api.listAttributeValues(attribute, debounced), [attribute, debounced]);
  const add = (v: string) => {
    const value = v.trim();
    if (value && !values.includes(value)) onChange([...values, value]);
    setText('');
  };
  const options = (suggestions.data ?? []).filter((s) => !values.includes(s.value));

  return (
    <div className="values-input" onBlur={() => setTimeout(() => setOpen(false), 150)}>
      <div className="values-input__box">
        {values.map((v) => (
          <span className="chip chip--selected" key={v}>
            {v}
            <button type="button" onClick={() => onChange(values.filter((x) => x !== v))} aria-label={`Remove ${v}`}>
              <CloseIcon width={12} height={12} />
            </button>
          </span>
        ))}
        <input
          value={text}
          placeholder={values.length ? '' : `Choose ${attributeLabel(attribute).toLowerCase()} values…`}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setText(e.target.value);
            setOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add(options[0] && !text.trim() ? options[0].value : text);
            } else if (e.key === 'Backspace' && !text && values.length) onChange(values.slice(0, -1));
          }}
        />
      </div>
      {open && options.length > 0 && (
        <div className="dropdown">
          {options.map((o) => (
            <button type="button" key={o.value} className="dropdown__option" onMouseDown={(e) => e.preventDefault()} onClick={() => add(o.value)}>
              <span className="grow">
                {o.value}
                {o.label && <span className="muted"> — {o.label}</span>}
              </span>
              <span className="muted small">{plural(o.itemCount, 'item')}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function CriteriaEditor({ criteria, onChange }: { criteria: Criterion[]; onChange: (c: Criterion[]) => void }) {
  const used = criteria.map((c) => c.attribute);
  const free = ATTRIBUTES.filter((a) => !used.includes(a.key));
  const update = (i: number, patch: Partial<Criterion>) =>
    onChange(criteria.map((c, j) => (i === j ? { ...c, ...patch } : c)));

  return (
    <div className="criteria">
      {criteria.map((c, i) => (
        <div className="criteria__row" key={c.attribute}>
          <span className="criteria__op">{i === 0 ? 'Where' : 'and'}</span>
          <select
            className="select"
            value={c.attribute}
            onChange={(e) => update(i, { attribute: e.target.value as AttributeKey, values: [] })}
          >
            {ATTRIBUTES.filter((a) => a.key === c.attribute || !used.includes(a.key)).map((a) => (
              <option key={a.key} value={a.key}>
                {a.label}
              </option>
            ))}
          </select>
          <span className="criteria__op">is</span>
          <ValuesInput attribute={c.attribute} values={c.values} onChange={(values) => update(i, { values })} />
          <button
            type="button"
            className="icon-btn"
            onClick={() => onChange(criteria.filter((_, j) => j !== i))}
            aria-label="Remove criterion"
          >
            <TrashIcon />
          </button>
        </div>
      ))}
      {free.length > 0 && (
        <button type="button" className="link" onClick={() => onChange([...criteria, { attribute: free[0].key, values: [] }])}>
          + Add a criterion
        </button>
      )}
    </div>
  );
}
