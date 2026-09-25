/**
 * Site the data belongs to: the OneStock site_id of Settings → OneStock API (read directly from the browser storage
 * to avoid module cycles). Sent to the database API in the x-site-id header.
 */
export function currentSiteId(): string {
  try {
    const raw = localStorage.getItem('stock-allocation:onestock-config');
    return raw ? String((JSON.parse(raw) as { siteId?: string }).siteId ?? '').trim() : '';
  } catch {
    return '';
  }
}

export const siteHeader = (): Record<string, string> => {
  const site = currentSiteId();
  return site ? { 'x-site-id': site } : {};
};
