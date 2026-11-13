<script lang="ts">
  import { STAGE_COUNT_LABEL, workBadgeSvg, type StageTally } from '../../shared/survey/progress';
  // The pin badges with their counts under the stage bar, so a stage is read by its drawing and number,
  // never by the shade of blue alone.
  let { tally, tight = false }: { tally: StageTally; tight?: boolean } = $props();
</script>
<ul class="stage-legend" class:stage-legend--tight={tight}>
  {#each [3, 2, 1, 0] as stage (stage)}<li><span class="stage-legend__badge" aria-hidden="true">{@html workBadgeSvg(stage)}</span><span>{STAGE_COUNT_LABEL[stage]}</span><b>{tally.stages[stage]}</b></li>{/each}
</ul>
