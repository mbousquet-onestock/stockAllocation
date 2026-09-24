import type { Segment, SegmentId } from '../types';

/** Sales segments, in display order. Will come from the API later. */
export const SEGMENTS: Segment[] = [
  { id: 'brand_site', label: 'Brand site' },
  { id: 'marketplace', label: 'Marketplace' },
  { id: 'social', label: 'Social' },
];

export const SEGMENT_IDS: SegmentId[] = SEGMENTS.map((s) => s.id);

export const segmentLabel = (id: SegmentId): string =>
  SEGMENTS.find((s) => s.id === id)?.label ?? id;

export function segmentRecord<T>(fn: (id: SegmentId) => T): Record<SegmentId, T> {
  return Object.fromEntries(SEGMENT_IDS.map((id) => [id, fn(id)])) as Record<SegmentId, T>;
}
