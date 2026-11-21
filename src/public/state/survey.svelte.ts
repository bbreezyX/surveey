import type { SurveyDataset, SurveyPoint, StatusFilter } from '../../shared/survey/types';
import { matchesQuery } from '../../shared/survey/search';
import { countOfficialPoints, STATUS_LABEL } from '../../shared/survey/status';
import { matchesStageFilter, reportReceipt, type StageFilter, type SurveyPending, type SurveyProgress, type SurveyToday } from '../../shared/survey/progress';
import type { LastReport, ListMode, WorkMemory } from './work-memory';
import { distanceMeters } from './nearby';
export type SheetSnap = 'closed' | 'half' | 'full';
const collator = new Intl.Collator('id', { numeric: true, sensitivity: 'base' });
// How close another unit must be for a flagged pin to still count as shared. The stacks in the data are
// either one coordinate repeated or 3.6-4.8 m apart (two photos within a phone's GPS accuracy), while
// separate units on one road sit 9 m apart at the closest, so 8 m tells the two apart. A partner moved by
// less than that is still on the same spot as far as the GPS can say.
const STACK_METERS = 8;
// Flagged units that still share their pin with another counted unit. Reserves are left out: they are
// outside the allocation and only installed if another unit is cancelled, so they compete for no pin.
// Only the dozen flagged units are measured, against every other unit, which stays cheap.
function stillStacked(points: readonly SurveyPoint[]): ReadonlySet<string> {
  const counted = points.filter(point => !point.cadangan && Number.isFinite(point.latNum) && Number.isFinite(point.lonNum));
  return new Set(counted.filter(point => point.duplikat && counted.some(other => other !== point &&
    distanceMeters(point.latNum, point.lonNum, other.latNum, other.lonNum) <= STACK_METERS)).map(point => point.nomor));
}
// memory: what this phone kept from earlier visits (work-memory.ts); App reads and writes the storage, except the
// basemap, which the layer panel writes when it is picked.
export function createSurveyState(initial: SurveyDataset, memory: WorkMemory = {}) {
  // Replaced in place when a reconnect brings newer data, so the open region, search, filter, selected
  // point and layer switches all survive; only the points under them change.
  let dataset = $state.raw(initial), storedAt = $state(initial.storedAt ?? null);
  let query = $state(''), activeRegion = $state<string | null>(null), statusFilter = $state<StatusFilter>(null), stageFilter = $state<StageFilter | null>(null), selectedNomor = $state<string | null>(null);
  let selectionOrigin = $state.raw<HTMLElement | null>(null);
  // Null until esdm.cloud answers; the map, list and popup show no build status before then.
  let progress = $state.raw<SurveyProgress | null>(null);
  let pending = $state.raw<SurveyPending | null>(null);
  // Units esdm.cloud recorded a stage for today (WIB), for the progress view's "hari ini" marks.
  let today = $state.raw<SurveyToday | null>(null);
  // esdm.cloud did not answer and nothing has been shown yet: the progress view says so rather than leave a
  // still skeleton. Any answer clears it; once progress is shown a later miss keeps the last stages instead.
  let progressFailed = $state(false);
  // The stage a crew says it just reported on esdm.cloud/lapangan (?lapor=), for the point it came back to.
  let reported = $state.raw<{ nomor: string; stage: number } | null>(null);
  const receipt = $derived(reported && progress ? reportReceipt(reported.stage, progress.get(reported.nomor) ?? 0, pending?.get(reported.nomor)) : null);
  // The sidebar's two views: "sebaran" is the atlas and list, "progres" counts build stages and turns a
  // kabupaten into a work list; every visit starts on "sebaran". lastReport: the last report this phone sent, kept
  // past the card that confirmed it.
  let listMode = $state<ListMode>('sebaran');
  let lastReport = $state.raw<LastReport | null>(memory.lastReport ?? null);
  // Set when the "menunggu diperiksa" line opened the kabupaten, so its waiting group opens first.
  let waitingFirst = $state(false);
  let fitRevision = $state(0), fitReason = $state<'initial' | 'region' | 'search' | 'filter'>('initial');
  let sheetSnap = $state<SheetSnap>('closed'), sidebarCollapsed = $state(false);
  // The card of the detail just closed pulses clearly in the list, then clears automatically after ~2.25 s.
  let recentNomor = $state<string | null>(null), recentTimer: ReturnType<typeof setTimeout> | undefined;
  function markRecent(nomor: string | null) {
    recentNomor = nomor;
    clearTimeout(recentTimer);
    if (nomor) recentTimer = setTimeout(() => { recentNomor = null; }, 2250);
  }
  const google = memory.basemap === 'google';
  const layers = $state({ google, esri: !google, boundaries: true, mask: true, area: false, sk: true, cadangan: false, belum: true });
  // Once esdm.cloud has accepted any build stage for a shared-coordinate unit, the crew has found and dug
  // its spot, so asking readers to confirm it with the RT/desa no longer helps; the list, filter, counts and
  // popup then treat it as an ordinary SK point. Only those few points are copied, the rest keep their objects.
  // The same holds once no other unit is left on its pin: a partner reported and republished elsewhere frees
  // the pin, so it is this unit's alone. A partner reported on the very same pin keeps the mark, since this
  // unit must then stand somewhere else.
  const sortedPoints = $derived([...dataset.points].sort((a, b) => collator.compare(a.nomor, b.nomor)));
  const stackedPoints = $derived(stillStacked(sortedPoints));
  const verifiedPoints = new WeakMap<SurveyPoint, SurveyPoint>();
  let previousPoints: SurveyPoint[] = [];
  const points = $derived.by(() => {
    const next = sortedPoints.map(point => {
      if (!point.duplikat || (stackedPoints.has(point.nomor) && !progress?.get(point.nomor))) return point;
      let verified = verifiedPoints.get(point);
      if (!verified) {
        verified = { ...point, duplikat: false, searchText: point.searchText.replace(STATUS_LABEL.duplikat.search, '') };
        verifiedPoints.set(point, verified);
      }
      return verified;
    });
    // A returning reader fetches a new progress Map even when nothing changed.
    // Keep the point array stable in that case: otherwise map features, labels,
    // region thumbnails and list groups are all rebuilt just to update badges.
    if (next.length === previousPoints.length && next.every((point, index) => point === previousPoints[index])) return previousPoints;
    return previousPoints = next;
  });
  function revealPointInList(point: SurveyPoint) {
    if (point.cadangan && listMode === 'progres') { listMode = 'sebaran'; stageFilter = null; }
    if (!visibleIds.has(point.nomor)) {
      if (activeRegion !== point.kabupaten) activeRegion = point.kabupaten;
      if (statusFilter && !point[statusFilter]) statusFilter = null;
      if (stageFilter !== null && (!progress || !matchesStageFilter(point, stageFilter, progress))) stageFilter = null;
      if (query && !matchesQuery(point, query)) query = '';
    } else if (!activeRegion && !query) {
      activeRegion = point.kabupaten;
    }
  }
  const regionNames = $derived([...new Set(points.map(point => point.kabupaten))].sort((a, b) => Number(/^Kota\s/i.test(b)) - Number(/^Kota\s/i.test(a)) || collator.compare(a, b)));
  const stageFiltered = $derived(listMode === 'progres' && !query && stageFilter !== null && !!progress);
  const visiblePoints = $derived(points.filter(point =>
    (!activeRegion || point.kabupaten === activeRegion) &&
    (!statusFilter || point[statusFilter]) &&
    (!stageFiltered || matchesStageFilter(point, stageFilter!, progress!)) &&
    matchesQuery(point, query),
  ));
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
    get query() { return query; }, set query(value: string) { if (value !== query) { query = value; markRecent(null); fitReason = 'search'; fitRevision++; } },
    get fitRevision() { return fitRevision; }, get fitReason() { return fitReason; },
    get activeRegion() { return activeRegion; }, get statusFilter() { return statusFilter; }, get stageFilter() { return stageFilter; },
    get selectionOrigin() { return selectionOrigin; },
    get progress() { return progress; }, set progress(value: SurveyProgress | null) { progress = value; if (value) progressFailed = false; },
    get progressFailed() { return progressFailed; }, set progressFailed(value: boolean) { progressFailed = value && !progress; },
    get pending() { return pending; }, set pending(value: SurveyPending | null) { pending = value; },
    get today() { return today; }, set today(value: SurveyToday | null) { today = value; },
    // The report the open point's card confirms with a tick, once the feed holds it; gone when the card closes.
    get reportedReceipt() { return reported && receipt && reported.nomor === selectedNomor ? { stage: reported.stage, receipt } : null; },
    // Still unconfirmed: the feed read before the report landed, so it is worth asking again.
    get reportAwaited() { return !!reported && !receipt; },
    markReported(nomor: string, stage: number) { reported = { nomor, stage }; lastReport = { at: Date.now(), nomor, stage }; },
    get lastReport() { return lastReport; },
    get listMode() { return listMode; },
    // Each mode owns its own filter pills: leaving Sebaran clears statusFilter, leaving Progres clears stageFilter,
    // so hidden pins from the other mode never linger on the map.
    set listMode(value: ListMode) {
      let refit = false;
      if (value === 'progres' && statusFilter) { statusFilter = null; refit = true; }
      if (value === 'sebaran' && stageFilter !== null) { stageFilter = null; refit = true; }
      listMode = value;
      if (refit) { fitReason = 'filter'; fitRevision++; }
    },
    get waitingFirst() { return waitingFirst; }, showWaitingFirst() { waitingFirst = true; stageFilter = null; },
    get recentNomor() { return recentNomor; },
    get selectedNomor() { return selectedNomor; }, get selected() { return selected; },
    get visiblePoints() { return visiblePoints; }, get visibleIds() { return visibleIds; },
    get count() { return countOfficialPoints(visiblePoints); },
    get sheetSnap() { return sheetSnap; }, set sheetSnap(value: SheetSnap) { sheetSnap = value; },
    get panelOpen() { return sheetSnap !== 'closed'; }, set panelOpen(value: boolean) { sheetSnap = value ? 'full' : 'closed'; },
    // A link naming a point (?nomor=) opens its kabupaten with nothing filtered out, so the point is in the list.
    openLinked(nomor: string) {
      const point = points.find(item => item.nomor === nomor);
      if (!point) return false;
      markRecent(null); activeRegion = point.kabupaten; statusFilter = null; stageFilter = null; query = ''; sheetSnap = 'closed';
      selectedNomor = point.nomor; return true;
    },
    get sidebarCollapsed() { return sidebarCollapsed; }, set sidebarCollapsed(value: boolean) { sidebarCollapsed = value; },
    openRegion(name: string | null, filter: StatusFilter = null, preserveQuery = false) {
      markRecent(null); waitingFirst = false; activeRegion = name; statusFilter = filter; selectedNomor = null;
      if (name && stageFilter !== null && progress && !points.some(point => point.kabupaten === name && matchesStageFilter(point, stageFilter!, progress!))) {
        stageFilter = null;
      }
      if (!preserveQuery) query = '';
      fitReason = 'region'; fitRevision++;
    },
    setFilter(filter: StatusFilter) { markRecent(null); statusFilter = filter; selectedNomor = null; fitReason = 'filter'; fitRevision++; },
    setStageFilter(filter: StageFilter | null) { markRecent(null); waitingFirst = false; stageFilter = filter; selectedNomor = null; fitReason = 'filter'; fitRevision++; },
    select(nomor: string | null, origin: HTMLElement | null = null) {
      if (nomor) {
        markRecent(null);
        selectionOrigin = origin;
        sheetSnap = 'closed';
      }
      if (nomor !== selectedNomor) reported = null;
      selectedNomor = nomor;
    },
    // Pulling the persistent bottom bar up while a detail card is open turns the detail back into the list
    // without leaving a stale card behind the sheet.
    dismissDetailToSheet(snap: 'half' | 'full') {
      const point = selected;
      selectedNomor = null; reported = null;
      if (point) revealPointInList(point);
      sheetSnap = snap;
      markRecent(point?.nomor ?? null);
    },
    // Closing any point detail on mobile opens the sheet to half-height directly at that point's row
    // while keeping the map and centered pin visible above; desktop keeps the sidebar untouched.
    closeDetail() {
      const point = selected;
      selectedNomor = null; reported = null;
      if (point && (typeof window === 'undefined' || window.innerWidth < 960)) {
        revealPointInList(point);
        sheetSnap = 'half';
        markRecent(point.nomor);
      } else {
        markRecent(null);
      }
    },
  };
}
export type SurveyState = ReturnType<typeof createSurveyState>;
