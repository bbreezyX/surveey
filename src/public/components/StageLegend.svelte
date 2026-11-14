<script lang="ts">
  import { STAGE_COUNT_LABEL, workBadgeSvg, type StageTally } from '../../shared/survey/progress';
  // The pin badges with their counts under the stage bar, so a stage is read by its drawing and number,
  // never by the shade of blue alone. today: units per step that reached it today, shown as "+n" after the count.
  let { tally, tight = false, today = null }: { tally: StageTally; tight?: boolean; today?: readonly number[] | null } = $props();
</script>
<ul class="stage-legend" class:stage-legend--tight={tight}>
  {#each [3, 2, 1, 0] as stage (stage)}<li><span class="stage-legend__badge" aria-hidden="true">{@html workBadgeSvg(stage)}</span><span>{STAGE_COUNT_LABEL[stage]}</span><b>{tally.stages[stage]}</b>{#if today?.[stage]}<em class="stage-legend__today">+{today[stage]}<span class="visually-hidden"> hari ini</span></em>{/if}</li>{/each}
</ul>
