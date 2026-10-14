<script lang="ts">
  import type { SurveyState } from '../state/survey.svelte';
  import type { Locator } from '../state/locate.svelte';
  import type { SurveyPoint } from '../../shared/survey/types';
  import { nearestPoints, suggestable, isHere, formatDistance, WEAK_ACCURACY } from '../state/nearby';
  import Icon from './Icon.svelte';
  let { state, locator }: { state: SurveyState; locator: Locator } = $props();
  const candidates = $derived(suggestable(state.points, state.layers));
  const fix = $derived(locator.fix);
  const rows = $derived(fix ? nearestPoints(candidates, fix) : []);
  function open(point: SurveyPoint, origin: HTMLElement) {
    // A unit hidden by the current search or kabupaten would be deselected straight away, so open its kabupaten first.
    if (!state.visibleIds.has(point.nomor)) state.openRegion(point.kabupaten);
    state.select(point.nomor, origin);
  }
</script>
{#if locator.status === 'off'}
  <!-- Phones only: there this is the whole location control, sitting in the sheet's peek. Desktop uses the round button. -->
  <button class="nearby-cta" type="button" onclick={locator.toggle}>
    <span class="nearby-cta__icon" aria-hidden="true"><Icon name="locate" size={20}/></span>
    <span class="nearby-cta__text"><b>Lihat titik terdekat</b><span>Pakai lokasi HP-mu</span></span>
    <Icon name="back" size={16}/>
  </button>
{:else}
  <section class="nearby" class:is-live={locator.status === 'on'} aria-labelledby="nearby-title">
    <div class="nearby__head">
      <h2 class="nearby__title" id="nearby-title"><span class="nearby__live" aria-hidden="true"></span>Di dekatmu</h2>
      {#if fix}<span class="nearby__acc" title="Akurasi GPS">±{formatDistance(fix.accuracy)}</span>{/if}
      <button class="nearby__off" type="button" aria-label="Matikan lokasi" onclick={locator.toggle}><Icon name="close" size={16}/></button>
    </div>
    <div role="status">
      {#if locator.status === 'seeking'}<p class="nearby__note">Mencari lokasimu…</p>
      {:else if locator.status === 'denied'}<p class="nearby__note">Izin lokasi ditolak. Aktifkan di pengaturan browser.</p>
      {:else if locator.status === 'error'}<p class="nearby__note">Lokasi belum didapat. Pastikan GPS aktif.</p>
      {:else if fix && fix.accuracy > WEAK_ACCURACY}<p class="nearby__note">Sinyal GPS lemah, jarak bisa meleset.</p>{/if}
    </div>
    {#if locator.status === 'denied' || locator.status === 'error'}<button class="nearby__retry" type="button" onclick={locator.start}>Coba lagi</button>{/if}
    {#if fix && rows.length}
      <div class="nearby__rows">
        {#each rows as { point, meters } (point.nomor)}
          {@const here = isHere(meters, fix.accuracy)}
          <button class="nearby__row" class:is-here={here} type="button" aria-label={`Titik ${point.display.code}. ${point.display.primary}. ${formatDistance(meters)}${here ? ', di sini' : ''}`} aria-pressed={state.selectedNomor === point.nomor} onclick={event => open(point, event.currentTarget)}>
            <span class="atlas-unit" class:is-active={state.selectedNomor === point.nomor} class:is-cadangan={point.cadangan} class:is-duplikat={point.duplikat}>{point.display.code}</span>
            <span class="nearby__info"><span class="nearby__place">{point.display.primary}</span><span class="nearby__area">{point.display.desa || point.kabupaten}</span></span>
            <span class="nearby__dist">{formatDistance(meters)}{#if here}<small>di sini</small>{/if}</span>
          </button>
        {/each}
      </div>
    {:else if fix}<p class="nearby__note">Tidak ada titik di layer yang tampil.</p>{/if}
  </section>
{/if}
