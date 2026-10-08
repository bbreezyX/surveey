<script lang="ts">
  import type { SurveyState } from '../state/survey.svelte';
  import { STATUS_LABEL } from '../../shared/survey/status';
  let { state }: { state: SurveyState } = $props();
  const entries = $derived([
    { kind: 'sk', long: 'Titik PUTS', short: 'Titik PUTS', fill: '#fee50f', stroke: '#293d50', visible: state.layers.sk && state.visiblePoints.some(p => !p.belum && !p.duplikat && !p.cadangan) },
    { kind: 'belum', long: STATUS_LABEL.belum.legend, short: STATUS_LABEL.belum.short, fill: '#f4f6f8', stroke: '#6b7a8c', visible: state.layers.belum && state.visiblePoints.some(p => p.belum && !p.cadangan) },
    { kind: 'duplikat', long: STATUS_LABEL.duplikat.legend, short: STATUS_LABEL.duplikat.short, fill: '#fee50f', stroke: '#e8731a', visible: state.layers.sk && state.visiblePoints.some(p => p.duplikat && !p.cadangan && !p.belum) },
    { kind: 'cadangan', long: STATUS_LABEL.cadangan.legend, short: STATUS_LABEL.cadangan.short, fill: '#c5cdd6', stroke: '#293d50', visible: state.layers.cadangan && state.visiblePoints.some(p => p.cadangan) },
  ].filter(entry => entry.visible));
</script>
<div class="map-legend" hidden={!entries.length}><div class="map-legend__pill" role="list" aria-label="Legenda simbol peta">
  {#each entries as entry (entry.kind)}<span class="map-legend__item" role="listitem"><svg class="map-legend__swatch" width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><circle cx="7" cy="7" r="5" fill={entry.fill} stroke={entry.stroke} stroke-width={entry.kind === 'duplikat' || entry.kind === 'belum' ? 2.2 : entry.kind === 'cadangan' ? 1.4 : 1.6}/></svg><span class="map-legend__label map-legend__label--long">{entry.long}</span><span class="map-legend__label map-legend__label--short">{entry.short}</span></span>{/each}
</div></div>
