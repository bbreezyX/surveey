<script lang="ts">
  import { onMount, tick } from 'svelte';
  import type { StatusFilter } from '../../shared/survey/types';
  import { latestDocumentationDate } from '../../shared/survey/dates';
  import type { SurveyState } from '../state/survey.svelte';
  import { createSheetGesture } from '../state/sheet-gesture';
  import Locator from './Locator.svelte';
  import { STATUS_LABEL, countOfficialPoints } from '../../shared/survey/status';
  import RegionGrid from './RegionGrid.svelte';
  import PointList from './PointList.svelte';
  import Icon from './Icon.svelte';
  let { state, onfit }: { state: SurveyState; onfit: () => void } = $props();
  let sidebar: HTMLElement, scroller: HTMLDivElement, search: HTMLInputElement;
  const gesture = createSheetGesture(() => sidebar, () => state.panelOpen, open => { state.panelOpen = open; state.select(null); }, () => document.body.classList.remove('is-sheet-hinting', 'is-sheet-nudging'));
  const regionPoints = $derived(state.points.filter(point => point.kabupaten === state.activeRegion));
  const filterFlags = $derived((['duplikat', 'belum'] as const).filter(key => regionPoints.some(point => point[key] && !point.cadangan)));
  const regionCount = $derived(countOfficialPoints(regionPoints));
  const filterCount = $derived(state.statusFilter ? regionPoints.filter(point => point[state.statusFilter!] && !point.cadangan).length : 0);
  const summary = $derived(state.statusFilter ? state.query ? `${state.count} dari ${filterCount} ${STATUS_LABEL[state.statusFilter].count}` : `${filterCount} ${STATUS_LABEL[state.statusFilter].count} dari ${regionCount} titik` : `${state.count} dari ${regionCount} titik`);
  let enterTimer: ReturnType<typeof setTimeout> | undefined;
  const latest = $derived(latestDocumentationDate(state.points.map(point => point.tanggal)));
  const dateLabel = $derived(latest ? new Intl.DateTimeFormat('id-ID', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(latest) : '2026');
  async function openRegion(name: string | null, filter: StatusFilter = null) {
    const previous = state.activeRegion; state.openRegion(name, filter); await tick();
    if (name !== previous) { sidebar.removeAttribute('data-enter'); void sidebar.offsetWidth; sidebar.dataset.enter = name ? 'fwd' : 'back'; clearTimeout(enterTimer); enterTimer = setTimeout(() => sidebar.removeAttribute('data-enter'), 320); }
    if (name) sidebar.querySelector<HTMLButtonElement>('.atlas-back')?.focus({ preventScroll: true });
    else [...sidebar.querySelectorAll<HTMLButtonElement>('[data-region]')].find(button => button.dataset.region === previous)?.focus({ preventScroll: true });
  }
  async function collapse() { state.sidebarCollapsed = true; await tick(); document.getElementById('panel-toggle')?.focus({ preventScroll: true }); }
  function measurePeek() { if (sidebar && window.innerWidth < 960) { const label = sidebar.querySelector('.panel-search'); if (label instanceof HTMLElement) document.documentElement.style.setProperty('--sheet-peek', `${Math.round(label.offsetTop + label.offsetHeight + 14)}px`); } }
  onMount(() => { const observer = new ResizeObserver(measurePeek); observer.observe(sidebar); observer.observe(sidebar.querySelector('#panel-top')!); window.addEventListener('resize', measurePeek); measurePeek(); return () => { clearTimeout(enterTimer); gesture.dispose(); observer.disconnect(); window.removeEventListener('resize', measurePeek); document.documentElement.style.removeProperty('--sheet-peek'); }; });
  $effect(() => { state.activeRegion; state.statusFilter; state.query; if (scroller) scroller.scrollTop = 0; });
  function syncScroll() {
    sidebar.classList.toggle('is-scrolled', scroller.scrollTop > 2);
    const heads = [...scroller.querySelectorAll<HTMLElement>('.atlas-section')]; const top = scroller.getBoundingClientRect().top;
    const stuck = heads.filter(head => head.getBoundingClientRect().top <= top + 1).at(-1);
    for (const head of heads) head.classList.toggle('is-stuck', scroller.scrollTop > 2 && head === stuck);
  }
</script>
<aside id="sidebar" aria-label="Daftar titik PUTS" bind:this={sidebar} inert={state.sidebarCollapsed} data-screen={state.activeRegion ? 'items' : 'groups'}>
  <button id="sheet-handle" type="button" aria-controls="sidebar" aria-expanded={state.panelOpen} aria-label={state.panelOpen ? 'Tutup daftar titik' : 'Lihat daftar titik'} onclick={gesture.click} onpointerdown={gesture.down} onpointermove={gesture.move} onpointerup={gesture.up} onpointercancel={gesture.cancel}>
    <span class="sheet-handle__grabber" aria-hidden="true"></span><span class="sheet-handle__text" aria-hidden="true">{state.panelOpen ? 'Tutup daftar titik' : 'Lihat daftar titik'}</span>
  </button>
  <div class="panel-top" id="panel-top">
    {#if state.activeRegion}
      <div class="atlas-detail"><div class="atlas-detail__bar"><button class="atlas-back" type="button" aria-label="Kembali ke semua wilayah" onclick={() => openRegion(null)}><Icon name="back" size={16}/>Semua wilayah</button><button class="panel-collapse" type="button" aria-label="Sembunyikan daftar" onclick={collapse}><Icon name="collapse"/></button></div>
        <div class="atlas-detail__main"><div><h1>{state.activeRegion}</h1><p><b>{countOfficialPoints(regionPoints)}</b> titik di <b>{new Set(regionPoints.filter(p => !p.cadangan).map(p => p.display.kecamatan)).size}</b> kecamatan</p></div><div class="atlas-locator" role="img" aria-label={`Letak ${state.activeRegion} di Provinsi Jambi`}><Locator regions={state.dataset.boundaries} active={state.activeRegion}/></div></div></div>
    {:else}<div class="atlas-head"><img src="/assets/lambang-jambi.png" alt="Lambang Provinsi Jambi" width="38" height="39" decoding="async"/><div><p class="atlas-head__org">Dinas ESDM Provinsi Jambi</p><h1 class="atlas-head__title">Sebaran PUTS 2026</h1></div><button class="panel-collapse" type="button" aria-label="Sembunyikan daftar" onclick={collapse}><Icon name="collapse"/></button></div>{/if}
  </div>
  <div class="panel-search"><span class="panel-search__icon"><Icon name="search" size={18}/></span><input id="list-search" type="search" aria-label="Cari titik PUTS" placeholder={state.activeRegion ? `Cari dalam ${state.activeRegion}…` : "Cari lokasi atau kabupaten…"} title="Cari titik, lokasi, kabupaten, atau koordinat" autocomplete="off" bind:value={state.query} bind:this={search} onfocus={() => { if (innerWidth < 960) state.panelOpen = true; }}/>{#if state.query}<button class="panel-search__clear" id="list-search-clear" type="button" aria-label="Hapus pencarian" onclick={() => { state.query = ''; search.focus({ preventScroll: true }); }}><Icon name="close" size={16}/></button>{/if}</div>
  <div class="panel-meta" id="panel-meta">
    {#if state.activeRegion}
      {#if filterFlags.length}<div class="atlas-pills" role="group" aria-label="Saring menurut status">
        <button class="atlas-pill" aria-pressed={state.statusFilter === null} onclick={() => state.setFilter(null)}>Semua <b>{countOfficialPoints(regionPoints)}</b></button>
        {#each filterFlags as key (key)}
          {#if regionPoints.some(point => key === 'duplikat' ? point.duplikat : key === 'belum' ? point.belum : point.cadangan)}
            <button class="atlas-pill" aria-pressed={state.statusFilter === key} onclick={() => state.setFilter(state.statusFilter === key ? null : key)}><span class={`atlas-pill__swatch atlas-pill__swatch--${key}`} aria-hidden="true"></span>{key === 'duplikat' ? 'Perlu verifikasi' : 'Belum ditetapkan'} <b>{regionPoints.filter(point => point[key] && !point.cadangan).length}</b></button>
          {/if}
        {/each}
      </div>{/if}<p class="atlas-hint" role="status">{state.query || state.statusFilter ? summary : 'Pilih nomor titik untuk melihatnya di peta.'}</p>
    {:else if state.query}<p class="atlas-summary" role="status">{state.count} titik cocok di {new Set(state.visiblePoints.map(point => point.kabupaten)).size} kabupaten</p>
    {:else}<div class="atlas-summary atlas-summary--total"><p class="atlas-total" role="status"><b class="atlas-total__num">{state.count}</b><span class="atlas-total__label"><span>titik PUTS</span><span>di <b>{state.regionNames.length}</b> kabupaten/kota</span></span></p><button id="fit-map" type="button" class="atlas-fit" aria-label="Lihat semua" title="Tampilkan semua titik di peta" onclick={onfit}><Icon name="fit" size={16}/><span>Lihat semua</span></button></div>{/if}
  </div>
  <div class="sidebar-scroll" bind:this={scroller} onscroll={syncScroll}><div id="list-data" aria-live="polite">{#if !state.points.length}<p class="list-empty">Belum ada titik untuk ditampilkan.</p>{:else if !state.activeRegion && !state.query}<RegionGrid {state} onopen={openRegion}/>{:else}<PointList {state}/>{/if}</div></div>
  <p class="sidebar-footer"><span class="sidebar-footer__title">Survey lapangan &amp; pelaksanaan</span><span class="sidebar-footer__meta">s.d. {dateLabel} · Dinas ESDM Jambi</span></p>
</aside>
