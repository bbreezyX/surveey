import type { StatusFilter } from '../../shared/survey/types';
// A phone throws away a background tab when it runs short of memory: a crew taps Lapor, reports on
// esdm.cloud/lapangan with the camera, and comes back to a page loaded from scratch. The view they left
// is kept here when the page is hidden so that reload lands on the same point. localStorage rather than
// sessionStorage, because a home-screen app that the system killed reopens at start_url with a new session.
export interface SavedView { at: number; selected: string | null; region: string | null; filter: StatusFilter; query: string; panel: boolean; center: [number, number] | null; zoom: number | null }
// Long enough for a report with photos; a reader opening the map the next day starts from the province view.
export const VIEW_MAX_AGE_MS = 30 * 60_000;
const KEY = 'puts.view';
const FILTERS: StatusFilter[] = [null, 'cadangan', 'belum', 'duplikat'];
const text = (value: unknown) => value === null || typeof value === 'string';
export function readSavedView(raw: string | null, now: number): SavedView | null {
  let view: Partial<SavedView>;
  try { view = JSON.parse(raw ?? 'null'); } catch { return null; }
  if (!view || typeof view.at !== 'number' || view.at > now || now - view.at > VIEW_MAX_AGE_MS) return null;
  const center = view.center, mapped = center === null ? view.zoom === null : Array.isArray(center) && center.length === 2 && center.every(Number.isFinite) && Number.isFinite(view.zoom);
  if (!text(view.selected) || !text(view.region) || typeof view.query !== 'string' || typeof view.panel !== 'boolean' || !FILTERS.includes(view.filter as StatusFilter) || !mapped) return null;
  return view as SavedView;
}
export function recallView(): SavedView | null {
  try { return readSavedView(localStorage.getItem(KEY), Date.now()); } catch { return null; }
}
export function rememberView(view: Omit<SavedView, 'at'>) {
  try { localStorage.setItem(KEY, JSON.stringify({ at: Date.now(), ...view })); } catch { /* Storage blocked: a reload starts from the province view, as before. */ }
}
