<script lang="ts">
  import type { StageTally } from '../../shared/survey/progress';
  // One segment per stage, sized by its units: terpasang first in green, then the stages under way in
  // deepening blue, then not started in grey. Decorative; the legend or label beside it carries the numbers.
  let { tally, thin = false }: { tally: StageTally; thin?: boolean } = $props();
</script>
<span class="stage-bar" class:stage-bar--thin={thin} aria-hidden="true">{#each [3, 2, 1, 0] as stage (stage)}{#if tally.stages[stage]}<i class={`stage-bar__s${stage}`} style:flex-grow={tally.stages[stage]}></i>{/if}{/each}</span>
