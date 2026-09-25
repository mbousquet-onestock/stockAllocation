import { useState } from 'react';
import { api } from '../api';
import { CloseIcon, TrashIcon } from '../components/Icons';
import { ATTRIBUTES, attributeLabel } from '../config/attributes';
import type { AttributeKey, Criterion } from '../types';
import { plural } from '../utils/format';
import { useAsync, useDebounced } from '../utils/useAsync';

type Option = { value: string; label?: string; itemCount?: number };

/** Multi-value input with suggestions (existing values of an item characteristic, purchase orders…). */
export function ValuesInput({
  values,
  onChange,
  load,
  loadKey,
  placeholder,
  display = (v) => v,
  allowFree = true,
}: {
  values: string[];
  onChange: (values: string[]) => void;
  load: (search: string) => Promise<Option[]>;
  /** Changes when the suggestion source changes. */
  loadKey: string;
  placeholder: string;
  /** Label of a selected value (e.g. a location name for its id). */
  display?: (value: string) => string;
  /** Allow values not in the suggestions (typed + Enter). */
  allowFree?: boolean;
}) {
  const [text, setText] = useState('');
  const [open, setOpen] = useState(false);
  const debounced = useDebounced(text, 150);
  const suggestions = useAsync(() => load(debounced), [loadKey, debounced]);
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
            {display(v)}
            <button type="button" onClick={() => onChange(values.filter((x) => x !== v))} aria-label={`Remove ${display(v)}`}>
              <CloseIcon width={12} height={12} />
            </button>
          </span>
        ))}
        <input
          value={text}
          placeholder={values.length ? '' : placeholder}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setText(e.target.value);
            setOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add(options[0] && (!text.trim() || !allowFree) ? options[0].value : allowFree ? text : '');
            } else if (e.key === 'Backspace' && !text && values.length) onChange(values.slice(0, -1));
          }}
        />
      </div>
      {open && options.length > 0 && (
        <div className="dropdown">
          {options.map((o) => (
            <button type="button" key={o.value} className="dropdown__option" onMouseDown={(e) => e.preventDefault()} onClick={() => add(o.value)}>
              <span className="grow">
                {display(o.value)}
                {o.label && <span className="muted"> — {o.label}</span>}
              </span>
              {o.itemCount !== undefined && <span className="muted small">{plural(o.itemCount, 'item')}</span>}
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
          <ValuesInput
            values={c.values}
            onChange={(values) => update(i, { values })}
            load={(q) => api.listAttributeValues(c.attribute, q)}
            loadKey={c.attribute}
            placeholder={`Choose ${attributeLabel(c.attribute).toLowerCase()} values…`}
          />
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
