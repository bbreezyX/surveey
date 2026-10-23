<script lang="ts">
  import { onMount, tick, untrack } from 'svelte';
  import { loadSurveyDataset } from './data/load';
  import { loadProgress } from './data/progress';
  import { createSurveyState, type SurveyState } from './state/survey.svelte';
  import type { SurveyMapAdapter } from './map/create-map';
  import Sidebar from './components/Sidebar.svelte';
  import MapView from './components/MapView.svelte';
  import LayerPanel from './components/LayerPanel.svelte';
  import MobileHints from './components/MobileHints.svelte';
  import Legend from './components/Legend.svelte';
  import Icon from './components/Icon.svelte';
  import { lambang, lambangSrcset } from './assets/lambang';
  import { createLocator } from './state/locate.svelte';
  import { createConnection } from './state/connection.svelte';
  import ConnectionStatus from './components/ConnectionStatus.svelte';
  let model = $state.raw<SurveyState | null>(null), adapter = $state.raw<SurveyMapAdapter | null>(null), error = $state('');
  let controller: AbortController | null = null, disposed = false;
  const locator = createLocator(), connection = createConnection();
  let fitFrame = 0;
  let fitTimer: ReturnType<typeof setTimeout> | undefined, appliedFit = -1;
  // When the points last came from the network rather than the service worker's stored copy.
  let freshAt = 0, refreshing = $state(false);
  async function load() {
    controller?.abort(); const attempt = new AbortController(); controller = attempt;
    error = ''; model = null;
    // Build progress comes from esdm.cloud and never holds up the map; it lands on the pins when it arrives.
    const progress = loadProgress(attempt.signal);
    connection.loading(true);
    try { const dataset = await loadSurveyDataset(attempt.signal); if (!disposed && !attempt.signal.aborted) { if (!dataset.storedAt) freshAt = Date.now(); const state = createSurveyState(dataset); model = state; void progress.then(value => { if (!disposed && !attempt.signal.aborted && value) state.progress = value; }); } }
    catch (problem) { if (!disposed && !attempt.signal.aborted) { error = problem instanceof Error ? problem.message : 'Data titik gagal dimuat.'; connection.suspect(); } }
    finally { if (controller === attempt) connection.loading(false); }
  }
  // Fetches again behind the map the reader is using: the list, search, open point and view stay put,
  // and only points that actually changed are swapped in. A failure leaves everything as it was.
  async function refresh() {
    const state = model, attempt = controller; if (!state || !attempt || refreshing) return;
    refreshing = true;
    try {
      const [dataset, progress] = await Promise.all([loadSurveyDataset(attempt.signal).catch(() => null), loadProgress(attempt.signal)]);
      if (disposed || attempt.signal.aborted || model !== state) return;
      if (dataset) { if (!dataset.storedAt) freshAt = Date.now(); state.replaceDataset(dataset); }
      if (progress) state.progress = progress;
    } finally { refreshing = false; }
  }
  // Build stages move while the points do not: a crew reports on esdm.cloud/lapangan in another tab and
  // comes back here. The stage list is small, so every return fetches it, not only after STALE_MS.
  async function refreshProgress() {
    const state = model, attempt = controller; if (!state || !attempt || refreshing) return;
    const progress = await loadProgress(attempt.signal);
    if (progress && !disposed && !attempt.signal.aborted && model === state) state.progress = progress;
  }
  // Data stays current without the reader doing anything: a failed first load retries, a stored copy is
  // swapped for fresh data, and a map left open in a pocket all morning refreshes when it is looked at again.
  const STALE_MS = 5 * 60_000, RETRY_MS = 30_000;
  function reconnect(force = false) {
    // force: the reader pressed Perbarui, or the worker has news; otherwise a phone that knows it is offline waits.
    if (disposed || document.visibilityState !== 'visible' || (!force && navigator.onLine === false)) return;
    if (!model) { if (error) load(); return; }
    if (force || model.storedAt || !model.progress || Date.now() - freshAt > STALE_MS) void refresh();
    else void refreshProgress();
  }
  onMount(() => {
    const stopConnection = connection.start();
    load();
    const wake = () => reconnect(), retry = setInterval(() => { if (!model ? !!error : !!model.storedAt || !model.progress) reconnect(); }, RETRY_MS);
    // The service worker says when a slow download it was still finishing has landed in its store.
    const fromWorker = (event: MessageEvent) => { if (event.data?.type === 'puts-data-updated') reconnect(true); };
    addEventListener('online', wake); document.addEventListener('visibilitychange', wake); navigator.serviceWorker?.addEventListener('message', fromWorker);
    return () => { disposed = true; stopConnection(); clearInterval(retry); removeEventListener('online', wake); document.removeEventListener('visibilitychange', wake); navigator.serviceWorker?.removeEventListener('message', fromWorker); locator.dispose(); controller?.abort(); cancelAnimationFrame(fitFrame); clearTimeout(fitTimer); for (const name of ['is-popup-open', 'is-panel-open', 'is-sidebar-collapsed', 'is-data-unavailable']) document.body.classList.remove(name); };
  });
  $effect(() => { document.body.classList.toggle('is-popup-open', !!model?.selected); document.body.classList.toggle('is-panel-open', !!model?.panelOpen); document.body.classList.toggle('is-sidebar-collapsed', !!model?.sidebarCollapsed); document.body.classList.toggle('is-data-unavailable', !model); });
  $effect(() => {
    if (!model || !adapter) return;
    const revision = model.fitRevision; if (revision === appliedFit) return; appliedFit = revision;
    cancelAnimationFrame(fitFrame); clearTimeout(fitTimer);
    const state = model, instance = adapter, reason = state.fitReason;
    const options = reason === 'initial' ? { duration: 0, maxZoom: 15 } : reason === 'region' ? { duration: 700, maxZoom: state.activeRegion ? 14 : 15 } : { duration: 500, maxZoom: 16 };
    const schedule = () => { fitFrame = requestAnimationFrame(() => { if (!disposed && !state.selectedNomor) instance.fitToPoints(state.visibleIds, options); }); };
    if (!untrack(() => state.selectedNomor)) { if (reason === 'search') fitTimer = setTimeout(schedule, 250); else schedule(); }
  });
  $effect(() => { const progress = model?.progress; if (progress && adapter) adapter.setProgress(progress); });
  $effect(() => { if (model?.selectedNomor) { cancelAnimationFrame(fitFrame); clearTimeout(fitTimer); } });
  function fitAll() { if (model) { clearTimeout(fitTimer); cancelAnimationFrame(fitFrame); model.select(null); adapter?.fitToPoints(model.visibleIds); } }
  async function expandSidebar() { if (model) { model.sidebarCollapsed = false; await tick(); adapter?.updateSize(); document.getElementById('list-search')?.focus({ preventScroll: true }); } }
</script>
<svelte:window onresize={() => { if (model) { if (innerWidth >= 960) model.panelOpen = false; else model.sidebarCollapsed = false; } }} onkeydown={event => { if (event.key === 'Escape' && model) { if (document.activeElement?.id === 'list-search' && model.query) model.query = ''; else { model.select(null); model.panelOpen = false; } } }} />
<div class="app-shell">
  <header class="masthead"><img class="masthead-lambang" src={lambang} srcset={lambangSrcset} sizes="30px" alt="Lambang Provinsi Jambi" width="36" height="38"/><div class="masthead-copy"><p class="masthead-kicker">Dinas ESDM Provinsi Jambi</p><h1 class="masthead-title">Sebaran PUTS 2026</h1></div></header>
  {#if model}
    <Sidebar state={model} onfit={fitAll} onrefresh={() => reconnect(true)} {refreshing} {locator}/>
    <button id="panel-toggle" class="panel-toggle" type="button" aria-controls="sidebar" aria-expanded={!model.sidebarCollapsed} aria-label="Tampilkan daftar" onclick={expandSidebar}><Icon name="collapse"/></button>
    <main class="map-frame"><MapView state={model} {locator} {connection} bind:adapter/><LayerPanel state={model}/></main>
    <Legend state={model}/><MobileHints busy={model.panelOpen || !!model.selected}/>
  {:else}
    <aside id="sidebar" class="loading-panel" aria-label="Daftar titik PUTS"><div class="atlas-head"><img src={lambang} srcset={lambangSrcset} sizes="38px" alt="Lambang Provinsi Jambi" width="38" height="39"/><div><p class="atlas-head__org">Dinas ESDM Provinsi Jambi</p><h1 class="atlas-head__title">Sebaran PUTS 2026</h1></div></div><div class="data-state" role="status">{#if error}<h2>Data titik belum tersedia</h2><p>{error}</p><button type="button" onclick={load}>Coba lagi</button>{:else}<div class="data-loading"><span class="data-loading__spinner" aria-hidden="true"></span><p>Memuat data titik…</p></div>{/if}</div></aside><main class="map-frame"></main>
  {/if}
  <ConnectionStatus {connection} hasData={!!model}/>
</div>
