<script lang="ts">
  import type { SurveyState } from '../state/survey.svelte';
  import { tallyStages, type SurveyProgress } from '../../shared/survey/progress';
  import StageLegend from './StageLegend.svelte';
  // The progress view's province screen, above the kabupaten atlas: the counts per stage, and the reports
  // still waiting for review. Their bar sits under the province total in the panel above, beside the share it
  // draws. todaySteps: units per step that reached it today, for the legend's "+n".
  let { state, progress, onopen, todaySteps = null }: { state: SurveyState; progress: SurveyProgress; onopen: (name: string, waiting?: boolean) => void; todaySteps?: readonly number[] | null } = $props();
  const tally = $derived(tallyStages(state.points, progress, state.pending));
  const firstWaiting = $derived(state.points.find(point => !point.cadangan && state.pending?.get(point.nomor)?.length));
</script>
<div class="progress-sum">
  <StageLegend {tally} today={todaySteps}/>
  {#if tally.waiting && firstWaiting}<button class="progress-waiting" type="button" onclick={() => onopen(firstWaiting.kabupaten, true)}><svg width="15" height="15" viewBox="0 0 14 14" aria-hidden="true"><circle cx="7" cy="7" r="5.6" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M7 4.2V7l1.9 1.3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg><span><b>{tally.waiting} laporan</b> menunggu diperiksa</span></button>{/if}
</div>
<h2 class="atlas-section progress-grid-head">Semua Wilayah<span>{state.regionNames.length} kabupaten/kota</span></h2>
