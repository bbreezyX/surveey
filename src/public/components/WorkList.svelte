<script lang="ts">
  import type { SurveyState } from '../state/survey.svelte';
  import type { SurveyPoint } from '../../shared/survey/types';
  import { desaGroups, groupHead } from '../state/list-model';
  import { progressReportUrl } from '../../shared/survey/report';
  import { BUILD_STAGES, NEXT_REPORT, pendingLabel, pendingSummary, reportReceipt, tallyStages, WORK_DONE, workBadgeSvg, workGroups, type SurveyProgress } from '../../shared/survey/progress';
  import { STATUS_LABEL } from '../../shared/survey/status';
  import StageBar from './StageBar.svelte';
  import StageLegend from './StageLegend.svelte';
  import Icon from './Icon.svelte';
  // One kabupaten in the progress view: its units sorted by the report each needs next, so a crew sees what
  // to do here and reports it in one tap. A row opens the unit on the map like the list does; Lapor goes to
  // esdm.cloud/lapangan in the same tab, as the popup's Lapor does.
  let { state, progress, openWaiting = false }: { state: SurveyState; progress: SurveyProgress; openWaiting?: boolean } = $props();
  const points = $derived(state.points.filter(point => point.kabupaten === state.activeRegion));
  const tally = $derived(tallyStages(points, progress, state.pending));
  const groups = $derived(workGroups(points, progress, state.pending));
  // The first step with work in it is marked, so the eye finds what to do next. Every group starts shut,
  // so opening a kabupaten shows all its steps at once; a crew taps the one it wants.
  const firstDue = $derived(openWaiting ? -1 : groups.due.findIndex(list => list.length));
  // This phone's last report, once the feed holds it (waiting or accepted), as the popup's tick waits too.
  const mine = $derived.by(() => {
    const report = state.lastReport, point = report && points.find(item => item.nomor === report.nomor);
    const receipt = report && point ? reportReceipt(report.stage, progress.get(report.nomor) ?? 0, state.pending?.get(report.nomor)) : null;
    return report && point && receipt ? { point, stage: report.stage, receipt } : null;
  });
  const heads = (items: SurveyPoint[]) => desaGroups(items).map(group => {
    const section = `Kec. ${group.items[0].display.kecamatan}`;
    return { key: group.label + group.desa + section, title: groupHead(group, section).title, section, items: group.items };
  });
</script>
{#snippet rows(items: SurveyPoint[], done: boolean)}
  {#each heads(items) as head (head.key)}
    <div class="work-desa"><span class="work-desa__title">{head.title}</span><span class="work-desa__kec">{head.section}</span></div>
    {#each head.items as point (point.nomor)}
      {@const waiting = state.pending?.get(point.nomor)}
      {@const flags = [point.duplikat ? STATUS_LABEL.duplikat.tag : '', point.belum ? STATUS_LABEL.belum.tag : ''].filter(Boolean)}
      <div class="work-row">
        <button class="work-row__main" type="button" data-item-id={point.nomor} aria-pressed={state.selectedNomor === point.nomor} aria-label={[`Titik ${point.display.code}`, ...flags, point.display.primary, waiting?.length ? pendingSummary(waiting) : '', 'lihat di peta'].filter(Boolean).join('. ')} onclick={event => state.select(point.nomor, event.currentTarget)}>
          <span class="atlas-unit" class:is-active={state.selectedNomor === point.nomor} class:is-duplikat={point.duplikat} class:is-belum={point.belum}>{point.display.code}</span>
          <span class="work-row__text">
            {#if waiting?.length}<span class="atlas-pt__stage is-pending" title={pendingSummary(waiting)}><svg width="12" height="12" viewBox="0 0 14 14" aria-hidden="true"><circle cx="7" cy="7" r="5.6" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M7 4.2V7l1.9 1.3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>{pendingLabel(waiting)}</span>{/if}
            <span class="work-row__coord" class:is-none={point.belum}>{point.belum ? 'Belum ada koordinat' : point.koordinat}</span>
          </span>
        </button>
        {#if done}<span class="work-row__done">Selesai</span>
        {:else}<a class="work-row__lapor" href={progressReportUrl(point.nomor)} title="Lapor progres galian, cor, tiang, atau lampu untuk titik ini" aria-label={`Lapor progres titik ${point.display.code}`}><Icon name="camera" size={16}/><span>Lapor</span></a>{/if}
      </div>
    {/each}
  {/each}
{/snippet}
<section class="work-sum" aria-label={`Progres ${state.activeRegion}`}>
  <StageBar {tally}/>
  <StageLegend {tally} tight/>
</section>
{#if mine}
  <p class="work-mine" class:is-waiting={mine.receipt === 'pending'} role="status">
    {#if mine.receipt === 'pending'}<svg width="22" height="22" viewBox="0 0 14 14" aria-hidden="true"><circle cx="7" cy="7" r="5.6" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M7 4.2V7l1.9 1.3" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
    {:else}<svg width="24" height="24" viewBox="0 0 28 28" aria-hidden="true"><circle cx="14" cy="14" r="12" fill="#fff" stroke="currentColor" stroke-width="2"/><path d="M8.8 14.4 12.4 17.9 19.4 10.6" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>{/if}
    <span><strong>Laporan {BUILD_STAGES[mine.stage - 1]} titik {mine.point.display.code} · {mine.point.display.desa || mine.point.display.primary}</strong>Dikirim dari HP ini · {mine.receipt === 'accepted' ? 'Sudah diterima' : 'Menunggu diperiksa'}</span>
  </p>
{/if}
{#each groups.due as list, stage (stage)}
  {#if list.length}
    <details class="work-group" class:is-next={stage === firstDue}>
      <summary><span class="work-group__badge" aria-hidden="true">{@html workBadgeSvg(stage)}</span><span><span class="work-group__title">{NEXT_REPORT[stage].title}</span><span class="work-group__note">{NEXT_REPORT[stage].note}</span></span><span class="work-group__count">{list.length}</span></summary>
      {@render rows(list, false)}
    </details>
  {/if}
{/each}
{#if groups.waiting.length}
  <details class="work-group" open={openWaiting}>
    <summary><span class="work-group__badge work-group__badge--wait" aria-hidden="true"><svg viewBox="0 0 14 14"><circle cx="7" cy="7" r="5.6" fill="#fff" stroke="currentColor" stroke-width="1.4"/><path d="M7 4.2V7l1.9 1.3" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg></span><span><span class="work-group__title">Menunggu Diperiksa</span><span class="work-group__note">Sudah dikirim, belum diterima kantor</span></span><span class="work-group__count">{groups.waiting.length}</span></summary>
    {@render rows(groups.waiting, false)}
  </details>
{/if}
<details class="work-group is-done">
  <summary><span class="work-group__badge" aria-hidden="true">{@html workBadgeSvg(WORK_DONE)}</span><span><span class="work-group__title">Terpasang</span><span class="work-group__note">Tiang berdiri, lampu terpasang</span></span><span class="work-group__count">{groups.done.length}</span></summary>
  {#if groups.done.length}{@render rows(groups.done, true)}{:else}<p class="work-group__empty">Belum ada titik terpasang.</p>{/if}
</details>
