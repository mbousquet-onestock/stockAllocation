import { segmentRecord } from '../config/segments';
import type { Allocation, Item, StockLocation } from '../types';

export const LOCATIONS: StockLocation[] = [
  { id: 'loc-0001', code: '0001', name: 'Alençon' },
  { id: 'loc-0002', code: '0002', name: 'Sered' },
  { id: 'loc-0003', code: '0003', name: 'Toledo' },
];

const CATALOG: Array<[string, string, number, string[]]> = [
  // name, category, price, attributes
  ['DUAL EASY FRY & GRILL 8,3 L AIR FRYER', 'Air fryers', 199.99, ['8,3 l']],
  ['Ultragliss Anti-Calc Plus, Fer à Repasser Vapeur, 50 g/min, Pressing 250 g/min', 'Irons', 69.99, ['2800 W']],
  ['Crêpière Billig', 'Crêpe makers', 49.99, ['Ø 36 cm']],
  ['EASY FRY MAX 5 L AIR FRYER', 'Air fryers', 129.99, ['5 l']],
  ['EASY FRY OVEN & GRILL 2-IN-1', 'Air fryers', 179.99, ['4,2 l']],
  ['Actifry Genius XL', 'Air fryers', 249.99, ['1,7 kg']],
  ['Easygliss Plus Fer Vapeur', 'Irons', 49.99, ['2500 W']],
  ['Puregliss Fer Vapeur', 'Irons', 89.99, ['3000 W']],
  ['Pro Express Vision Centrale Vapeur', 'Irons', 399.99, ['7,5 bars']],
  ['Crêpière Party Colormania', 'Crêpe makers', 39.99, ['6 crêpes']],
  ['Crep\'Party Dual', 'Crêpe makers', 59.99, ['2-en-1']],
  ['Cookeo Touch Pro Multicuiseur', 'Multicookers', 329.99, ['6 l']],
  ['Cookeo+ Connect', 'Multicookers', 249.99, ['6 l']],
  ['Companion XL Robot Cuiseur', 'Multicookers', 699.99, ['4,5 l']],
  ['Nutri Pro Blender', 'Blenders', 89.99, ['1 l']],
  ['Perfectmix Cook Blender Chauffant', 'Blenders', 199.99, ['1,75 l']],
  ['X-Force Flex 12.60 Aspirateur Balai', 'Vacuum cleaners', 399.99, ['0,9 l']],
  ['X-Pert 6.60 Aspirateur Balai', 'Vacuum cleaners', 229.99, ['0,5 l']],
  ['Silence Force Aspirateur Traîneau', 'Vacuum cleaners', 199.99, ['4,5 l']],
  ['Ingenio Poêle 28 cm', 'Cookware', 34.99, ['Ø 28 cm']],
  ['Ingenio Set 13 pièces', 'Cookware', 149.99, ['13 pcs']],
  ['Talent Pro Casserole 20 cm', 'Cookware', 39.99, ['Ø 20 cm']],
  ['Optigrill Elite', 'Grills', 249.99, ['12 programmes']],
  ['Optigrill+ XL', 'Grills', 199.99, ['8 programmes']],
  ['Plancha Malaga', 'Grills', 89.99, ['2000 W']],
  ['Grille-pain Subito', 'Breakfast', 49.99, ['2 fentes']],
  ['Bouilloire Vitesse Réglable', 'Breakfast', 59.99, ['1,7 l']],
  ['Cafetière Filtre Subito Mug', 'Breakfast', 39.99, ['1,25 l']],
];

const pad = (n: number, len: number) => String(n).padStart(len, '0');

export const ITEMS: Item[] = CATALOG.map(([name, category, price, attributes], i) => ({
  id: `item-${pad(i + 1, 3)}`,
  sku: `10821080${pad(10944 - i * 7, 5)}`,
  name,
  category,
  price,
  attributes,
}));
// Keep SKUs from the mockups for the first three items.
ITEMS[0].sku = '1082108010944';
ITEMS[1].sku = '1082108010906';
ITEMS[2].sku = '1082108010913';

/** Deterministic pseudo random generator so data is stable between reloads. */
function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

const seg = (quantity: number, threshold: number | null = null) => ({ quantity, threshold });

function mockupAllocations(item: Item): Allocation[] {
  // Values from the mockups.
  const base = (locationId: string, totalStock: number, b: number, m: number, s: number): Allocation => ({
    itemId: item.id,
    locationId,
    totalStock,
    period: { type: 'always' },
    segments: { brand_site: seg(b), marketplace: seg(m), social: seg(s) },
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

export function buildAllocations(): Allocation[] {
  const random = rng(42);
  return ITEMS.flatMap((item, i) => {
    if (i < 3) return mockupAllocations(item);
    return LOCATIONS.map((loc) => {
      const totalStock = Math.round(random() * 60) * 10;
      const segmented = random() > 0.3;
      const pick = (max: number) => Math.floor(random() * max);
      const b = segmented ? Math.floor(totalStock * (0.2 + pick(4) / 10)) : 0;
      const m = segmented ? Math.floor((totalStock - b) * (pick(5) / 10)) : 0;
      const s = segmented ? Math.floor((totalStock - b - m) * (pick(4) / 10)) : 0;
      const withThreshold = random() > 0.6;
      const belowThreshold = withThreshold && random() > 0.85;
      return {
        itemId: item.id,
        locationId: loc.id,
        totalStock,
        period: { type: 'always' as const },
        segments: segmentRecord((id) => {
          const q = id === 'brand_site' ? b : id === 'marketplace' ? m : s;
          return seg(q, withThreshold ? (belowThreshold ? q + 10 : Math.max(0, Math.floor(q / 2))) : null);
        }),
      };
    });
  });
}
