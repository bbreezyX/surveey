<script lang="ts">
  import type { SurveyState } from '../state/survey.svelte';
  import { STATUS_LABEL } from '../../shared/survey/status';
  import { BUILD_STAGES, stageBadgeSvg, stageDone } from '../../shared/survey/progress';
  // Named model here because a local called state would turn $state into a store read (as in LayerPanel).
  let { state: model }: { state: SurveyState } = $props();
  // The yellow pin is every unit and explains itself, so the key names only the marks that change it.
  const entries = $derived([
    { kind: 'belum', label: STATUS_LABEL.belum.short, fill: '#f4f6f8', stroke: '#6b7a8c', visible: model.layers.belum && model.visiblePoints.some(p => p.belum && !p.cadangan) },
    { kind: 'duplikat', label: STATUS_LABEL.duplikat.short, fill: '#fee50f', stroke: '#e8731a', visible: model.layers.sk && model.visiblePoints.some(p => p.duplikat && !p.cadangan && !p.belum) },
    { kind: 'cadangan', label: STATUS_LABEL.cadangan.short, fill: '#c5cdd6', stroke: '#293d50', visible: model.layers.cadangan && model.visiblePoints.some(p => p.cadangan) },
  ].filter(entry => entry.visible));
  // Build progress from esdm.cloud leads the key, since crews read the map to find the next unit to install.
  // All four stages show, in working order, once any visible pin wears a badge: the whole scale teaches the
  // quarter steps even while some stage has no unit in view, and the row keeps one shape as the map pans.
  const stagesShown = $derived(!!model.progress && model.layers.sk && model.visiblePoints.some(p => !p.cadangan && (model.progress?.get(p.nomor) ?? 0) > 0));
  const stageKeys = BUILD_STAGES.map((name, index) => ({ stage: index + 1, label: stageDone(index + 1) ? 'Terpasang' : name }));
  // On a phone the row is wider than the screen and pans sideways. A cut-off word alone does not say so, so
  // each edge that hides entries gets a fade and an arrow, gone once the row reaches that end. The row only
  // scrolls on phones, so desktop never measures any overflow and never shows them.
  let pill = $state<HTMLDivElement>();
  let moreBefore = $state(false), moreAfter = $state(false);
  function measure() {
    if (!pill) return;
    const room = pill.scrollWidth - pill.clientWidth;
    moreBefore = pill.scrollLeft > 1; moreAfter = room > 1 && pill.scrollLeft < room - 1;
  }
  $effect(() => {
    if (!pill) return;
    // Resizes cover rotation and the legend reappearing after the sheet or popup closes.
    const observer = new ResizeObserver(measure); observer.observe(pill);
    return () => observer.disconnect();
  });
  // Entries come and go as the map pans, which changes the row's width without resizing the pill.
  $effect(() => { void entries.length; void stagesShown; measure(); });
</script>
<!-- One row, each name beside its mark. The stages read as one unbroken scale; hairlines split the statuses
     from it and from each other. Progress and status are separate lists so a screen reader names each. -->
<div class="map-legend" hidden={!stagesShown && !entries.length}>
  {#if moreBefore}<span class="map-legend__more map-legend__more--before" aria-hidden="true"></span>{/if}
  {#if moreAfter}<span class="map-legend__more map-legend__more--after" aria-hidden="true"></span>{/if}
<div class="map-legend__pill" role="group" aria-label="Legenda simbol peta" bind:this={pill} onscroll={measure}>
  {#if stagesShown}<span class="map-legend__group map-legend__group--scale" role="list" aria-label="Progres pemasangan">{#each stageKeys as key (key.stage)}<span class="map-legend__item" role="listitem"><span class="map-legend__swatch map-legend__swatch--badge" aria-hidden="true">{@html stageBadgeSvg(key.stage)}</span><span class="map-legend__label">{key.label}{#if !stageDone(key.stage)}<span class="visually-hidden"> selesai</span>{/if}</span></span>{/each}</span>{/if}
  {#if entries.length}<span class="map-legend__group" role="list" aria-label="Status titik">{#each entries as entry (entry.kind)}<span class="map-legend__item" role="listitem"><svg class="map-legend__swatch" width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><circle cx="7" cy="7" r="5" fill={entry.fill} stroke={entry.stroke} stroke-width={entry.kind === 'cadangan' ? 1.4 : 2.2}/></svg><span class="map-legend__label">{entry.label}</span></span>{/each}</span>{/if}
</div></div>
