<script lang="ts">
  import type { SurveyState } from '../state/survey.svelte';
  import { regionKey } from '../data/regions';
  import { BUILD_STAGES, tallyStages, TODAY_ARROW, WORK_DONE, workBadgeSvg, workGroups, workStep, type SurveyProgress } from '../../shared/survey/progress';
  import Shape from './Shape.svelte';
  // The atlas grid (RegionGrid) counted by build stage: same cells and silhouettes, the dots coloured
  // white / blue / green for not started / under way / terpasang (mockups/survey/j-sel-progres.html, C).
  // Under the name, one list (mockup C2): terpasang first, green, with the total after its count, then what is
  // left named by the stage it needs next ("Perlu cor"), counted as the kabupaten's work list groups it (open
  // reports apart), each row with the badge of the stage already accepted. "Perlu", not the work list's
  // "Lapor": the cell says what the units need, not what to tap.
  // No stage bar here: the counts already give the split it drew. The province bar keeps the whole.
  // todayIn: units per kabupaten that reached a step today, shown as a chip in the top-right corner.
  let { state, progress, onopen, todayIn = null }: { state: SurveyState; progress: SurveyProgress; onopen: (name: string) => void; todayIn?: ReadonlyMap<string, number> | null } = $props();
  // p0..p2 sort in draw order, so terpasang dots land on top of the rest.
  const dotKind = (nomor: string) => { const step = workStep(progress.get(nomor) ?? 0); return step === WORK_DONE ? 'p2' : step ? 'p1' : 'p0'; };
</script>
<div class="atlas-grid">
  {#each state.regionNames as name (name)}
    {@const points = state.points.filter(point => point.kabupaten === name)}
    {@const tally = tallyStages(points, progress, state.pending)}
    {@const groups = workGroups(points, progress, state.pending)}
    {@const next = [0, 1, 2].filter(step => groups.due[step].length)}
    {@const done = tally.total > 0 && tally.stages[WORK_DONE] === tally.total}
    {@const moved = todayIn?.get(name) ?? 0}
    <button class="atlas-cell progress-cell" class:is-done={done} type="button" data-region={name} aria-label={[name, done ? `semua ${tally.total} titik terpasang` : `${tally.stages[WORK_DONE]} dari ${tally.total} terpasang`, ...next.map(step => `${groups.due[step].length} perlu ${BUILD_STAGES[step].toLowerCase()}`), groups.waiting.length ? `${groups.waiting.length} menunggu diperiksa` : '', moved ? `${moved} progres hari ini` : '', 'buka daftar kerja'].filter(Boolean).join(', ')} onclick={() => onopen(name)}>
      {#if done || moved}<span class="progress-cell__corner" aria-hidden="true">{#if moved}<span class="today-chip">{@html TODAY_ARROW}{moved} hari ini</span>{/if}{#if done}<span class="progress-cell__check">{@html workBadgeSvg(WORK_DONE)}</span>{/if}</span>{/if}
      <span class="atlas-cell__shape"><Shape region={state.dataset.boundaries.find(region => regionKey(String(region.properties.KABUPATEN_)) === regionKey(name))} {points} kindOf={dotKind}/></span>
      <span class="atlas-cell__name">{name.replace(/^Kab\.\s+/i, '')}</span>
      {#if done}<span class="atlas-cell__meta is-done">Semua terpasang · {tally.total}</span>
      {:else}<ul class="progress-next" aria-hidden="true">
        <li class="is-done" class:is-zero={!tally.stages[WORK_DONE]}><span class="progress-next__badge">{@html workBadgeSvg(WORK_DONE)}</span><span>Terpasang</span><b>{tally.stages[WORK_DONE]}<small>/{tally.total}</small></b></li>
        {#each next as step (step)}<li><span class="progress-next__badge">{@html workBadgeSvg(step)}</span><span>Perlu {BUILD_STAGES[step].toLowerCase()}</span><b>{groups.due[step].length}</b></li>{/each}
        {#if groups.waiting.length}<li class="is-wait"><span class="progress-next__badge"><svg viewBox="0 0 14 14"><circle cx="7" cy="7" r="5.6" fill="#fff" stroke="currentColor" stroke-width="1.4"/><path d="M7 4.2V7l1.9 1.3" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg></span><span>Menunggu diperiksa</span><b>{groups.waiting.length}</b></li>{/if}
      </ul>{/if}
    </button>
  {/each}
</div>
