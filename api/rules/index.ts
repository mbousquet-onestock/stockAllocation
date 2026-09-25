import { body, route } from '../_lib/db.js';
import { insertRule, listRules, reorderRules, replaceRules } from '../_lib/rules.js';

export default route({
  /** All rules, by priority. */
  GET: () => listRules(),
  /** Creates a rule (last priority unless given). */
  POST: (req) => insertRule(body(req)),
  /** { order: string[] } sets the priority order; { rules: Rule[] } replaces every rule. */
  PUT: async (req) => {
    const b = body<{ order?: string[]; rules?: Record<string, unknown>[] }>(req);
    if (b.rules) await replaceRules(b.rules);
    else if (b.order) await reorderRules(b.order);
    return listRules();
  },
});
