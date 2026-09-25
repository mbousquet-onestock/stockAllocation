import type { Item, SegmentationRule, StockLine, StockLocation, StockType } from '../types';
import { applyRuleToLine, unsplit } from '../utils/allocation';
import { effectiveRule } from '../utils/rules';
import { StockTypeTree } from '../utils/stockTypes';

export const LOCATIONS: StockLocation[] = [
  { id: 'loc-0001', code: '0001', name: 'Alençon' },
  { id: 'loc-0002', code: '0002', name: 'Sered' },
  { id: 'loc-0003', code: '0003', name: 'Toledo' },
];

// name, category, brand, season, price, specs
const CATALOG: Array<[string, string, string, string, number, string[]]> = [
  ['DUAL EASY FRY & GRILL 8,3 L AIR FRYER', 'Air fryers', 'Moulinex', 'AW26', 199.99, ['8,3 l']],
  ['Ultragliss Anti-Calc Plus, Fer à Repasser Vapeur, 50 g/min, Pressing 250 g/min', 'Irons', 'Calor', 'Permanent', 69.99, ['2800 W']],
  ['Crêpière Billig', 'Crêpe makers', 'Krampouz', 'Permanent', 49.99, ['Ø 36 cm']],
  ['EASY FRY MAX 5 L AIR FRYER', 'Air fryers', 'Moulinex', 'Permanent', 129.99, ['5 l']],
  ['EASY FRY OVEN & GRILL 2-IN-1', 'Air fryers', 'Moulinex', 'AW26', 179.99, ['4,2 l']],
  ['Actifry Genius XL', 'Air fryers', 'Tefal', 'Permanent', 249.99, ['1,7 kg']],
  ['Easygliss Plus Fer Vapeur', 'Irons', 'Calor', 'Permanent', 49.99, ['2500 W']],
  ['Puregliss Fer Vapeur', 'Irons', 'Tefal', 'SS26', 89.99, ['3000 W']],
  ['Pro Express Vision Centrale Vapeur', 'Irons', 'Calor', 'AW26', 399.99, ['7,5 bars']],
  ['Crêpière Party Colormania', 'Crêpe makers', 'Tefal', 'Permanent', 39.99, ['6 crêpes']],
  ["Crep'Party Dual", 'Crêpe makers', 'Tefal', 'AW26', 59.99, ['2-en-1']],
  ['Cookeo Touch Pro Multicuiseur', 'Multicookers', 'Moulinex', 'Permanent', 329.99, ['6 l']],
  ['Cookeo+ Connect', 'Multicookers', 'Moulinex', 'AW26', 249.99, ['6 l']],
  ['Companion XL Robot Cuiseur', 'Multicookers', 'Moulinex', 'Permanent', 699.99, ['4,5 l']],
  ['Nutri Pro Blender', 'Blenders', 'Moulinex', 'SS26', 89.99, ['1 l']],
  ['Perfectmix Cook Blender Chauffant', 'Blenders', 'Moulinex', 'Permanent', 199.99, ['1,75 l']],
  ['X-Force Flex 12.60 Aspirateur Balai', 'Vacuum cleaners', 'Rowenta', 'AW26', 399.99, ['0,9 l']],
  ['X-Pert 6.60 Aspirateur Balai', 'Vacuum cleaners', 'Rowenta', 'Permanent', 229.99, ['0,5 l']],
  ['Silence Force Aspirateur Traîneau', 'Vacuum cleaners', 'Rowenta', 'SS26', 199.99, ['4,5 l']],
  ['Ingenio Poêle 28 cm', 'Cookware', 'Tefal', 'Permanent', 34.99, ['Ø 28 cm']],
  ['Ingenio Set 13 pièces', 'Cookware', 'Tefal', 'AW26', 149.99, ['13 pcs']],
  ['Talent Pro Casserole 20 cm', 'Cookware', 'Tefal', 'Permanent', 39.99, ['Ø 20 cm']],
  ['Optigrill Elite', 'Grills', 'Tefal', 'SS26', 249.99, ['12 programmes']],
  ['Optigrill+ XL', 'Grills', 'Tefal', 'Permanent', 199.99, ['8 programmes']],
  ['Plancha Malaga', 'Grills', 'Tefal', 'SS26', 89.99, ['2000 W']],
  ['Grille-pain Subito', 'Breakfast', 'Moulinex', 'Permanent', 49.99, ['2 fentes']],
  ['Bouilloire Vitesse Réglable', 'Breakfast', 'Krups', 'Permanent', 59.99, ['1,7 l']],
  ['Cafetière Filtre Subito Mug', 'Breakfast', 'Moulinex', 'Permanent', 39.99, ['1,25 l']],
];

const pad = (n: number, len: number) => String(n).padStart(len, '0');

export const ITEMS: Item[] = CATALOG.map(([name, category, brand, season, price, specs], i) => ({
  id: `item-${pad(i + 1, 3)}`,
  sku: `10821080${pad(10944 - i * 7, 5)}`,
  name,
  category,
  brand,
  season,
  price,
  specs,
}));
// Keep SKUs from the mockups for the first three items.
ITEMS[0].sku = '1082108010944';
ITEMS[1].sku = '1082108010906';
ITEMS[2].sku = '1082108010913';

export function buildStockTypes(): StockType[] {
  const main = (id: string, label: string, future: boolean, position: number): StockType => ({
    id,
    code: id,
    label,
    parentId: null,
    future,
    position,
  });
  const group = (parent: StockType, suffix: string, position: number): StockType => ({
    id: `${parent.id}_${suffix}`,
    code: `${parent.code}_${suffix}`,
    label: `${parent.label} ${suffix}`,
    parentId: parent.id,
    future: parent.future,
    position,
  });
  const mains = [main('on_hand', 'On hand', false, 1), main('container', 'Container', true, 2), main('planned', 'Planned', true, 3)];
  return mains.flatMap((m) => [m, group(m, 'A', 1), group(m, 'B', 2)]);
}

const shares = (a: number, b: number, prefix: string) => ({ [`${prefix}_A`]: a, [`${prefix}_B`]: b });
const skuOf = (name: string) => ITEMS.find((i) => i.name === name)!.sku;

export function buildRules(): SegmentationRule[] {
  const updatedAt = '2026-09-15T09:00:00.000Z';
  const base = { enabled: true, purchaseOrders: [], locationIds: [], thresholds: {}, period: { type: 'always' as const }, updatedAt };
  return [
    {
      ...base,
      id: 'rule-1',
      name: 'Cookeo+ Connect launch',
      priority: 1,
      criteria: [{ attribute: 'sku', values: [skuOf('Cookeo+ Connect')] }],
      stockTypeId: 'on_hand',
      shares: shares(70, 20, 'on_hand'),
      thresholds: { on_hand_A: 20 },
      period: { type: 'range', start: '2026-09-01', end: '2026-12-31' },
    },
    {
      ...base,
      id: 'rule-2',
      name: 'Air fryers – PO-2026-0042 reserved to group A',
      priority: 2,
      criteria: [{ attribute: 'category', values: ['Air fryers'] }],
      stockTypeId: 'container',
      purchaseOrders: ['PO-2026-0042'],
      shares: shares(100, 0, 'container'),
    },
    {
      ...base,
      id: 'rule-3',
      name: 'Calor irons',
      priority: 3,
      criteria: [
        { attribute: 'category', values: ['Irons'] },
        { attribute: 'brand', values: ['Calor'] },
      ],
      stockTypeId: 'on_hand',
      shares: shares(40, 40, 'on_hand'),
    },
    {
      ...base,
      id: 'rule-4',
      name: 'Air fryers',
      priority: 4,
      criteria: [{ attribute: 'category', values: ['Air fryers'] }],
      stockTypeId: 'on_hand',
      shares: shares(50, 30, 'on_hand'),
      thresholds: { on_hand_A: 20 },
    },
    {
      ...base,
      id: 'rule-5',
      name: 'Air fryers – containers',
      priority: 5,
      criteria: [{ attribute: 'category', values: ['Air fryers'] }],
      stockTypeId: 'container',
      shares: shares(50, 50, 'container'),
    },
    {
      ...base,
      id: 'rule-6',
      name: 'Vacuum cleaners – Alençon',
      priority: 6,
      criteria: [{ attribute: 'category', values: ['Vacuum cleaners'] }],
      stockTypeId: 'on_hand',
      locationIds: ['loc-0001'],
      shares: shares(60, 20, 'on_hand'),
      thresholds: { on_hand_A: 10, on_hand_B: 10 },
    },
    {
      ...base,
      id: 'rule-7',
      name: 'AW26 collection – planned',
      priority: 7,
      criteria: [{ attribute: 'season', values: ['AW26'] }],
      stockTypeId: 'planned',
      shares: shares(60, 40, 'planned'),
      period: { type: 'range', start: '2026-09-01', end: '2027-02-28' },
    },
    {
      ...base,
      id: 'rule-8',
      name: 'Cookware – test',
      priority: 8,
      enabled: false,
      criteria: [
        { attribute: 'category', values: ['Cookware'] },
        { attribute: 'brand', values: ['Tefal'] },
      ],
      stockTypeId: 'on_hand',
      locationIds: ['loc-0001', 'loc-0003'],
      shares: shares(20, 30, 'on_hand'),
    },
  ];
}

/** Deterministic pseudo random generator so data is stable between reloads. */
function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

const g = (quantity: number, threshold: number | null = null) => ({ quantity, threshold });
const lineId = (itemId: string, locationId: string, typeId: string, po: string | null) =>
  [itemId, locationId, typeId, po ?? ''].join('|');

export function newLine(itemId: string, locationId: string, stockTypeId: string, purchaseOrder: string | null, quantity: number): StockLine {
  return {
    id: lineId(itemId, locationId, stockTypeId, purchaseOrder),
    itemId,
    locationId,
    stockTypeId,
    purchaseOrder,
    quantity,
    split: {},
    period: { type: 'always' },
    source: { type: 'none' },
  };
}

/** Manually segmented on hand stock, values from the mockups. */
function mockupLines(item: Item): StockLine[] {
  const manual = (locationId: string, quantity: number, a: number, b: number): StockLine => ({
    ...newLine(item.id, locationId, 'on_hand', null, quantity),
    split: { on_hand_A: g(a), on_hand_B: g(b) },
    source: { type: 'manual' },
  });
  const rows = [manual('loc-0001', 1000, 300, 100), manual('loc-0002', 400, 200, 50), manual('loc-0003', 200, 100, 0)];
  if (item.id === 'item-001') {
    rows[1] = {
      ...manual('loc-0002', 305, 5, 50),
      period: { type: 'range', start: '2026-02-11', end: '2026-06-13' },
      split: { on_hand_A: g(5, 10), on_hand_B: g(50, 10) },
    };
    rows[2] = manual('loc-0003', 200, 200, 0);
  }
  return rows;
}

const PURCHASE_ORDERS = ['PO-2026-0042', 'PO-2026-0057', 'PO-2026-0063'];

/** Initial stock, split as the stock updates would have done with the rules. */
export function buildStockLines(rules: SegmentationRule[], types: StockType[]): StockLine[] {
  const random = rng(42);
  const tree = new StockTypeTree(types);
  const segment = (item: Item, line: StockLine) => {
    const rule = effectiveRule(rules, item, line);
    return rule ? applyRuleToLine(line, rule, tree) : unsplit(line);
  };
  return ITEMS.flatMap((item, i) => {
    const lines: StockLine[] = i < 3 ? mockupLines(item) : LOCATIONS.map((loc) => newLine(item.id, loc.id, 'on_hand', null, Math.round(random() * 60) * 10));
    // Future stock on some items / locations.
    LOCATIONS.forEach((loc) => {
      if (random() > 0.6) {
        const po = PURCHASE_ORDERS[Math.floor(random() * PURCHASE_ORDERS.length)];
        lines.push(newLine(item.id, loc.id, 'container', po, Math.round(random() * 30 + 5) * 10));
      }
      if (random() > 0.75) lines.push(newLine(item.id, loc.id, 'planned', null, Math.round(random() * 20 + 5) * 10));
    });
    return lines.map((l) => (l.source.type === 'manual' ? l : segment(item, l)));
  });
}
