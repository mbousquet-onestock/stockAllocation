import { SEGMENT_IDS } from '../config/segments';
import type { ImportRow, SegmentAllocation } from '../types';

export const IMPORT_HEADERS = [
  'sku',
  'location_code',
  ...SEGMENT_IDS.flatMap((id) => [id, `${id}_threshold`]),
  'start_date',
  'end_date',
];

export function templateCsv(sample: Array<{ sku: string; locationCode: string }> = []): string {
  const lines = [IMPORT_HEADERS.join(';')];
  sample.forEach((s) =>
    lines.push([s.sku, s.locationCode, ...SEGMENT_IDS.flatMap(() => ['', '']), '', ''].join(';')),
  );
  return lines.join('\n');
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Parses a segmentation CSV. Empty segment cells keep the current value.
 * Dates are ISO (yyyy-mm-dd); both empty = keep current period, "always" in start_date = all the time.
 */
export function parseImportCsv(text: string): { rows: ImportRow[]; errors: string[] } {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return { rows: [], errors: ['The file is empty'] };
  const sep = lines[0].includes(';') ? ';' : ',';
  const headers = lines[0].split(sep).map((h) => h.trim().toLowerCase());
  const col = (name: string) => headers.indexOf(name);
  if (col('sku') < 0 || col('location_code') < 0)
    return { rows: [], errors: ['Missing required columns "sku" and "location_code"'] };

  const rows: ImportRow[] = [];
  const errors: string[] = [];
  lines.slice(1).forEach((line, i) => {
    const cells = line.split(sep).map((c) => c.trim());
    const get = (name: string) => (col(name) >= 0 ? cells[col(name)] ?? '' : '');
    const lineNo = i + 2;
    const toNumber = (v: string, field: string): number | undefined => {
      if (v === '') return undefined;
      const n = Number(v);
      if (!Number.isInteger(n) || n < 0) {
        errors.push(`Line ${lineNo}: invalid value "${v}" for ${field}`);
        return undefined;
      }
      return n;
    };
    const segments: ImportRow['segments'] = {};
    SEGMENT_IDS.forEach((id) => {
      const q = toNumber(get(id), id);
      const t = toNumber(get(`${id}_threshold`), `${id}_threshold`);
      if (q !== undefined) {
        const s: SegmentAllocation = { quantity: q, threshold: t ?? null };
        segments[id] = s;
      }
    });
    const start = get('start_date');
    const end = get('end_date');
    let period: ImportRow['period'];
    if (start.toLowerCase() === 'always') period = { type: 'always' };
    else if (start || end) {
      if (!DATE_RE.test(start) || !DATE_RE.test(end) || start > end)
        errors.push(`Line ${lineNo}: invalid period "${start}" → "${end}"`);
      else period = { type: 'range', start, end };
    }
    rows.push({ sku: get('sku'), locationCode: get('location_code'), segments, period });
  });
  return { rows, errors };
}

export function downloadText(filename: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
