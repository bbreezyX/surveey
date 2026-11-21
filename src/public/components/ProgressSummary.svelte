<script lang="ts">
  import type { SurveyState } from '../state/survey.svelte';
  import { STAGE_COUNT_LABEL, matchesStageFilter, tallyStages, waitingByRegion, type StageFilter, type SurveyProgress } from '../../shared/survey/progress';
  import StageLegend from './StageLegend.svelte';
  // The progress view's province screen, above the kabupaten atlas: the counts per stage (clickable to filter
  // the map and cards), and the units still waiting for review. Their bar sits under the province total in the
  // panel above, beside the share it draws. todaySteps: units per step that reached it today, for the legend's "+n".
  // When only one kabupaten has waiting units, one tap opens its waiting group directly; when several do, a
  // native disclosure lists each kabupaten so the reader picks the one they need instead of landing on an
  // arbitrary first region.
  let { state, progress, onopen, todaySteps = null }: { state: SurveyState; progress: SurveyProgress; onopen: (name: string, waiting?: boolean) => void; todaySteps?: readonly number[] | null } = $props();
  const tally = $derived(tallyStages(state.points, progress, state.pending));
  const waitingRegions = $derived(waitingByRegion(state.points, progress, state.pending, state.regionNames));
  const matchingRegions = $derived(state.stageFilter === null ? state.regionNames.length : state.regionNames.filter(name => state.points.some(point => point.kabupaten === name && matchesStageFilter(point, state.stageFilter!, progress))).length);
  function toggleStage(stage: StageFilter) { state.setStageFilter(state.stageFilter === stage ? null : stage); }
</script>
<div class="progress-sum">
  <StageLegend {tally} today={todaySteps} active={state.stageFilter} onselect={toggleStage}/>
  {#if state.stageFilter === null}
    {#if waitingRegions.length === 1}
      {@const only = waitingRegions[0]}
      <button class="progress-waiting" type="button" onclick={() => onopen(only.kabupaten, true)}><svg width="15" height="15" viewBox="0 0 14 14" aria-hidden="true"><circle cx="7" cy="7" r="5.6" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M7 4.2V7l1.9 1.3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg><span><b>{tally.waiting} titik</b> menunggu diperiksa · {only.kabupaten.replace(/^Kab\.\s+/i, '')}</span></button>
    {:else if waitingRegions.length > 1}
      <details class="progress-waiting-group">
        <summary class="progress-waiting"><svg width="15" height="15" viewBox="0 0 14 14" aria-hidden="true"><circle cx="7" cy="7" r="5.6" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M7 4.2V7l1.9 1.3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg><span><b>{tally.waiting} titik</b> menunggu diperiksa di {waitingRegions.length} wilayah</span></summary>
        <ul class="progress-waiting__list">
          {#each waitingRegions as item (item.kabupaten)}
            <li><button class="progress-waiting__row" type="button" onclick={() => onopen(item.kabupaten, true)}><span>{item.kabupaten}</span><b>{item.count}</b></button></li>
          {/each}
        </ul>
      </details>
    {/if}
  {/if}
</div>
<h2 class="atlas-section progress-grid-head">
  {state.stageFilter !== null ? STAGE_COUNT_LABEL[state.stageFilter] : 'Semua Wilayah'}
  <span class="progress-grid-head__side">
    <span>{matchingRegions} kabupaten/kota</span>
    {#if state.stageFilter !== null}<button class="progress-reset" type="button" onclick={() => state.setStageFilter(null)}>Semua</button>{/if}
  </span>
</h2>
