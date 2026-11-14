<script lang="ts">
  import type { SurveyState } from '../state/survey.svelte';
  import { regionKey } from '../data/regions';
  import { NOT_STARTED_BADGE, STAGE_COUNT_LABEL, tallyStages, TODAY_ARROW, WORK_DONE, workBadgeSvg, workStep, type SurveyProgress } from '../../shared/survey/progress';
  import Shape from './Shape.svelte';
  import StageBar from './StageBar.svelte';
  // The atlas grid (RegionGrid) counted by build stage: same cells and silhouettes, the dots coloured
  // white / blue / green for not started / under way / terpasang, and what is left told by pin badges.
  // todayIn: units per kabupaten that reached a step today, shown as a chip beside the name.
  let { state, progress, onopen, todayIn = null }: { state: SurveyState; progress: SurveyProgress; onopen: (name: string) => void; todayIn?: ReadonlyMap<string, number> | null } = $props();
  // p0..p2 sort in draw order, so terpasang dots land on top of the rest.
  const dotKind = (nomor: string) => { const step = workStep(progress.get(nomor) ?? 0); return step === WORK_DONE ? 'p2' : step ? 'p1' : 'p0'; };
</script>
<div class="atlas-grid">
  {#each state.regionNames as name (name)}
    {@const points = state.points.filter(point => point.kabupaten === name)}
    {@const tally = tallyStages(points, progress, state.pending)}
    {@const left = [2, 1, 0].filter(stage => tally.stages[stage])}
    {@const done = tally.total > 0 && tally.stages[WORK_DONE] === tally.total}
    {@const moved = todayIn?.get(name) ?? 0}
    <button class="atlas-cell progress-cell" class:is-done={done} type="button" data-region={name} aria-label={[name, done ? `semua ${tally.total} titik terpasang` : `${tally.stages[WORK_DONE]} dari ${tally.total} terpasang`, ...left.map(stage => `${tally.stages[stage]} ${STAGE_COUNT_LABEL[stage].toLowerCase()}`), moved ? `${moved} progres hari ini` : '', 'buka daftar kerja'].filter(Boolean).join(', ')} onclick={() => onopen(name)}>
      {#if done}<span class="progress-cell__check" aria-hidden="true">{@html workBadgeSvg(WORK_DONE)}</span>{/if}
      <span class="atlas-cell__shape"><Shape region={state.dataset.boundaries.find(region => regionKey(String(region.properties.KABUPATEN_)) === regionKey(name))} {points} kindOf={dotKind}/></span>
      <span class="atlas-cell__name">{name.replace(/^Kab\.\s+/i, '')}{#if moved}<span class="today-chip" aria-hidden="true">{@html TODAY_ARROW}{moved} hari ini</span>{/if}</span>
      <span class="atlas-cell__meta" class:is-done={done}>{#if done}Semua terpasang · {tally.total}{:else}<b>{tally.stages[WORK_DONE]}</b>/{tally.total} terpasang{/if}</span>
      {#if !done}<StageBar {tally} thin/>{/if}
      {#if !done}<span class="progress-cell__left" aria-hidden="true">
        {#if tally.stages[0] === tally.total}<span class="is-none">{@html NOT_STARTED_BADGE}Belum dimulai</span>
        {:else}{#each left as stage (stage)}<span title={STAGE_COUNT_LABEL[stage]}>{@html workBadgeSvg(stage)}{tally.stages[stage]}</span>{/each}{/if}
      </span>{/if}
    </button>
  {/each}
</div>
