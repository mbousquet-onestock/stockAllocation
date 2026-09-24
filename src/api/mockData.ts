import { segmentRecord } from '../config/segments';
import type { Allocation, Item, SegmentationRule, StockLocation } from '../types';
import { applyRuleToAllocation, unallocated } from '../utils/allocation';
import { effectiveRule } from '../utils/rules';

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

const pct = (brand_site: number, marketplace: number, social: number) => ({ brand_site, marketplace, social });
const noThresholds = segmentRecord<number | null>(() => null);
const skuOf = (name: string) => ITEMS.find((i) => i.name === name)!.sku;

export function buildRules(): SegmentationRule[] {
  const updatedAt = '2026-09-15T09:00:00.000Z';
  return [
    {
      id: 'rule-1',
      name: 'Cookeo+ Connect launch',
      priority: 1,
      enabled: true,
      criteria: [{ attribute: 'sku', values: [skuOf('Cookeo+ Connect')] }],
      locationIds: [],
      mode: 'quantity',
      values: pct(100, 50, 20),
      thresholds: { brand_site: 20, marketplace: 10, social: 5 },
      period: { type: 'range', start: '2026-09-01', end: '2026-12-31' },
      updatedAt,
    },
    {
      id: 'rule-2',
      name: 'Calor irons – marketplace push',
      priority: 2,
      enabled: true,
      criteria: [
        { attribute: 'category', values: ['Irons'] },
        { attribute: 'brand', values: ['Calor'] },
      ],
      locationIds: [],
      mode: 'percentage',
      values: pct(30, 40, 10),
      thresholds: noThresholds,
      period: { type: 'always' },
      updatedAt,
    },
    {
      id: 'rule-3',
      name: 'Air fryers',
      priority: 3,
      enabled: true,
      criteria: [{ attribute: 'category', values: ['Air fryers'] }],
      locationIds: [],
      mode: 'percentage',
      values: pct(50, 20, 10),
      thresholds: { brand_site: 20, marketplace: null, social: null },
      period: { type: 'always' },
      updatedAt,
    },
    {
      id: 'rule-4',
      name: 'Vacuum cleaners – Alençon',
      priority: 4,
      enabled: true,
      criteria: [{ attribute: 'category', values: ['Vacuum cleaners'] }],
      locationIds: ['loc-0001'],
      mode: 'quantity',
      values: pct(30, 20, 10),
      thresholds: { brand_site: 10, marketplace: 10, social: 5 },
      period: { type: 'always' },
      updatedAt,
    },
    {
      id: 'rule-5',
      name: 'AW26 collection',
      priority: 5,
      enabled: true,
      criteria: [{ attribute: 'season', values: ['AW26'] }],
      locationIds: [],
      mode: 'percentage',
      values: pct(40, 30, 20),
      thresholds: noThresholds,
      period: { type: 'range', start: '2026-09-01', end: '2027-02-28' },
      updatedAt,
    },
    {
      id: 'rule-6',
      name: 'Cookware – social test',
      priority: 6,
      enabled: false,
      criteria: [
        { attribute: 'category', values: ['Cookware'] },
        { attribute: 'brand', values: ['Tefal'] },
      ],
      locationIds: ['loc-0001', 'loc-0003'],
      mode: 'percentage',
      values: pct(20, 0, 30),
      thresholds: noThresholds,
      period: { type: 'always' },
      updatedAt,
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

const seg = (quantity: number, threshold: number | null = null) => ({ quantity, threshold });

/** Manually segmented allocations, values from the mockups. */
function mockupAllocations(item: Item): Allocation[] {
  const base = (locationId: string, totalStock: number, b: number, m: number, s: number): Allocation => ({
    itemId: item.id,
    locationId,
    totalStock,
    period: { type: 'always' },
    segments: { brand_site: seg(b), marketplace: seg(m), social: seg(s) },
    source: { type: 'manual' },
  });
  const rows = [
    base('loc-0001', 1000, 300, 100, 50),
    base('loc-0002', 400, 200, 50, 50),
    base('loc-0003', 200, 100, 0, 0),
  ];
  if (item.id === 'item-001') {
    rows[1] = {
      ...base('loc-0002', 305, 5, 50, 50),
      period: { type: 'range', start: '2026-02-11', end: '2026-06-13' },
      segments: { brand_site: seg(5, 10), marketplace: seg(50, 10), social: seg(50, 10) },
    };
    rows[2] = base('loc-0003', 200, 200, 0, 0);
  }
  return rows;
}

/** Initial stock, segmented as a stock import would have done with the rules. */
export function buildAllocations(rules: SegmentationRule[]): Allocation[] {
  const random = rng(42);
  return ITEMS.flatMap((item, i) => {
    if (i < 3) return mockupAllocations(item);
    return LOCATIONS.map((loc) => {
      const stock: Allocation = {
        itemId: item.id,
        locationId: loc.id,
        totalStock: Math.round(random() * 60) * 10,
        period: { type: 'always' },
        segments: segmentRecord(() => seg(0)),
        source: { type: 'none' },
      };
      const rule = effectiveRule(rules, item, loc.id);
      return rule ? applyRuleToAllocation(stock, rule).allocation : unallocated(stock);
    });
  });
}
