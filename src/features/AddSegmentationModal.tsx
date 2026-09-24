import { useMemo, useState } from 'react';
import { api } from '../api';
import { Checkbox, ItemThumb, Modal, Spinner } from '../components/ui';
import { CloseIcon, SearchIcon, TrashIcon } from '../components/Icons';
import { useToast } from '../components/Toast';
import { SEGMENTS, segmentRecord } from '../config/segments';
import type { ActivationPeriod, Item, RuleMode, SegmentId, SegmentationRule } from '../types';
import { computeQuantities } from '../utils/allocation';
import { plural } from '../utils/format';
import { useAsync, useDebounced } from '../utils/useAsync';
import { isPeriodValid, PeriodField } from './PeriodField';

type TargetType = 'items' | 'categories';

const EXAMPLE_STOCK = 100;

export function AddSegmentationModal({
  initialItems = [],
  onClose,
  onApplied,
}: {
  initialItems?: Item[];
  onClose: () => void;
  onApplied: () => void;
}) {
  const notify = useToast();
  const [targetType, setTargetType] = useState<TargetType>('items');
  const [selectedItems, setSelectedItems] = useState<Item[]>(initialItems);
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const debounced = useDebounced(search);
  const [locationIds, setLocationIds] = useState<string[] | null>(null); // null = all
  const [mode, setMode] = useState<RuleMode>('percentage');
  const [values, setValues] = useState<Record<SegmentId, string>>(() => segmentRecord(() => ''));
  const [thresholds, setThresholds] = useState<Record<SegmentId, string>>(() => segmentRecord(() => ''));
  const [period, setPeriod] = useState<ActivationPeriod>({ type: 'always' });
  const [applying, setApplying] = useState(false);

  const results = useAsync(() => api.searchItems(debounced, 30), [debounced]);
  const categories = useAsync(() => api.listCategories(), []);
  const locations = useAsync(() => api.listLocations(), []);

  const num = (v: string) => (v.trim() === '' ? 0 : Number(v));
  const isInt = (v: string) => v.trim() === '' || /^\d+$/.test(v.trim());
  const numericValues = segmentRecord((id) => num(values[id]));
  const total = SEGMENTS.reduce((s, seg) => s + numericValues[seg.id], 0);
  const valuesValid = SEGMENTS.every((s) => isInt(values[s.id]) && isInt(thresholds[s.id]));
  const percentValid = mode === 'quantity' || total <= 100;

  const targetItemCount =
    targetType === 'items'
      ? selectedItems.length
      : (categories.data ?? [])
          .filter((c) => selectedCategories.includes(c.name))
          .reduce((s, c) => s + c.itemCount, 0);
  const selectedLocationCount = locationIds === null ? locations.data?.length ?? 0 : locationIds.length;

  const valid =
    targetItemCount > 0 && selectedLocationCount > 0 && valuesValid && percentValid && total > 0 && isPeriodValid(period);

  const example = useMemo(
    () => computeQuantities(EXAMPLE_STOCK, { mode, values: numericValues }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mode, values],
  );
  const exampleRest = EXAMPLE_STOCK - SEGMENTS.reduce((s, seg) => s + example.quantities[seg.id], 0);

  const toggleItem = (item: Item) =>
    setSelectedItems((list) =>
      list.some((i) => i.id === item.id) ? list.filter((i) => i.id !== item.id) : [...list, item],
    );
  const toggleCategory = (name: string) =>
    setSelectedCategories((list) => (list.includes(name) ? list.filter((c) => c !== name) : [...list, name]));
  const toggleLocation = (id: string, checked: boolean) => {
    const all = (locations.data ?? []).map((l) => l.id);
    const current = locationIds ?? all;
    const next = checked ? [...current, id] : current.filter((x) => x !== id);
    setLocationIds(next.length === all.length ? null : next);
  };

  const apply = async () => {
    const rule: SegmentationRule = {
      target:
        targetType === 'items'
          ? { type: 'items', itemIds: selectedItems.map((i) => i.id) }
          : { type: 'categories', categories: selectedCategories },
      locationIds: locationIds ?? [],
      mode,
      values: numericValues,
      thresholds: segmentRecord((id) => (thresholds[id].trim() === '' ? null : Number(thresholds[id]))),
      period,
    };
    setApplying(true);
    try {
      const res = await api.applyRule(rule);
      notify(
        `Segmentation applied to ${plural(res.itemCount, 'item')} (${plural(res.allocationCount, 'stock location')})` +
          (res.cappedCount ? ` — ${res.cappedCount} capped to available stock` : ''),
      );
      onApplied();
    } catch (e) {
      notify((e as Error).message, 'error');
      setApplying(false);
    }
  };

  const unit = mode === 'percentage' ? '%' : 'pcs';

  return (
    <Modal
      title="Add item segmentation"
      onClose={onClose}
      width={760}
      footer={
        <>
          <span className="muted small footer-hint">Existing segmentation of the targeted stock will be replaced.</span>
          <button type="button" className="btn btn--secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn--primary" disabled={!valid || applying} onClick={apply}>
            Apply to {plural(targetItemCount, 'item')}
          </button>
        </>
      }
    >
      {/* 1. Target */}
      <h3 className="section-title">1. Items</h3>
      <div className="tabs">
        <button type="button" className={targetType === 'items' ? 'is-active' : ''} onClick={() => setTargetType('items')}>
          By item {selectedItems.length > 0 && <span className="count">{selectedItems.length}</span>}
        </button>
        <button type="button" className={targetType === 'categories' ? 'is-active' : ''} onClick={() => setTargetType('categories')}>
          By category {selectedCategories.length > 0 && <span className="count">{selectedCategories.length}</span>}
        </button>
      </div>

      {targetType === 'items' ? (
        <div className="panel">
          <div className="search-input">
            <SearchIcon />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name, SKU or category" autoFocus />
          </div>
          {selectedItems.length > 0 && (
            <div className="chips">
              {selectedItems.map((i) => (
                <span className="chip chip--selected" key={i.id}>
                  {i.name.length > 32 ? `${i.name.slice(0, 32)}…` : i.name}
                  <button type="button" onClick={() => toggleItem(i)} aria-label={`Remove ${i.name}`}>
                    <CloseIcon width={12} height={12} />
                  </button>
                </span>
              ))}
              <button type="button" className="link" onClick={() => setSelectedItems([])}>
                Clear
              </button>
            </div>
          )}
          <div className="pick-list">
            {results.loading && !results.data ? (
              <Spinner />
            ) : (
              (results.data ?? []).map((item) => (
                <div className="pick-list__row" key={item.id} onClick={() => toggleItem(item)}>
                  <Checkbox checked={selectedItems.some((i) => i.id === item.id)} onChange={() => toggleItem(item)} />
                  <ItemThumb item={item} size={24} />
                  <span className="grow">{item.name}</span>
                  <span className="muted small">{item.category}</span>
                  <span className="muted small">{item.sku}</span>
                </div>
              ))
            )}
            {results.data?.length === 0 && <div className="muted empty">No item found</div>}
          </div>
        </div>
      ) : (
        <div className="panel pick-list">
          {(categories.data ?? []).map((c) => (
            <div className="pick-list__row" key={c.name} onClick={() => toggleCategory(c.name)}>
              <Checkbox checked={selectedCategories.includes(c.name)} onChange={() => toggleCategory(c.name)} />
              <span className="grow">{c.name}</span>
              <span className="muted small">{plural(c.itemCount, 'item')}</span>
            </div>
          ))}
        </div>
      )}

      {/* 2. Locations */}
      <h3 className="section-title">2. Stock locations</h3>
      <div className="panel inline-checks">
        {(locations.data ?? []).map((l) => (
          <Checkbox
            key={l.id}
            checked={locationIds === null || locationIds.includes(l.id)}
            onChange={(checked) => toggleLocation(l.id, checked)}
            label={
              <>
                {l.name} <span className="muted">{l.code}</span>
              </>
            }
          />
        ))}
      </div>

      {/* 3. Rule */}
      <h3 className="section-title">3. Allocation rule</h3>
      <div className="segmented-control">
        <button type="button" className={mode === 'percentage' ? 'is-active' : ''} onClick={() => setMode('percentage')}>
          Percentage of stock
        </button>
        <button type="button" className={mode === 'quantity' ? 'is-active' : ''} onClick={() => setMode('quantity')}>
          Fixed quantity per location
        </button>
      </div>
      <div className="segment-grid">
        {SEGMENTS.map((seg) => (
          <div className="segment-grid__row" key={seg.id}>
            <label className="field">
              <span className="field__label">{seg.label}</span>
              <span className={`input-group ${!isInt(values[seg.id]) ? 'is-invalid' : ''}`}>
                <input
                  inputMode="numeric"
                  value={values[seg.id]}
                  placeholder="0"
                  onChange={(e) => setValues((v) => ({ ...v, [seg.id]: e.target.value }))}
                />
                <span className="input-group__addon muted">{unit}</span>
              </span>
            </label>
            <label className="field">
              <span className="field__label">{seg.label} threshold</span>
              <span className={`input-group ${!isInt(thresholds[seg.id]) ? 'is-invalid' : ''}`}>
                <input
                  inputMode="numeric"
                  value={thresholds[seg.id]}
                  placeholder="None"
                  onChange={(e) => setThresholds((v) => ({ ...v, [seg.id]: e.target.value }))}
                />
                <button
                  type="button"
                  className="input-group__addon input-group__btn"
                  onClick={() => setThresholds((v) => ({ ...v, [seg.id]: '' }))}
                  disabled={thresholds[seg.id] === ''}
                  aria-label={`Remove ${seg.label} threshold`}
                >
                  <TrashIcon />
                </button>
              </span>
            </label>
          </div>
        ))}
      </div>

      <div className="non-allocated">
        {mode === 'percentage' ? (
          <strong className={!percentValid ? 'text-error' : ''}>{100 - total} % : Non allocated</strong>
        ) : (
          <strong>{total} pcs allocated per location, the rest stays non allocated</strong>
        )}
        {!percentValid && <div className="text-error small">The sum of percentages cannot exceed 100 %.</div>}
      </div>

      {valuesValid && percentValid && total > 0 && (
        <div className="example">
          <span className="muted">Example on {EXAMPLE_STOCK} pieces:</span>
          <div className="stack-bar">
            {SEGMENTS.map((seg, i) =>
              example.quantities[seg.id] > 0 ? (
                <span key={seg.id} className={`stack-bar__part seg-${i}`} style={{ flex: example.quantities[seg.id] }} title={seg.label}>
                  {seg.label} {example.quantities[seg.id]}
                </span>
              ) : null,
            )}
            {exampleRest > 0 && (
              <span className="stack-bar__part seg-rest" style={{ flex: exampleRest }}>
                Non allocated {exampleRest}
              </span>
            )}
          </div>
          {example.capped && (
            <div className="text-warning small">
              Quantities exceed the stock: they are capped in the order {SEGMENTS.map((s) => s.label).join(' → ')}.
            </div>
          )}
        </div>
      )}

      {/* 4. Period */}
      <h3 className="section-title">4. Activation period</h3>
      <PeriodField value={period} onChange={setPeriod} />
    </Modal>
  );
}
