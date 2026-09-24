import type { SVGProps } from 'react';

type P = SVGProps<SVGSVGElement>;
const base = (props: P) => ({ width: 16, height: 16, viewBox: '0 0 24 24', fill: 'currentColor', ...props });

export const WarningIcon = (p: P) => (
  <svg {...base(p)}><path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z" /></svg>
);
export const DownloadIcon = (p: P) => (
  <svg {...base(p)}><path d="M5 20h14v-2H5v2zM19 9h-4V3H9v6H5l7 7 7-7z" /></svg>
);
export const ArrowBackIcon = (p: P) => (
  <svg {...base(p)}><path d="M20 11H7.83l5.59-5.59L12 4l-8 8 8 8 1.41-1.41L7.83 13H20v-2z" /></svg>
);
export const ChevronLeftIcon = (p: P) => (
  <svg {...base(p)}><path d="M15.41 7.41 14 6l-6 6 6 6 1.41-1.41L10.83 12z" /></svg>
);
export const ChevronRightIcon = (p: P) => (
  <svg {...base(p)}><path d="M10 6 8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z" /></svg>
);
export const SortIcon = ({ direction, ...p }: P & { direction?: 'asc' | 'desc' }) => (
  <svg {...base({ width: 12, height: 12, ...p })} viewBox="0 0 12 16">
    <path d="M6 1 2 6h8z" opacity={direction === 'desc' ? 0.25 : 1} />
    <path d="M6 15l4-5H2z" opacity={direction === 'asc' ? 0.25 : 1} />
  </svg>
);
export const CloseIcon = (p: P) => (
  <svg {...base(p)}><path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" /></svg>
);
export const TrashIcon = (p: P) => (
  <svg {...base(p)}><path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" /></svg>
);
export const CalendarIcon = (p: P) => (
  <svg {...base(p)}><path d="M19 4h-1V2h-2v2H8V2H6v2H5c-1.11 0-2 .9-2 2v14a2 2 0 0 0 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 16H5V9h14v11zM7 11h5v5H7z" /></svg>
);
export const BellIcon = (p: P) => (
  <svg {...base(p)}><path d="M12 22c1.1 0 2-.9 2-2h-4a2 2 0 0 0 2 2zm6-6v-5c0-3.07-1.64-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.63 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z" /></svg>
);
export const WarehouseIcon = (p: P) => (
  <svg {...base(p)}><path d="M12 3 2 8v13h6v-8h8v8h6V8L12 3zm-1 16H9v-2h2v2zm0-4H9v-2h2v2zm4 4h-2v-2h2v2z" /></svg>
);
export const SearchIcon = (p: P) => (
  <svg {...base(p)}><path d="M15.5 14h-.79l-.28-.27A6.47 6.47 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z" /></svg>
);
export const CheckIcon = (p: P) => (
  <svg {...base(p)}><path d="M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" /></svg>
);
export const ResetIcon = (p: P) => (
  <svg {...base(p)}><path d="M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z" /></svg>
);
export const ArrowUpIcon = (p: P) => (
  <svg {...base(p)}><path d="M7.41 15.41 12 10.83l4.59 4.58L18 14l-6-6-6 6z" /></svg>
);
export const ArrowDownIcon = (p: P) => (
  <svg {...base(p)}><path d="M7.41 8.59 12 13.17l4.59-4.58L18 10l-6 6-6-6z" /></svg>
);
export const CopyIcon = (p: P) => (
  <svg {...base(p)}><path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z" /></svg>
);
export const PlayIcon = (p: P) => (
  <svg {...base(p)}><path d="M8 5v14l11-7z" /></svg>
);
