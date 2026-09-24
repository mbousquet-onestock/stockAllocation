import type { AttributeKey, Item } from '../types';

/** Item characteristics available in rule criteria. Will come from the API later. */
export const ATTRIBUTES: Array<{ key: AttributeKey; label: string }> = [
  { key: 'sku', label: 'SKU' },
  { key: 'category', label: 'Category' },
  { key: 'brand', label: 'Brand' },
  { key: 'season', label: 'Season' },
];

export const attributeLabel = (key: AttributeKey): string =>
  ATTRIBUTES.find((a) => a.key === key)?.label ?? key;

export const itemAttribute = (item: Item, key: AttributeKey): string => item[key];
