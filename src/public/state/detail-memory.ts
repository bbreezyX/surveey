// A phone throws away a background tab when it runs short of memory: a crew goes to the camera, Google Maps
// or esdm.cloud/lapangan and comes back to a page loaded from scratch, then has to pinch the whole province
// back down to where they stand. The detail still open when the page was left is kept here so the reload
// lands on it; with no detail open a reload starts from the province view. localStorage rather than
// sessionStorage, because a home-screen app the system killed reopens at start_url with a new session.
// Long enough for a report with photos; a reader opening the map the next day starts from the province view.
export const DETAIL_MAX_AGE_MS = 30 * 60_000;
const KEY = 'puts.open-detail';
export function readOpenDetail(raw: string | null, now: number): string | null {
  let saved: { at?: unknown; nomor?: unknown } | null;
  try { saved = JSON.parse(raw ?? 'null'); } catch { return null; }
  if (!saved || typeof saved.at !== 'number' || saved.at > now || now - saved.at > DETAIL_MAX_AGE_MS) return null;
  return typeof saved.nomor === 'string' && saved.nomor ? saved.nomor : null;
}
export function recallOpenDetail(): string | null {
  try { return readOpenDetail(localStorage.getItem(KEY), Date.now()); } catch { return null; }
}
export function rememberOpenDetail(nomor: string | null) {
  try { if (nomor) localStorage.setItem(KEY, JSON.stringify({ at: Date.now(), nomor })); else localStorage.removeItem(KEY); } catch { /* Storage blocked: a reload starts from the province view, as before. */ }
}
