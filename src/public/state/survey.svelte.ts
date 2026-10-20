import type { SurveyDataset, StatusFilter } from '../../shared/survey/types';
import { matchesQuery } from '../../shared/survey/search';
import { countOfficialPoints } from '../../shared/survey/status';
import type { SurveyProgress } from '../../shared/survey/progress';
const collator = new Intl.Collator('id', { numeric: true, sensitivity: 'base' });
export function createSurveyState(dataset: SurveyDataset) {
  let query = $state(''), activeRegion = $state<string | null>(null), statusFilter = $state<StatusFilter>(null), selectedNomor = $state<string | null>(null);
  let selectionOrigin = $state.raw<HTMLElement | null>(null);
  // Null until esdm.cloud answers; the map, list and popup show no build status before then.
  let progress = $state.raw<SurveyProgress | null>(null);
  let fitRevision = $state(0), fitReason = $state<'initial' | 'region' | 'search' | 'filter'>('initial');
  let panelOpen = $state(false), sidebarCollapsed = $state(false);
  // A detail opened from list cards, or from a map tap that hit several nearby pins, returns to the mobile list when closed.
  let returnToList = false;
  // The card of the detail just closed is marked briefly so the eye lands on it, then lets go.
  let recentNomor = $state<string | null>(null), recentTimer: ReturnType<typeof setTimeout> | undefined;
  const layers = $state({ google: true, esri: false, boundaries: true, mask: true, area: false, sk: true, cadangan: false, belum: true });
  const points = [...dataset.points].sort((a, b) => collator.compare(a.nomor, b.nomor));
  const regionNames = [...new Set(points.map(point => point.kabupaten))].sort((a, b) => Number(/^Kota\s/i.test(b)) - Number(/^Kota\s/i.test(a)) || collator.compare(a, b));
  const visiblePoints = $derived(points.filter(point => (!activeRegion || point.kabupaten === activeRegion) && (!statusFilter || point[statusFilter]) && matchesQuery(point, query)));
  const visibleIds = $derived(new Set(visiblePoints.map(point => point.nomor)));
  const selected = $derived(points.find(point => point.nomor === selectedNomor) ?? null);
  return {
    dataset, points, regionNames, layers,
    get query() { return query; }, set query(value: string) { if (value !== query) { query = value; recentNomor = null; fitReason = 'search'; fitRevision++; } },
    get fitRevision() { return fitRevision; }, get fitReason() { return fitReason; },
    get activeRegion() { return activeRegion; }, get statusFilter() { return statusFilter; },
    get selectionOrigin() { return selectionOrigin; },
    get progress() { return progress; }, set progress(value: SurveyProgress | null) { progress = value; },
    get recentNomor() { return recentNomor; },
    get selectedNomor() { return selectedNomor; }, get selected() { return selected; },
    get visiblePoints() { return visiblePoints; }, get visibleIds() { return visibleIds; },
    get count() { return countOfficialPoints(visiblePoints); },
    get panelOpen() { return panelOpen; }, set panelOpen(value: boolean) { panelOpen = value; },
    get sidebarCollapsed() { return sidebarCollapsed; }, set sidebarCollapsed(value: boolean) { sidebarCollapsed = value; },
    openRegion(name: string | null, filter: StatusFilter = null, preserveQuery = false) { recentNomor = null; activeRegion = name; statusFilter = filter; selectedNomor = null; if (!preserveQuery) query = ''; fitReason = 'region'; fitRevision++; },
    setFilter(filter: StatusFilter) { recentNomor = null; statusFilter = filter; selectedNomor = null; fitReason = 'filter'; fitRevision++; },
    select(nomor: string | null, origin: HTMLElement | null = null, nearby = false) {
      // Tapping another pin while a list-opened detail is showing keeps the way back to that list.
      if (nomor) { recentNomor = null; returnToList = !!origin || nearby || (returnToList && !!selectedNomor); selectionOrigin = origin; panelOpen = false; } else returnToList = false;
      selectedNomor = nomor;
    },
    closeDetail(reopenList: boolean) {
      // An opened kabupaten or search already lists point cards, so any closed detail goes back to them.
      const point = selected, reopen = reopenList && !!point && (returnToList || !!activeRegion || !!query);
      selectedNomor = null; returnToList = false; recentNomor = point?.nomor ?? null;
      clearTimeout(recentTimer); recentTimer = setTimeout(() => { recentNomor = null; }, 2800);
      if (!reopen || !point) return null;
      // The region grid has no point cards, so open the point's kabupaten without refitting the map the user was reading.
      if (!activeRegion && !query) { activeRegion = point.kabupaten; statusFilter = null; }
      panelOpen = true; return point.nomor;
    },
  };
}
export type SurveyState = ReturnType<typeof createSurveyState>;
