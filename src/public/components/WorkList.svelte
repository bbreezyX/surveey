<script lang="ts">
  import type { SurveyState } from '../state/survey.svelte';
  import type { SurveyPoint } from '../../shared/survey/types';
  import { desaGroups, groupHead } from '../state/list-model';
  import { progressReportUrl } from '../../shared/survey/report';
  import { BUILD_STAGES, NEXT_REPORT, PENDING_CLOCK_SVG, matchesStageFilter, openPendingStages, pendingLabel, pendingSummary, reportReceipt, tallyStages, WORK_DONE, workBadgeSvg, workGroups, type StageFilter, type SurveyProgress } from '../../shared/survey/progress';
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
  const waitingRows = $derived(state.stageFilter === null ? groups.waiting : groups.waiting.filter(unit => matchesStageFilter(unit, state.stageFilter!, progress)));
  function toggleStage(stage: StageFilter) { state.setStageFilter(state.stageFilter === stage ? null : stage); }
  function openMine(nomor: string, origin: HTMLElement) {
    if (!state.visibleIds.has(nomor) && state.stageFilter !== null) state.setStageFilter(null);
    state.select(nomor, origin);
  }
  // Opening a disclosure near the foot of the mobile sheet otherwise expands its rows below the fold;
  // scroll just enough to bring the first revealed row into view without moving groups that already fit.
  function revealSummary(event: MouseEvent) {
    const group = (event.currentTarget as HTMLElement).parentElement;
    if (!(group instanceof HTMLDetailsElement) || group.open) return;
    requestAnimationFrame(() => {
      if (!group.open) return;
      const scroller = group.closest<HTMLElement>('.sidebar-scroll'), sidebar = group.closest<HTMLElement>('#sidebar');
      if (!scroller || !sidebar) return;
      const scrollerRect = scroller.getBoundingClientRect(), groupRect = group.getBoundingClientRect();
      const half = document.body.classList.contains('is-panel-half') && window.innerWidth < 960
        ? parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sheet-half')) || Math.round(window.innerHeight * 0.48)
        : 0;
      const visibleHeight = half ? Math.max(80, half - (scrollerRect.top - sidebar.getBoundingClientRect().top)) : scroller.clientHeight;
      const firstRow = group.querySelector<HTMLElement>('.work-row, .work-group__empty');
      const overflow = (firstRow ? firstRow.getBoundingClientRect().bottom : groupRect.bottom) - (scrollerRect.top + visibleHeight);
      if (overflow > 0) {
        const delta = Math.min(Math.max(0, groupRect.top - scrollerRect.top), overflow + 12);
        if (delta > 0) scroller.scrollTo({ top: scroller.scrollTop + delta, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
      }
    });
  }
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
    <h2 class="work-desa"><span class="work-desa__title">{head.title}</span><span class="work-desa__kec">{head.section}</span></h2>
    {#each head.items as point (point.nomor)}
      {@const waiting = openPendingStages(progress.get(point.nomor) ?? 0, state.pending?.get(point.nomor))}
      {@const flags = [point.duplikat ? STATUS_LABEL.duplikat.tag : '', point.belum ? STATUS_LABEL.belum.tag : ''].filter(Boolean)}
      <div class="work-row" class:is-recent={state.recentNomor === point.nomor}>
        <button class="work-row__main" class:is-recent={state.recentNomor === point.nomor} type="button" data-item-id={point.nomor} aria-pressed={state.selectedNomor === point.nomor} aria-label={[`Titik ${point.display.code}`, ...flags, point.display.primary, waiting.length ? pendingSummary(waiting) : '', state.recentNomor === point.nomor ? 'Terakhir dilihat' : '', 'lihat di peta'].filter(Boolean).join('. ')} onclick={event => state.select(point.nomor, event.currentTarget)}>
          <span class="atlas-unit" class:is-active={state.selectedNomor === point.nomor} class:is-duplikat={point.duplikat} class:is-belum={point.belum}>{point.display.code}</span>
          <span class="work-row__text">
            {#if waiting.length}<span class="atlas-pt__stage is-pending" title={pendingSummary(waiting)}>{@html PENDING_CLOCK_SVG}{pendingLabel(waiting)}</span>{/if}
            <span class="work-row__coord" class:is-none={point.belum}>{point.belum ? 'Belum ada koordinat' : point.koordinat}</span>
          </span>
        </button>
        {#if done}<span class="work-row__done">Selesai</span>
        {:else}<a class="work-row__lapor" href={progressReportUrl(point.nomor)} title="Lapor progres galian, cor, tiang, atau lampu untuk titik ini" aria-label={`Lapor progres titik ${point.display.code}`}><Icon name="camera" size={16}/><span>Lapor</span></a>{/if}
      </div>
    {/each}
  {/each}
{/snippet}
<div class="work-sum">
  <StageBar {tally}/>
  <StageLegend {tally} tight active={state.stageFilter} onselect={toggleStage}/>
</div>
{#if mine}
  <button class="work-mine" class:is-waiting={mine.receipt === 'pending'} type="button" aria-label={`Laporan ${BUILD_STAGES[mine.stage - 1]} titik ${mine.point.display.code}, ${mine.point.display.desa || mine.point.display.primary}. Dikirim dari HP ini, ${mine.receipt === 'accepted' ? 'sudah diterima' : 'menunggu diperiksa'}. Lihat di peta`} onclick={event => openMine(mine.point.nomor, event.currentTarget)}>
    {#if mine.receipt === 'pending'}<svg width="22" height="22" viewBox="0 0 14 14" aria-hidden="true"><circle cx="7" cy="7" r="5.6" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M7 4.2V7l1.9 1.3" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
    {:else}<svg width="24" height="24" viewBox="0 0 28 28" aria-hidden="true"><circle cx="14" cy="14" r="12" fill="#fff" stroke="currentColor" stroke-width="2"/><path d="M8.8 14.4 12.4 17.9 19.4 10.6" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>{/if}
    <span><strong>Laporan {BUILD_STAGES[mine.stage - 1]} titik {mine.point.display.code} · {mine.point.display.desa || mine.point.display.primary}</strong>Dikirim dari HP ini · {mine.receipt === 'accepted' ? 'Sudah diterima' : 'Menunggu diperiksa'}</span>
  </button>
{/if}
{#each groups.due as list, stage (stage)}
  {#if list.length && (state.stageFilter === null || state.stageFilter === stage)}
    <details class="work-group" class:is-next={state.stageFilter === null && stage === firstDue} open={state.stageFilter === stage}>
      <summary onclick={revealSummary}><span class="work-group__badge" aria-hidden="true">{@html workBadgeSvg(stage)}</span><span><span class="work-group__title">{NEXT_REPORT[stage].title}</span><span class="work-group__note">{NEXT_REPORT[stage].note}</span></span><span class="work-group__count">{list.length}</span></summary>
      {@render rows(list, false)}
    </details>
  {/if}
{/each}
{#if waitingRows.length}
  <details class="work-group" data-waiting open={openWaiting || state.stageFilter !== null}>
    <summary onclick={revealSummary}><span class="work-group__badge work-group__badge--wait" aria-hidden="true"><svg viewBox="0 0 14 14"><circle cx="7" cy="7" r="5.6" fill="#fff" stroke="currentColor" stroke-width="1.4"/><path d="M7 4.2V7l1.9 1.3" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg></span><span><span class="work-group__title">Menunggu Diperiksa</span><span class="work-group__note">Sudah dikirim, belum diterima kantor</span></span><span class="work-group__count">{waitingRows.length}</span></summary>
    {@render rows(waitingRows, false)}
  </details>
{/if}
{#if state.stageFilter === null || state.stageFilter === WORK_DONE}
  <details class="work-group is-done" open={state.stageFilter === WORK_DONE}>
    <summary onclick={revealSummary}><span class="work-group__badge" aria-hidden="true">{@html workBadgeSvg(WORK_DONE)}</span><span><span class="work-group__title">Terpasang</span><span class="work-group__note">Tiang berdiri, lampu menyala</span></span><span class="work-group__count">{groups.done.length}</span></summary>
    {#if groups.done.length}{@render rows(groups.done, true)}{:else}<p class="work-group__empty">Belum ada titik terpasang.</p>{/if}
  </details>
{/if}
