<script lang="ts">
  import { onMount, tick, untrack } from 'svelte';
  import { createSurveyMap, type SurveyMapAdapter, type LayerKey } from '../map/create-map';
  import type { SurveyState } from '../state/survey.svelte';
  import type { Locator } from '../state/locate.svelte';
  import type { Connection } from '../state/connection.svelte';
  import { nearestPoints, suggestable, isHere } from '../state/nearby';
  import PointPopup from './PointPopup.svelte';
  import Icon from './Icon.svelte';
  let { state, locator, connection, adapter = $bindable(null) }: { state: SurveyState; locator: Locator; connection: Connection; adapter?: SurveyMapAdapter | null } = $props();
  // Only the first fix of each session moves the map; after that the reader pans freely while the dot follows.
  let framed = false;
  const nearest = $derived(locator.fix ? nearestPoints(suggestable(state.points, state.layers), locator.fix, 1)[0] ?? null : null);
  let target: HTMLDivElement, popup: HTMLDivElement, content: HTMLDivElement;
  function scrollHint() { const scroller = innerWidth < 960 ? popup : content; popup.classList.toggle("is-scrollable", scroller.scrollHeight - scroller.clientHeight > 4); popup.classList.toggle("is-scroll-end", scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 4); }
  let returnFocus: HTMLElement | null = null;
  async function closeDetail() {
    const nomor = state.closeDetail(innerWidth < 960); if (!nomor) return;
    await tick();
    // Bring the closed point's card into the reopened sheet; scrolling only the list keeps the fixed sheet in place.
    const card = document.querySelector<HTMLElement>(`#sidebar [data-item-id="${CSS.escape(nomor)}"]`), scroller = card?.closest<HTMLElement>('.sidebar-scroll');
    if (!card || !scroller) return;
    const offset = card.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
    if (offset < 0 || offset + card.offsetHeight > scroller.clientHeight) scroller.scrollTop += offset - scroller.clientHeight / 3;
    card.focus({ preventScroll: true });
  }
  onMount(() => {
    const instance = createSurveyMap({ target, popup, dataset: state.dataset, view: state.initialView, onSelect: (id, nearby) => id ? state.select(id, null, nearby) : closeDetail(), onBasemapFallback: () => { state.layers.google = false; state.layers.esri = true; }, onTileTrouble: () => connection.suspect(), onTilesSlow: slow => { connection.tilesSlow = slow; } }); adapter = instance;
    const observer = new ResizeObserver(scrollHint); observer.observe(content);
    return () => { observer.disconnect(); instance.dispose(); adapter = null; };
  });
  $effect(() => { adapter?.setPoints(state.points); });
  $effect(() => { adapter?.setImageryOffline(connection.offline); });
  $effect(() => { adapter?.setVisiblePoints(state.visibleIds); if (state.selectedNomor && !state.visibleIds.has(state.selectedNomor)) state.select(null); });
  $effect(() => {
    const id = state.selectedNomor;
    if (id) returnFocus = state.selectionOrigin;
    adapter?.setSelection(id);
    if (!id && returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
  });
  $effect(() => { const fix = locator.fix; if (!fix) { framed = false; adapter?.setUserLocation(null, null); return; } adapter?.setUserLocation(fix, nearest?.point ?? null, !!nearest && isHere(nearest.meters, fix.accuracy), !framed && !untrack(() => state.selectedNomor)); framed = true; });
  $effect(() => { for (const key of Object.keys(state.layers) as LayerKey[]) adapter?.setLayerVisibility(key, state.layers[key]); });
</script>
<div id="map" aria-label="Peta sebaran PUTS" bind:this={target}></div>
<div id="popup" class="ol-popup" class:is-open={!!state.selected} bind:this={popup} onscroll={scrollHint} aria-label="Detail titik PUTS">
  {#if state.selected}<button id="popup-closer" class="ol-popup-closer" type="button" aria-label="Tutup info titik" onclick={closeDetail}></button>{/if}
  <div id="popup-content" bind:this={content} onscroll={scrollHint}>{#if state.selected}<PointPopup point={state.selected} dataset={state.dataset} stage={state.progress ? state.progress.get(state.selected.nomor) ?? 0 : null}/>{/if}<div class="popup-scroll-fade" aria-hidden="true"></div></div>
</div>
