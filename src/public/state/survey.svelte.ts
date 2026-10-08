import type { SurveyDataset, StatusFilter } from '../../shared/survey/types';
import { matchesQuery } from '../../shared/survey/search';
import { countOfficialPoints } from '../../shared/survey/status';
const collator = new Intl.Collator('id', { numeric: true, sensitivity: 'base' });
export function createSurveyState(dataset: SurveyDataset) {
  let query = $state(''), activeRegion = $state<string | null>(null), statusFilter = $state<StatusFilter>(null), selectedNomor = $state<string | null>(null);
  let selectionOrigin = $state.raw<HTMLElement | null>(null);
  let fitRevision = $state(0), fitReason = $state<'initial' | 'region' | 'search' | 'filter'>('initial');
  let panelOpen = $state(false), sidebarCollapsed = $state(false);
  const layers = $state({ google: true, esri: false, boundaries: true, mask: true, area: false, sk: true, cadangan: false, belum: true });
  const points = [...dataset.points].sort((a, b) => collator.compare(a.nomor, b.nomor));
  const regionNames = [...new Set(points.map(point => point.kabupaten))].sort((a, b) => Number(/^Kota\s/i.test(b)) - Number(/^Kota\s/i.test(a)) || collator.compare(a, b));
  const visiblePoints = $derived(points.filter(point => (!activeRegion || point.kabupaten === activeRegion) && (!statusFilter || point[statusFilter]) && matchesQuery(point, query)));
  const visibleIds = $derived(new Set(visiblePoints.map(point => point.nomor)));
  const selected = $derived(points.find(point => point.nomor === selectedNomor) ?? null);
  return {
    dataset, points, regionNames, layers,
    get query() { return query; }, set query(value: string) { if (value !== query) { query = value; fitReason = 'search'; fitRevision++; } },
    get fitRevision() { return fitRevision; }, get fitReason() { return fitReason; },
    get activeRegion() { return activeRegion; }, get statusFilter() { return statusFilter; },
    get selectionOrigin() { return selectionOrigin; },
    get selectedNomor() { return selectedNomor; }, get selected() { return selected; },
    get visiblePoints() { return visiblePoints; }, get visibleIds() { return visibleIds; },
    get count() { return countOfficialPoints(visiblePoints); },
    get panelOpen() { return panelOpen; }, set panelOpen(value: boolean) { panelOpen = value; },
    get sidebarCollapsed() { return sidebarCollapsed; }, set sidebarCollapsed(value: boolean) { sidebarCollapsed = value; },
    openRegion(name: string | null, filter: StatusFilter = null, preserveQuery = false) { activeRegion = name; statusFilter = filter; selectedNomor = null; if (!preserveQuery) query = ''; fitReason = 'region'; fitRevision++; },
    setFilter(filter: StatusFilter) { statusFilter = filter; selectedNomor = null; fitReason = 'filter'; fitRevision++; },
    select(nomor: string | null, origin: HTMLElement | null = null) { selectedNomor = nomor; if (nomor) { selectionOrigin = origin; panelOpen = false; } },
  };
}
export type SurveyState = ReturnType<typeof createSurveyState>;
