<script lang="ts">
  import { tick } from 'svelte';
  import type { SurveyState } from '../state/survey.svelte';
  import type { Locator } from '../state/locate.svelte';
  import type { SurveyPoint } from '../../shared/survey/types';
  import { nearestPoints, suggestable, isHere, formatDistance, WEAK_ACCURACY } from '../state/nearby';
  import { progressReportUrl } from '../../shared/survey/report';
  import { PENDING_CLOCK_SVG, WORK_DONE, openPendingStages, pendingLabel, pendingSummary, stageBadgeSvg, stageSummary, workStep } from '../../shared/survey/progress';
  import Icon from './Icon.svelte';
  const NEARBY_LIMIT = 5;
  let { state: survey, locator }: { state: SurveyState; locator: Locator } = $props();
  let onlyUnfinished = $state(false);
  const allCandidates = $derived(suggestable(survey.points, survey.layers));
  const candidates = $derived(
    onlyUnfinished && survey.progress
      ? allCandidates.filter(point => point.cadangan || workStep(survey.progress!.get(point.nomor) ?? 0) < WORK_DONE)
      : allCandidates,
  );
  const fix = $derived(locator.fix);
  const rows = $derived(fix ? nearestPoints(candidates, fix, NEARBY_LIMIT) : []);
  function open(point: SurveyPoint, origin: HTMLElement) {
    // A unit hidden by the current search, kabupaten or stage filter would be deselected straight away, so clear them first.
    if (!survey.visibleIds.has(point.nomor)) {
      if (survey.stageFilter !== null) survey.setStageFilter(null);
      if (survey.activeRegion !== point.kabupaten || survey.statusFilter || survey.query) survey.openRegion(point.kabupaten);
    }
    survey.select(point.nomor, origin);
  }
  // Both buttons remove themselves (the card closes, or the retry gives way to "Mencari…"), so focus moves to what
  // stays: the location toggle by the search, or the card's close button.
  async function turnOff() { locator.toggle(); await tick(); document.querySelector<HTMLButtonElement>('.locate-btn')?.focus({ preventScroll: true }); }
  async function retry() { locator.start(); await tick(); document.querySelector<HTMLButtonElement>('.nearby__off')?.focus({ preventScroll: true }); }
</script>
{#if locator.status !== 'off'}
  <section class="nearby" class:is-live={locator.status === 'on'} aria-labelledby="nearby-title">
    <div class="nearby__head">
      <h2 class="nearby__title" id="nearby-title"><span class="nearby__live" aria-hidden="true"></span>Di dekatmu</h2>
      {#if fix}<span class="nearby__acc" title="Akurasi GPS">±{formatDistance(fix.accuracy)}</span>{/if}
      {#if survey.progress && fix}<button class="nearby__filter" type="button" aria-pressed={onlyUnfinished} onclick={() => { onlyUnfinished = !onlyUnfinished; }}>Belum terpasang</button>{/if}
      <button class="nearby__off" type="button" aria-label="Matikan lokasi" onclick={turnOff}><Icon name="close" size={16}/></button>
    </div>
    <div role="status">
      {#if locator.status === 'seeking'}<p class="nearby__note">Mencari lokasimu…</p>
      {:else if locator.status === 'denied'}<p class="nearby__note">Izin lokasi ditolak. Aktifkan di pengaturan browser.</p>
      {:else if locator.status === 'error'}<p class="nearby__note">Lokasi belum didapat. Pastikan GPS aktif.</p>
      {:else if fix && fix.accuracy > WEAK_ACCURACY}<p class="nearby__note">Sinyal GPS lemah, jarak bisa meleset.</p>{/if}
    </div>
    {#if locator.status === 'denied' || locator.status === 'error'}<button class="nearby__retry" type="button" onclick={retry}>Coba lagi</button>{/if}
    {#if fix && rows.length}
      <div class="nearby__rows">
        {#each rows as { point, meters } (point.nomor)}
          {@const here = isHere(meters, fix.accuracy)}
          {@const stage = point.cadangan ? 0 : survey.progress?.get(point.nomor) ?? 0}
          {@const waiting = point.cadangan ? [] : openPendingStages(stage, survey.pending?.get(point.nomor))}
          {@const done = stage >= WORK_DONE}
          <div class="nearby__row" class:is-here={here}>
            <button class="nearby__main" type="button" aria-label={[`Titik ${point.display.code}`, point.display.primary, stage ? stageSummary(stage) : '', waiting.length ? pendingSummary(waiting) : '', `${formatDistance(meters)}${here ? ', di sini' : ''}`].filter(Boolean).join('. ')} aria-pressed={survey.selectedNomor === point.nomor} onclick={event => open(point, event.currentTarget)}>
              <span class="atlas-unit" class:is-active={survey.selectedNomor === point.nomor} class:is-cadangan={point.cadangan} class:is-duplikat={point.duplikat} class:has-badge={stage > 0}>{point.display.code}{#if stage}<span class="atlas-unit__badge" aria-hidden="true">{@html stageBadgeSvg(stage)}</span>{/if}</span>
              <span class="nearby__info">
                <span class="nearby__place">{point.display.primary}</span>
                <span class="nearby__meta">
                  {#if waiting.length}<span class="atlas-pt__stage is-pending" title={pendingSummary(waiting)}>{@html PENDING_CLOCK_SVG}{pendingLabel(waiting)}</span>
                  {:else if done}<span class="nearby__done">Terpasang</span>
                  {:else if stage > 0}<span class="nearby__stage">{stageSummary(stage)}</span>{/if}
                  <span class="nearby__area">{point.display.desa || point.kabupaten}</span>
                </span>
              </span>
              <span class="nearby__dist">{formatDistance(meters)}{#if here}<small>di sini</small>{/if}</span>
            </button>
            {#if !done}<a class="nearby__lapor" href={progressReportUrl(point.nomor)} title="Lapor progres galian, cor, tiang, atau lampu untuk titik ini" aria-label={`Lapor progres titik ${point.display.code}`}><Icon name="camera" size={14}/><span>Lapor</span></a>{/if}
          </div>
        {/each}
      </div>
    {:else if fix && onlyUnfinished && allCandidates.length}
      <p class="nearby__note">Semua titik yang tampil sudah terpasang.</p>
      <button class="nearby__retry" type="button" onclick={() => { onlyUnfinished = false; }}>Tampilkan semua</button>
    {:else if fix}<p class="nearby__note">Tidak ada titik di layer yang tampil.</p>{/if}
  </section>
{/if}
