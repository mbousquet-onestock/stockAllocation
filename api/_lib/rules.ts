import { adoptLegacyRows, HttpError, sql } from './db.js';

/** Segmentation rule as stored: the full rule JSON, with id and priority as columns, scoped by site. */
export interface StoredRule {
  id: string;
  priority: number;
  updatedAt: string;
  [key: string]: unknown;
}

const REQUIRED = ['name', 'enabled', 'criteria', 'stockTypeIds', 'purchaseOrders', 'locationIds', 'shares', 'thresholds', 'period'];

/** Shape check only: business validation (percentages, purchase orders…) is done by the application. */
export function checkRule(rule: Record<string, unknown>) {
  const missing = REQUIRED.filter((k) => !(k in rule));
  if (missing.length) throw new HttpError(400, `Missing fields: ${missing.join(', ')}`);
  if (typeof rule.name !== 'string' || !rule.name.trim()) throw new HttpError(400, 'The rule needs a name');
  if (!Array.isArray(rule.criteria) || !rule.criteria.length) throw new HttpError(400, 'The rule needs criteria');
}

type Row = { id: string; priority: number; data: Record<string, unknown>; updated_at: Date };

const toRule = (r: Row): StoredRule => ({ ...r.data, id: r.id, priority: r.priority, updatedAt: r.updated_at.toISOString() });

export async function listRules(site: string): Promise<StoredRule[]> {
  await adoptLegacyRows('segmentation_rules', site);
  const rows = await sql()<Row[]>`
    select id, priority, data, updated_at from segmentation_rules where site_id = ${site} order by priority, id`;
  return rows.map(toRule);
}

export async function getRule(site: string, id: string): Promise<StoredRule> {
  const [row] = await sql()<Row[]>`select id, priority, data, updated_at from segmentation_rules where site_id = ${site} and id = ${id}`;
  if (!row) throw new HttpError(404, `Rule ${id} not found`);
  return toRule(row);
}

/** Business fields only: id, priority and updatedAt are columns. */
function dataOf(rule: Record<string, unknown>) {
  const { id: _id, priority: _priority, updatedAt: _updatedAt, ...data } = rule;
  return data;
}

export async function insertRule(site: string, rule: Record<string, unknown>): Promise<StoredRule> {
  checkRule(rule);
  const id = typeof rule.id === 'string' && rule.id ? rule.id : `rule-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const [{ next }] = await sql()<{ next: number }[]>`
    select coalesce(max(priority), 0) + 1 as next from segmentation_rules where site_id = ${site}`;
  const priority = typeof rule.priority === 'number' ? rule.priority : next;
  const [row] = await sql()<Row[]>`
    insert into segmentation_rules (site_id, id, priority, data)
    values (${site}, ${id}, ${priority}, ${sql().json(dataOf(rule) as never)})
    returning id, priority, data, updated_at`;
  return toRule(row);
}

export async function updateRule(site: string, id: string, rule: Record<string, unknown>): Promise<StoredRule> {
  checkRule(rule);
  const [row] = await sql()<Row[]>`
    update segmentation_rules set data = ${sql().json(dataOf(rule) as never)}, updated_at = now()
    where site_id = ${site} and id = ${id}
    returning id, priority, data, updated_at`;
  if (!row) throw new HttpError(404, `Rule ${id} not found`);
  return toRule(row);
}

export async function deleteRule(site: string, id: string) {
  await sql()`delete from segmentation_rules where site_id = ${site} and id = ${id}`;
  // Keep priorities contiguous (1..n).
  await sql()`
    update segmentation_rules r set priority = o.rn
    from (select id, row_number() over (order by priority, id) as rn from segmentation_rules where site_id = ${site}) o
    where r.site_id = ${site} and r.id = o.id`;
}

/** Sets the priority order: ids in their new order. */
export async function reorderRules(site: string, ids: string[]) {
  await sql().begin(async (tx) => {
    for (const [i, id] of ids.entries())
      await tx`update segmentation_rules set priority = ${i + 1} where site_id = ${site} and id = ${id}`;
  });
}

/** Replaces every rule of the site (import of the local rules). */
export async function replaceRules(site: string, rules: Record<string, unknown>[]) {
  rules.forEach(checkRule);
  await sql().begin(async (tx) => {
    await tx`delete from segmentation_rules where site_id = ${site}`;
    for (const [i, rule] of rules.entries()) {
      await tx`
        insert into segmentation_rules (site_id, id, priority, data)
        values (${site}, ${String(rule.id)}, ${i + 1}, ${tx.json(dataOf(rule) as never)})`;
    }
  });
}
