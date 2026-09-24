import { useEffect, type ReactNode } from 'react';
import type { Item } from '../types';
import { CloseIcon, SortIcon, WarningIcon, ChevronLeftIcon, ChevronRightIcon } from './Icons';
import { formatPrice } from '../utils/format';

export function QtyBadge({ value, warning, tone }: { value: number | string; warning?: boolean; tone?: 'success' }) {
  return (
    <span className={`badge ${warning ? 'badge--warning' : tone ? `badge--${tone}` : ''}`}>
      {warning && <WarningIcon width={12} height={12} />}
      {value}
    </span>
  );
}

export function Checkbox({
  checked,
  indeterminate,
  onChange,
  label,
}: {
  checked: boolean;
  indeterminate?: boolean;
  onChange: (checked: boolean) => void;
  label?: ReactNode;
}) {
  return (
    <label className="checkbox" onClick={(e) => e.stopPropagation()}>
      <input
        type="checkbox"
        checked={checked}
        ref={(el) => {
          if (el) el.indeterminate = !!indeterminate && !checked;
        }}
        onChange={(e) => onChange(e.target.checked)}
      />
      {label && <span>{label}</span>}
    </label>
  );
}

export function SortHeader<K extends string>({
  label,
  sortKey,
  sort,
  onSort,
}: {
  label: string;
  sortKey: K;
  sort?: { key: K; direction: 'asc' | 'desc' };
  onSort: (key: K) => void;
}) {
  const active = sort?.key === sortKey;
  return (
    <button type="button" className={`sort-header ${active ? 'is-active' : ''}`} onClick={() => onSort(sortKey)}>
      {label}
      <SortIcon direction={active ? sort!.direction : undefined} />
    </button>
  );
}

export const PAGE_SIZES = [10, 25, 50, 100];

export function Pagination({
  page,
  pageSize,
  total,
  onPage,
  onPageSize,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPage: (p: number) => void;
  onPageSize: (s: number) => void;
}) {
  const from = total === 0 ? 0 : page * pageSize + 1;
  const to = Math.min(total, (page + 1) * pageSize);
  const lastPage = Math.max(0, Math.ceil(total / pageSize) - 1);
  return (
    <div className="pagination">
      <span>
        {from} - {to} / {total}
      </span>
      <select className="select" value={pageSize} onChange={(e) => onPageSize(Number(e.target.value))}>
        {PAGE_SIZES.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>
      <button type="button" className="icon-btn" disabled={page === 0} onClick={() => onPage(page - 1)} aria-label="Previous page">
        <ChevronLeftIcon width={20} height={20} />
      </button>
      <button type="button" className="icon-btn" disabled={page >= lastPage} onClick={() => onPage(page + 1)} aria-label="Next page">
        <ChevronRightIcon width={20} height={20} />
      </button>
    </div>
  );
}

export function Modal({
  title,
  onClose,
  children,
  footer,
  width = 600,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal" style={{ maxWidth: width }} onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label={title}>
        <div className="modal__header">
          <h2>{title}</h2>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">
            <CloseIcon width={20} height={20} />
          </button>
        </div>
        <div className="modal__body">{children}</div>
        {footer && <div className="modal__footer">{footer}</div>}
      </div>
    </div>
  );
}

const THUMB_COLORS = ['#37474f', '#5c6bc0', '#26a69a', '#8d6e63', '#ef6c00', '#7e57c2', '#546e7a'];

export function ItemThumb({ item, size = 32 }: { item: Item; size?: number }) {
  if (item.imageUrl) return <img className="thumb" src={item.imageUrl} alt="" width={size} height={size} />;
  const color = THUMB_COLORS[item.category.length % THUMB_COLORS.length];
  const initials = item.category
    .split(' ')
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
  return (
    <span className="thumb thumb--placeholder" style={{ width: size, height: size, background: color, fontSize: size * 0.36 }}>
      {initials}
    </span>
  );
}

export function ItemIdentity({ item, detailed }: { item: Item; detailed?: boolean }) {
  return (
    <div className="item-identity">
      <ItemThumb item={item} size={detailed ? 48 : 32} />
      <div>
        <div className="item-identity__name">{item.name}</div>
        {detailed && (
          <div className="item-identity__meta">
            {formatPrice(item.price)} | {item.category} | {item.attributes.join(' | ')}
          </div>
        )}
        <div className="muted">{item.sku}</div>
      </div>
    </div>
  );
}

export function Spinner() {
  return <div className="spinner" aria-label="Loading" />;
}
