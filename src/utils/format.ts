import type { ActivationPeriod } from '../types';

export const formatPrice = (n: number): string =>
  n.toLocaleString('fr-FR', { style: 'currency', currency: 'EUR' });

/** yyyy-mm-dd -> dd/mm/yy (short) or dd/mm/yyyy (long). */
export function formatDate(iso: string, long = false): string {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${long ? y : y.slice(2)}`;
}

export function formatPeriod(p: ActivationPeriod, long = false): string {
  if (p.type === 'always') return 'All the time';
  return `${formatDate(p.start, long)} → ${formatDate(p.end, long)}`;
}

export const todayIso = (): string => new Date().toISOString().slice(0, 10);

export const plural = (n: number, word: string): string =>
  `${n} ${n > 1 ? (/[^aeiou]y$/.test(word) ? `${word.slice(0, -1)}ies` : `${word}s`) : word}`;
