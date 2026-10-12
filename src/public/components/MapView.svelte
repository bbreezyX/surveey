<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { createSurveyMap, type SurveyMapAdapter, type LayerKey } from '../map/create-map';
  import type { SurveyState } from '../state/survey.svelte';
  import PointPopup from './PointPopup.svelte';
  import Icon from './Icon.svelte';
  let { state, adapter = $bindable(null) }: { state: SurveyState; adapter?: SurveyMapAdapter | null } = $props();
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
    const instance = createSurveyMap({ target, popup, dataset: state.dataset, onSelect: (id, nearby) => id ? state.select(id, null, nearby) : closeDetail() }); adapter = instance;
    const observer = new ResizeObserver(scrollHint); observer.observe(content);
    return () => { observer.disconnect(); instance.dispose(); adapter = null; };
  });
  $effect(() => { adapter?.setVisiblePoints(state.visibleIds); if (state.selectedNomor && !state.visibleIds.has(state.selectedNomor)) state.select(null); });
  $effect(() => {
    const id = state.selectedNomor;
    if (id) returnFocus = state.selectionOrigin;
    adapter?.setSelection(id);
    if (!id && returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
  });
  $effect(() => { for (const key of Object.keys(state.layers) as LayerKey[]) adapter?.setLayerVisibility(key, state.layers[key]); });
</script>
<div id="map" aria-label="Peta sebaran PUTS" bind:this={target}></div>
<div id="popup" class="ol-popup" class:is-open={!!state.selected} bind:this={popup} onscroll={scrollHint} aria-label="Detail titik PUTS">
  {#if state.selected}<button id="popup-closer" class="ol-popup-closer" type="button" aria-label="Tutup info titik" onclick={closeDetail}></button>{/if}
  <div id="popup-content" bind:this={content} onscroll={scrollHint}>{#if state.selected}<PointPopup point={state.selected} dataset={state.dataset}/>{/if}<div class="popup-scroll-fade" aria-hidden="true"></div></div>
</div>
