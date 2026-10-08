<script lang="ts">
  import type { RegionFeature, SurveyPoint } from '../../shared/survey/types';
  import { thumbnail } from '../map/shapes';
  let { region, points, width = 160, height = 54, selected = null, inset = false }: { region?: RegionFeature; points: readonly SurveyPoint[]; width?: number; height?: number; selected?: string | null; inset?: boolean } = $props();
  const shape = $derived(thumbnail(region, points, width, height));
</script>
<svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMinYMid meet" aria-hidden="true" focusable="false">
  <path class={inset ? "popup-inset__shape" : "atlas-shape"} fill-rule="evenodd" d={shape.path}/>
  {#each shape.dots as dot (dot.id)}<circle class={inset ? "popup-inset__dot" : `atlas-dot atlas-dot--${dot.kind}`} cx={dot.x} cy={dot.y} r={width < 100 ? 1.3 : 2}/>{/each}
{#if inset}{#each shape.dots.filter(dot => dot.id === selected) as dot (dot.id)}<circle class="popup-inset__here-ring" cx={dot.x} cy={dot.y} r="6"/><circle class="popup-inset__here" cx={dot.x} cy={dot.y} r="3.2"/>{/each}{/if}
</svg>
