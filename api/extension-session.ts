import { body, HttpError, route } from './_lib/db.js';
import { checkExtensionSignature, signSession } from './_lib/session.js';

/**
 * OneStock UI Extension: opens a session for the context given by OneStock.
 * POST { extension_id, user_id, site_id, extension_signature } (URL parameters + handshake data)
 * → { token, exp, site_id }: short session (JWT), sent as `Authorization: Bearer` by the application.
 * The signature proves that OneStock loaded the extension for this user (ONESTOCK_EXTENSION_SECRET);
 * ONESTOCK_EXTENSION_SITES (comma separated, optional) restricts the sites that may open a session.
 */
interface Input {
  extension_id?: string;
  user_id?: string;
  site_id?: string;
  extension_signature?: string;
}

export default route(
  {
    POST: async (req) => {
      const b = body<Input>(req);
      const extensionId = String(b.extension_id ?? '').trim();
      const userId = String(b.user_id ?? '').trim();
      const siteId = String(b.site_id ?? '').trim();
      if (!extensionId || !userId || !siteId || !b.extension_signature)
        throw new HttpError(400, 'extension_id, user_id, site_id and extension_signature are required');
      checkExtensionSignature(b.extension_signature, extensionId, userId);
      const sites = (process.env.ONESTOCK_EXTENSION_SITES ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      if (sites.length && !sites.includes(siteId)) throw new HttpError(403, `Site ${siteId} is not allowed for this extension`);
      const { token, exp } = await signSession({ site_id: siteId, user_id: userId, extension_id: extensionId });
      return { token, exp, site_id: siteId };
    },
  },
  { auth: false },
);
