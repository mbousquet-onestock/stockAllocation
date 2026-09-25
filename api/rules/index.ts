import { body, route, siteOf } from '../_lib/db.js';
import { insertRule, listRules, reorderRules, replaceRules } from '../_lib/rules.js';

/** Rules of the site given by the x-site-id header. */
export default route({
  /** All rules, by priority. */
  GET: (req) => listRules(siteOf(req)),
  /** Creates a rule (last priority unless given). */
  POST: (req) => insertRule(siteOf(req), body(req)),
  /** { order: string[] } sets the priority order; { rules: Rule[] } replaces every rule. */
  PUT: async (req) => {
    const site = siteOf(req);
    const b = body<{ order?: string[]; rules?: Record<string, unknown>[] }>(req);
    if (b.rules) await replaceRules(site, b.rules);
    else if (b.order) await reorderRules(site, b.order);
    return listRules(site);
  },
});
