import { useMemo, useState } from 'react';
import { api } from '../api';
import { Modal, Spinner } from '../components/ui';
import { useStockTypes } from '../components/StockTypes';
import { useToast } from '../components/Toast';
import type { Item, StockLineRow } from '../types';
import { useAsync } from '../utils/useAsync';

/**
 * Add or change the stock of an item: stock location, stock type (main type or group) and quantity.
 * Sent to OneStock as the new quantity (stock_import, incremental false).
 */
export function SetStockModal({
  item,
  rows,
  initial,
  onClose,
  onSaved,
}: {
  item: Item;
  /** Current stock lines of the item, to show the current quantity. */
  rows: StockLineRow[];
  initial?: { locationId?: string; stockTypeId?: string };
  onClose: () => void;
  onSaved: () => void;
}) {
  const notify = useToast();
  const tree = useStockTypes();
  const locations = useAsync(() => api.listLocations(), []);
  // Future stock needs a purchase order and an ETA: not set here.
  const types = tree.ordered.filter((t) => !tree.byId(t.parentId ?? t.id)?.future);
  const [locationText, setLocationText] = useState(initial?.locationId ?? '');
  const [stockTypeId, setStockTypeId] = useState(initial?.stockTypeId ?? types[0]?.id ?? '');
  const [quantityText, setQuantityText] = useState('');
  const [saving, setSaving] = useState(false);

  const locationLabel = (l: { id: string; name: string }) => (l.name && l.name !== l.id ? `${l.name} — ${l.id}` : l.id);
  const location = useMemo(
    () => (locations.data ?? []).find((l) => l.id === locationText.trim() || locationLabel(l) === locationText.trim()),
    [locations.data, locationText],
  );
  const type = tree.byId(stockTypeId);
  const mainId = type?.parentId ?? type?.id;

  /** Current quantity of the type in the location (stock without purchase order). */
  const current = useMemo(() => {
    if (!location || !type) return undefined;
    const row = rows.find((r) => r.line.locationId === location.id && r.line.stockTypeId === mainId && !r.line.purchaseOrder);
    if (!row) return 0;
    return type.id === mainId ? row.remaining : (row.line.split[type.id]?.quantity ?? 0);
  }, [location, type, mainId, rows]);

  const quantityValid = /^\d+$/.test(quantityText.trim()) && Number.isSafeInteger(Number(quantityText));
  const quantity = quantityValid ? Number(quantityText) : undefined;
  const valid = !!location && !!type && quantity !== undefined && quantity !== current;

  const save = async () => {
    if (!location || !type || quantity === undefined) return;
    setSaving(true);
    try {
      const res = await api.setStock({ itemId: item.id, locationId: location.id, stockTypeId: type.id, quantity });
      if (res.confirmed === false)
        notify(
          `Sent to OneStock, but not applied yet: OneStock still gives ${res.onestockQuantity ?? '?'} pcs. Refresh in a moment; if it does not change, see the stock_import answer in Settings → API calls.`,
          'error',
        );
      else notify(`Stock of ${type.label || type.code} set to ${quantity} in ${location.name || location.id}`);
      onSaved();
    } catch (e) {
      notify((e as Error).message, 'error');
      setSaving(false);
    }
  };

  return (
    <Modal
      title="Add / update stock"
      onClose={onClose}
      width={520}
      footer={
        <>
          <button type="button" className="btn btn--secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn--primary" disabled={!valid || saving} onClick={save}>
            {saving ? 'Waiting for OneStock…' : 'Save'}
          </button>
        </>
      }
    >
      <div className="form-stack">
        <label className="field">
          <span className="field__label">Stock location</span>
          <input
            className={`input ${locationText && !location && !locations.loading ? 'is-invalid' : ''}`}
            list="set-stock-locations"
            value={locationText}
            onChange={(e) => setLocationText(e.target.value)}
            placeholder={locations.loading ? 'Loading the stock locations…' : 'Search a stock location'}
            autoFocus
          />
          <datalist id="set-stock-locations">
            {(locations.data ?? []).map((l) => (
              <option key={l.id} value={locationLabel(l)} />
            ))}
          </datalist>
          {locations.loading && <Spinner />}
          {locationText && !location && !locations.loading && <span className="text-error small">Unknown stock location</span>}
        </label>
        <label className="field">
          <span className="field__label">Stock type</span>
          <select className="input" value={stockTypeId} onChange={(e) => setStockTypeId(e.target.value)}>
            {types.map((t) => {
              const main = t.parentId ? tree.byId(t.parentId) : undefined;
              return (
                <option key={t.id} value={t.id}>
                  {main && !(t.label || '').toLowerCase().startsWith(main.label.toLowerCase())
                    ? `${main.label} › ${t.label || t.code}`
                    : t.label || t.code}{' '}
                  ({t.code})
                </option>
              );
            })}
          </select>
        </label>
        <div className="form-row form-row--even">
          <label className="field">
            <span className="field__label">Quantity</span>
            <input
              className={`input ${quantityText && !quantityValid ? 'is-invalid' : ''}`}
              inputMode="numeric"
              value={quantityText}
              onChange={(e) => setQuantityText(e.target.value)}
              placeholder={current !== undefined ? String(current) : ''}
            />
          </label>
          <div className="field">
            <span className="field__label">Current stock</span>
            <span className="set-stock__current">{current === undefined ? '—' : `${current} pcs`}</span>
          </div>
        </div>
      </div>
    </Modal>
  );
}
