<script lang="ts">
  import { STAGE_COUNT_LABEL, workBadgeSvg, type StageFilter, type StageTally } from '../../shared/survey/progress';
  // The pin badges with their counts under the stage bar, so a stage is read by its drawing and number,
  // never by the shade of blue alone. today: units per step that reached it today, shown as "+n" after the count.
  // Stage 3 (Tiang selesai, awaiting night photo for Lampu) only takes a row when any unit sits there or moved
  // there today, keeping the two-column legend balanced when poles and lamps are accepted together.
  // When onselect is supplied, each legend row doubles as a map/list stage filter with zero extra vertical height.
  let { tally, tight = false, today = null, active = null, onselect }: { tally: StageTally; tight?: boolean; today?: readonly number[] | null; active?: StageFilter | null; onselect?: (stage: StageFilter) => void } = $props();
  const visibleSteps = $derived(([4, 3, 2, 1, 0] as const).filter(stage => stage !== 3 || tally.stages[3] > 0 || (today?.[3] ?? 0) > 0 || active === 3));
</script>
<ul class="stage-legend" class:stage-legend--tight={tight} class:is-interactive={!!onselect} class:has-active={active !== null}>
  {#each visibleSteps as stage (stage)}
    {@const pressed = active === stage}
    {@const empty = tally.stages[stage] === 0 && !pressed}
    <li>
      {#if onselect}
        <button class="stage-legend__btn" type="button" aria-pressed={pressed} disabled={empty} title={pressed ? `Tampilkan semua tahap` : `Saring peta: ${STAGE_COUNT_LABEL[stage]}`} onclick={() => onselect(stage)}>
          <span class="stage-legend__badge" aria-hidden="true">{@html workBadgeSvg(stage)}</span><span class="stage-legend__label">{STAGE_COUNT_LABEL[stage]}</span><span class="stage-legend__num"><b>{tally.stages[stage]}</b>{#if today?.[stage]}<em class="stage-legend__today">+{today[stage]}<span class="visually-hidden">{' '}hari ini</span></em>{/if}</span>
        </button>
      {:else}
        <span class="stage-legend__badge" aria-hidden="true">{@html workBadgeSvg(stage)}</span><span class="stage-legend__label">{STAGE_COUNT_LABEL[stage]}</span><span class="stage-legend__num"><b>{tally.stages[stage]}</b>{#if today?.[stage]}<em class="stage-legend__today">+{today[stage]}<span class="visually-hidden">{' '}hari ini</span></em>{/if}</span>
      {/if}
    </li>
  {/each}
</ul>
