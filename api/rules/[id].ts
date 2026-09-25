import { body, param, route } from '../_lib/db.js';
import { deleteRule, getRule, updateRule } from '../_lib/rules.js';

export default route({
  GET: (req) => getRule(param(req, 'id')),
  PUT: (req) => updateRule(param(req, 'id'), body(req)),
  DELETE: async (req) => {
    await deleteRule(param(req, 'id'));
    return { ok: true };
  },
});
