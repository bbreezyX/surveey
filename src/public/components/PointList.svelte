<script lang="ts">
  import type { SurveyState } from '../state/survey.svelte';
  import { desaGroups, groupHead, landmarkFor } from '../state/list-model';
  import { STATUS_LABEL } from '../../shared/survey/status';
  let { state }: { state: SurveyState } = $props();
  const sections = $derived.by(() => {
    const groups = new Map<string, typeof state.visiblePoints>();
    for (const point of state.visiblePoints) { const key = state.activeRegion ? point.display.kecamatan : ''; const group = groups.get(key) ?? []; group.push(point); groups.set(key, group); }
    return [...groups].map(([key, items]) => ({ title: groups.size > 1 && key ? `Kec. ${key}` : '', items }));
  });
</script>
{#if !state.visiblePoints.length}
  <div class="panel-empty"><p>{state.query ? state.activeRegion ? `Tidak ada titik yang cocok di dalam ${state.activeRegion}.` : 'Tidak ada titik yang cocok dengan pencarian. Coba nomor titik, nama kabupaten, patokan lokasi, nama desa, atau koordinat.' : 'Belum ada titik untuk ditampilkan.'}</p>
    {#if state.query}<div class="panel-empty__actions">{#if state.activeRegion}<button type="button" onclick={() => state.openRegion(null, null, true)}>Cari di semua titik</button>{/if}<button type="button" onclick={() => { state.query = ''; document.getElementById('list-search')?.focus({ preventScroll: true }); }}>Hapus pencarian</button></div>{/if}
  </div>
{:else}
  {#each sections as section (section.title)}
    <div class="atlas-group">
      {#if section.title}<div class="atlas-section" role="heading" aria-level="3">{section.title}<span>{section.items.filter(point => !point.cadangan).length} titik</span></div>{/if}
      {#each desaGroups(section.items) as group (group.label + group.items[0].display.desa)}
        {@const head = groupHead(group, section.title)}
        {@const landmarks = group.items.map(point => landmarkFor(point, `${head.title} ${head.line} ${section.title}`))}
        {@const shared = landmarks.every(mark => mark && mark === landmarks[0]) ? landmarks[0] : ''}
        <div class="atlas-desa">
          <div class="atlas-desa__head"><span class="atlas-desa__title">{head.title}</span><span class="atlas-desa__count">{group.items.filter(point => !point.cadangan).length} titik</span></div>
          {#if head.line}<p class="atlas-desa__note">Rekapan: {head.line}</p>{/if}
          {#if shared}<p class="atlas-desa__note">{shared}</p>{/if}
          <div class="atlas-units">
            {#each group.items as point, index (point.nomor)}
              {@const flags = [point.cadangan ? STATUS_LABEL.cadangan.tag : '', point.duplikat ? STATUS_LABEL.duplikat.tag : '', point.belum ? STATUS_LABEL.belum.tag : ''].filter(Boolean)}
              <button class="atlas-pt" type="button" data-item-id={point.nomor} aria-label={[`Titik ${point.display.code}`, ...flags, point.display.primary].join('. ')} aria-pressed={state.selectedNomor === point.nomor} onclick={event => state.select(point.nomor, event.currentTarget)}>
                <span class="atlas-unit" class:is-active={state.selectedNomor === point.nomor} class:is-cadangan={point.cadangan} class:is-duplikat={point.duplikat} class:is-belum={point.belum}>{point.display.code}</span>
                <span class="atlas-pt__info">
                  {#if !shared && landmarks[index]}<span class="atlas-pt__note">{landmarks[index]}</span>{/if}
                  {#if point.belum}<span class="atlas-pt__coord atlas-pt__coord--none">Belum ada koordinat</span>
                  {:else}<span class="atlas-pt__coord">{point.koordinat.split(', ')[0]}<br/>{point.koordinat.split(', ')[1]}</span>{/if}
                </span>
              </button>
            {/each}
          </div>
        </div>
      {/each}
    </div>
  {/each}
{/if}
