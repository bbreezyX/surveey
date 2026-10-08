<script lang="ts">
  import type { SurveyState } from '../state/survey.svelte';
  import { regionKey } from '../data/regions';
  import Shape from './Shape.svelte';
  import type { StatusFilter } from '../../shared/survey/types';
  let { state, onopen }: { state: SurveyState; onopen: (name: string, filter: StatusFilter) => void } = $props();
</script>
<div class="atlas-grid">
  {#each state.regionNames as name (name)}
    {@const points = state.points.filter(point => point.kabupaten === name)}
    {@const counted = points.filter(point => !point.cadangan)}
    {@const count = counted.length}
    {@const districts = new Set(counted.map(point => point.display.kecamatan)).size}
    {@const duplicates = counted.filter(point => point.duplikat).length}
    {@const unplaced = counted.filter(point => point.belum).length}
    <button class="atlas-cell" type="button" data-region={name} aria-label={[name, `${count} titik`, `${districts} kecamatan`, duplicates ? `${duplicates} perlu verifikasi` : '', unplaced ? `${unplaced} lokasi belum ditetapkan` : '', 'buka daftar'].filter(Boolean).join(', ')} onclick={(event) => {
      const shortcut = event.target instanceof Element ? event.target.closest('[data-shortcut]')?.getAttribute('data-shortcut') : null;
      onopen(name, shortcut === 'duplikat' || shortcut === 'belum' ? shortcut : null);
    }}>
      <span class="atlas-cell__shape"><Shape region={state.dataset.boundaries.find(region => regionKey(String(region.properties.KABUPATEN_)) === regionKey(name))} {points}/></span>
      <span class="atlas-cell__name">{name.replace(/^Kab\.\s+/i, '')}</span>
      <span class="atlas-cell__meta"><b>{count}</b> titik di {districts} kecamatan</span>
      {#if duplicates}<span class="status-flag status-flag--duplikat" data-shortcut="duplikat">{duplicates} perlu verifikasi</span>{/if}
      {#if unplaced}<span class="status-flag status-flag--belum" data-shortcut="belum">{unplaced} belum ditetapkan</span>{/if}
    </button>
  {/each}
</div>
