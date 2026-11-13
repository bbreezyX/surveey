<script lang="ts">
  import type { SurveyState } from '../state/survey.svelte';
  import { regionKey } from '../data/regions';
  import Shape from './Shape.svelte';
  // The progress view before esdm.cloud answers. The kabupaten outlines and names come with the map data,
  // so they are drawn at once; only what the feed carries (stage counts, bars, work groups) waits, as grey
  // blocks in about the places it will land. The province total announces the wait in the panel above;
  // a kabupaten has no total there, so its list says it here.
  let { state }: { state: SurveyState } = $props();
</script>
<div class="progress-loading" aria-busy="true">
  {#if state.activeRegion}<p class="visually-hidden" role="status">Memuat progres dari esdm.cloud…</p>{/if}
  <div class={state.activeRegion ? 'work-sum' : 'progress-sum'} aria-hidden="true">
    <span class="skel skel--bar"></span>
    <ul class="stage-legend">{#each [0, 1, 2, 3] as item (item)}<li><span class="skel skel--dot"></span><span class="skel skel--label"></span><span class="skel skel--count"></span></li>{/each}</ul>
  </div>
  {#if state.activeRegion}
    {#each [0, 1, 2] as row (row)}<div class="work-group-skel" aria-hidden="true"><span class="skel skel--dot"></span><span class="work-group-skel__text"><span class="skel skel--title"></span><span class="skel skel--note"></span></span><span class="skel skel--pill"></span></div>{/each}
  {:else}
    <div class="atlas-section progress-grid-head" role="heading" aria-level="2">Semua Wilayah<span>{state.regionNames.length} kabupaten/kota</span></div>
    <div class="atlas-grid" aria-hidden="true">
      {#each state.regionNames as name (name)}
        <div class="atlas-cell progress-cell is-loading">
          <span class="atlas-cell__shape"><Shape region={state.dataset.boundaries.find(region => regionKey(String(region.properties.KABUPATEN_)) === regionKey(name))} points={[]}/></span>
          <span class="atlas-cell__name">{name.replace(/^Kab\.\s+/i, '')}</span>
          <span class="skel skel--meta"></span>
          <span class="skel skel--thin"></span>
          <span class="skel skel--left"></span>
        </div>
      {/each}
    </div>
  {/if}
</div>
