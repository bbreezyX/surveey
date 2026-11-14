<script lang="ts">
  import { tick } from 'svelte';
  import type { SurveyState } from '../state/survey.svelte';
  import type { SurveyPoint } from '../../shared/survey/types';
  import { STAGE_COUNT_LABEL, TODAY_ARROW, workBadgeSvg, type TodayUnit } from '../../shared/survey/progress';
  // "Hari ini" under the province total: how many units moved a step today and, on tap, which ones, newest first.
  // A row opens its unit on the map, as a list row does. Sidebar renders this only when the feed names any.
  // `state` is renamed here: a prop called state would shadow the $state rune this component needs.
  let { state: survey, list }: { state: SurveyState; list: readonly TodayUnit<SurveyPoint>[] } = $props();
  let button = $state<HTMLButtonElement>(), panel = $state<HTMLDivElement>();
  let open = $state(false);
  // The Popover API (top layer, light dismiss, Esc) where the phone has it. Older phones get the same panel toggled
  // by hand, without the attribute: there an unknown `popover` would leave the list showing for good.
  const native = typeof HTMLElement !== 'undefined' && Object.prototype.hasOwnProperty.call(HTMLElement.prototype, 'popover');
  const day = new Intl.DateTimeFormat('id-ID', { timeZone: 'Asia/Jakarta', weekday: 'long', day: 'numeric', month: 'long' }).format(new Date());
  const clock = new Intl.DateTimeFormat('id-ID', { timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const WIDTH = 340, GUTTER = 12;
  // Under the chip, right edges lined up, kept inside the window. Placed before it shows (beforetoggle), so it never
  // flashes at the corner; the width is the CSS one, since a closed popover has none to measure.
  function place() {
    if (!button || !panel) return;
    const rect = button.getBoundingClientRect(), width = Math.min(WIDTH, innerWidth - GUTTER * 2);
    panel.style.top = `${Math.round(rect.bottom + 8)}px`;
    panel.style.left = `${Math.round(Math.max(GUTTER, Math.min(rect.right - width, innerWidth - width - GUTTER)))}px`;
  }
  function close() { if (native) panel?.hidePopover(); else open = false; }
  async function toggleByHand() { open = !open; if (open) { await tick(); place(); } }
  function openPoint(nomor: string) { close(); survey.select(nomor, button ?? null); }
  $effect(() => {
    if (native || !open) return;
    const outside = (event: PointerEvent) => { if (!panel?.contains(event.target as Node) && !button?.contains(event.target as Node)) open = false; };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { open = false; button?.focus(); } };
    document.addEventListener('pointerdown', outside, true); document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside, true); document.removeEventListener('keydown', escape); };
  });
</script>
{#if native}
  <button class="today-chip" type="button" bind:this={button} popovertarget="today-pop" aria-label={`${list.length} progres hari ini, lihat daftar`}>{@html TODAY_ARROW}{list.length} hari ini</button>
{:else}
  <button class="today-chip" type="button" bind:this={button} aria-expanded={open} aria-controls="today-pop" aria-label={`${list.length} progres hari ini, lihat daftar`} onclick={toggleByHand}>{@html TODAY_ARROW}{list.length} hari ini</button>
{/if}
<div class="today-pop" id="today-pop" bind:this={panel} {...(native ? { popover: 'auto' } : { hidden: !open })} onbeforetoggle={(event: ToggleEvent) => { if (event.newState === 'open') place(); }}>
  <p class="today-pop__title">Progres hari ini</p>
  <p class="today-pop__day">{day} · WIB</p>
  <ul class="today-pop__list">
    {#each list as item (item.unit.nomor)}
      <li><button class="today-row" type="button" onclick={() => openPoint(item.unit.nomor)}>
        <time>{clock.format(item.at)}</time>
        <span class="today-row__badge" aria-hidden="true">{@html workBadgeSvg(item.step)}</span>
        <span class="today-row__text"><b>{STAGE_COUNT_LABEL[item.step]} · Titik {item.unit.display.code} {item.unit.display.desa || item.unit.display.primary}</b><small>{item.unit.kabupaten} · Kec. {item.unit.display.kecamatan}</small></span>
      </button></li>
    {/each}
  </ul>
</div>
