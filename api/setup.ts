import { ensureSchema, route } from './_lib/db.js';

/** Creates the tables (idempotent). */
export default route({
  POST: async () => {
    await ensureSchema();
    return { ok: true };
  },
});
