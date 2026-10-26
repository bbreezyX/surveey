import type { SurveyDataset, StatusFilter } from '../../shared/survey/types';
import { matchesQuery } from '../../shared/survey/search';
import { countOfficialPoints, STATUS_LABEL } from '../../shared/survey/status';
import type { SurveyPending, SurveyProgress } from '../../shared/survey/progress';
import type { SavedView } from './view-memory';
const collator = new Intl.Collator('id', { numeric: true, sensitivity: 'base' });
export function createSurveyState(initial: SurveyDataset) {
  // Replaced in place when a reconnect brings newer data, so the open region, search, filter, selected
  // point and layer switches all survive; only the points under them change.
  let dataset = $state.raw(initial), storedAt = $state(initial.storedAt ?? null);
  let query = $state(''), activeRegion = $state<string | null>(null), statusFilter = $state<StatusFilter>(null), selectedNomor = $state<string | null>(null);
  let selectionOrigin = $state.raw<HTMLElement | null>(null);
  // Null until esdm.cloud answers; the map, list and popup show no build status before then.
  let progress = $state.raw<SurveyProgress | null>(null);
  let pending = $state.raw<SurveyPending | null>(null);
  let fitRevision = $state(0), fitReason = $state<'initial' | 'region' | 'search' | 'filter'>('initial');
  let panelOpen = $state(false), sidebarCollapsed = $state(false);
  // The card of the detail just closed is marked briefly so the eye lands on it, then lets go.
  let recentNomor = $state<string | null>(null), recentTimer: ReturnType<typeof setTimeout> | undefined;
  // The map position a reload resumes from, read once when the map is built; null fits the points as usual.
  let initialView: { center: [number, number]; zoom: number } | null = null;
  const layers = $state({ google: true, esri: false, boundaries: true, mask: true, area: false, sk: true, cadangan: false, belum: true });
  // Once esdm.cloud has accepted any build stage for a shared-coordinate unit, the crew has found and dug
  // its spot, so asking readers to confirm it with the RT/desa no longer helps; the list, filter, counts and
  // popup then treat it as an ordinary SK point. Only those few points are copied, the rest keep their objects.
  const points = $derived([...dataset.points].map(point => point.duplikat && progress?.get(point.nomor) ? { ...point, duplikat: false, searchText: point.searchText.replace(STATUS_LABEL.duplikat.search, '') } : point).sort((a, b) => collator.compare(a.nomor, b.nomor)));
  const regionNames = $derived([...new Set(points.map(point => point.kabupaten))].sort((a, b) => Number(/^Kota\s/i.test(b)) - Number(/^Kota\s/i.test(a)) || collator.compare(a, b)));
  const visiblePoints = $derived(points.filter(point => (!activeRegion || point.kabupaten === activeRegion) && (!statusFilter || point[statusFilter]) && matchesQuery(point, query)));
  const visibleIds = $derived(new Set(visiblePoints.map(point => point.nomor)));
  const selected = $derived(points.find(point => point.nomor === selectedNomor) ?? null);
  return {
    layers,
    get dataset() { return dataset; }, get points() { return points; }, get regionNames() { return regionNames; },
    // When the points on screen are the service worker's stored copy (ms since epoch); null when fresh.
    get storedAt() { return storedAt; },
    replaceDataset(next: SurveyDataset) {
      storedAt = next.storedAt ?? null;
      // Unchanged points keep their objects, so nothing downstream (map features, list) rebuilds.
      if (!next.signature || next.signature !== dataset.signature) dataset = next;
    },
    get query() { return query; }, set query(value: string) { if (value !== query) { query = value; recentNomor = null; fitReason = 'search'; fitRevision++; } },
    get fitRevision() { return fitRevision; }, get fitReason() { return fitReason; },
    get activeRegion() { return activeRegion; }, get statusFilter() { return statusFilter; },
    get selectionOrigin() { return selectionOrigin; },
    get progress() { return progress; }, set progress(value: SurveyProgress | null) { progress = value; },
    get pending() { return pending; }, set pending(value: SurveyPending | null) { pending = value; },
    get recentNomor() { return recentNomor; },
    get selectedNomor() { return selectedNomor; }, get selected() { return selected; },
    get visiblePoints() { return visiblePoints; }, get visibleIds() { return visibleIds; },
    get count() { return countOfficialPoints(visiblePoints); },
    get panelOpen() { return panelOpen; }, set panelOpen(value: boolean) { panelOpen = value; },
    get initialView() { return initialView; },
    // Reopens what the reader had on screen before the phone dropped the tab. Set directly rather than
    // through openRegion/query, which would refit the map away from the position being restored; a
    // kabupaten or point no longer in the data is left out.
    restore(view: SavedView) {
      if (view.region && regionNames.includes(view.region)) activeRegion = view.region;
      statusFilter = view.filter; query = view.query;
      if (view.selected && visiblePoints.some(point => point.nomor === view.selected)) selectedNomor = view.selected; else panelOpen = view.panel;
      initialView = view.center && view.zoom !== null ? { center: view.center, zoom: view.zoom } : null;
    },
    // A link naming a point (?nomor=) wins over the restored view: its kabupaten opens with nothing
    // filtered out, and the map goes to the point rather than the position being resumed.
    openLinked(nomor: string) {
      const point = points.find(item => item.nomor === nomor);
      if (!point) return false;
      activeRegion = point.kabupaten; statusFilter = null; query = ''; panelOpen = false; initialView = null;
      selectedNomor = point.nomor; return true;
    },
    get sidebarCollapsed() { return sidebarCollapsed; }, set sidebarCollapsed(value: boolean) { sidebarCollapsed = value; },
    openRegion(name: string | null, filter: StatusFilter = null, preserveQuery = false) { recentNomor = null; activeRegion = name; statusFilter = filter; selectedNomor = null; if (!preserveQuery) query = ''; fitReason = 'region'; fitRevision++; },
    setFilter(filter: StatusFilter) { recentNomor = null; statusFilter = filter; selectedNomor = null; fitReason = 'filter'; fitRevision++; },
    select(nomor: string | null, origin: HTMLElement | null = null) {
      if (nomor) { recentNomor = null; selectionOrigin = origin; panelOpen = false; }
      selectedNomor = nomor;
    },
    // Closing a detail leaves the reader on the map. On phones it used to pull the list sheet back up
    // over the map whenever a kabupaten or search was open, which a ?nomor= link always opens, so the
    // map the reader had just closed the card to see disappeared again. The list opens on request only.
    closeDetail() {
      const point = selected;
      selectedNomor = null; recentNomor = point?.nomor ?? null;
      clearTimeout(recentTimer); recentTimer = setTimeout(() => { recentNomor = null; }, 2800);
    },
  };
}
export type SurveyState = ReturnType<typeof createSurveyState>;
