import { body, param, route, siteOf } from '../_lib/db.js';
import { deleteRule, getRule, updateRule } from '../_lib/rules.js';

export default route({
  GET: (req) => getRule(siteOf(req), param(req, 'id')),
  PUT: (req) => updateRule(siteOf(req), param(req, 'id'), body(req)),
  DELETE: async (req) => {
    await deleteRule(siteOf(req), param(req, 'id'));
    return { ok: true };
  },
});
