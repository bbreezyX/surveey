<script lang="ts">
  import { onMount, tick, untrack } from 'svelte';
  import { loadSurveyDataset } from './data/load';
  import { createSurveyState, type SurveyState } from './state/survey.svelte';
  import type { SurveyMapAdapter } from './map/create-map';
  import Sidebar from './components/Sidebar.svelte';
  import MapView from './components/MapView.svelte';
  import LayerPanel from './components/LayerPanel.svelte';
  import MobileHints from './components/MobileHints.svelte';
  import Legend from './components/Legend.svelte';
  import Icon from './components/Icon.svelte';
  let model = $state.raw<SurveyState | null>(null), adapter = $state.raw<SurveyMapAdapter | null>(null), error = $state('');
  let controller: AbortController | null = null, disposed = false;
  let fitFrame = 0;
  let fitTimer: ReturnType<typeof setTimeout> | undefined, appliedFit = -1;
  async function load() {
    controller?.abort(); const attempt = new AbortController(); controller = attempt;
    error = ''; model = null;
    try { const dataset = await loadSurveyDataset(attempt.signal); if (!disposed && !attempt.signal.aborted) model = createSurveyState(dataset); }
    catch (problem) { if (!disposed && !attempt.signal.aborted) error = problem instanceof Error ? problem.message : 'Data titik gagal dimuat.'; }
  }
  onMount(() => { load(); return () => { disposed = true; controller?.abort(); cancelAnimationFrame(fitFrame); clearTimeout(fitTimer); for (const name of ['is-popup-open', 'is-panel-open', 'is-sidebar-collapsed', 'is-data-unavailable']) document.body.classList.remove(name); }; });
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
  $effect(() => { if (model?.selectedNomor) { cancelAnimationFrame(fitFrame); clearTimeout(fitTimer); } });
  function fitAll() { if (model) { clearTimeout(fitTimer); cancelAnimationFrame(fitFrame); model.select(null); adapter?.fitToPoints(model.visibleIds); } }
  async function expandSidebar() { if (model) { model.sidebarCollapsed = false; await tick(); adapter?.updateSize(); document.getElementById('list-search')?.focus({ preventScroll: true }); } }
</script>
<svelte:window onresize={() => { if (model) { if (innerWidth >= 960) model.panelOpen = false; else model.sidebarCollapsed = false; } }} onkeydown={event => { if (event.key === 'Escape' && model) { if (document.activeElement?.id === 'list-search' && model.query) model.query = ''; else { model.select(null); model.panelOpen = false; } } }} />
<div class="app-shell">
  <header class="masthead"><img class="masthead-lambang" src="/assets/lambang-jambi.png" alt="Lambang Provinsi Jambi" width="36" height="38"/><div class="masthead-copy"><p class="masthead-kicker">Dinas ESDM Provinsi Jambi</p><h1 class="masthead-title">Sebaran PUTS 2026</h1></div></header>
  {#if model}
    <Sidebar state={model} onfit={fitAll}/>
    <button id="panel-toggle" class="panel-toggle" type="button" aria-controls="sidebar" aria-expanded={!model.sidebarCollapsed} aria-label="Tampilkan daftar" onclick={expandSidebar}><Icon name="collapse"/></button>
    <main class="map-frame"><MapView state={model} bind:adapter/><LayerPanel state={model}/></main>
    <Legend state={model}/><MobileHints busy={model.panelOpen || !!model.selected}/>
  {:else}
    <aside id="sidebar" class="loading-panel" aria-label="Daftar titik PUTS"><div class="atlas-head"><img src="/assets/lambang-jambi.png" alt="Lambang Provinsi Jambi" width="38" height="39"/><div><p class="atlas-head__org">Dinas ESDM Provinsi Jambi</p><h1 class="atlas-head__title">Sebaran PUTS 2026</h1></div></div><div class="data-state" role="status">{#if error}<h2>Data titik belum tersedia</h2><p>{error}</p><button type="button" onclick={load}>Coba lagi</button>{:else}<p>Memuat data titik…</p>{/if}</div></aside><main class="map-frame"></main>
  {/if}
</div>
