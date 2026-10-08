<script lang="ts">
  import { onMount } from 'svelte';
  let { busy }: { busy: boolean } = $props();
  let gesture = $state(false);
  let timers: ReturnType<typeof setTimeout>[] = [];
  function count(key: string) { try { return parseInt(localStorage.getItem(key) ?? '0', 10) || 0; } catch { return 0; } }
  function bump(key: string) { try { localStorage.setItem(key, String(count(key) + 1)); } catch { /* Storage disabled: hints remain available. */ } }
  function stop() { gesture = false; timers.forEach(clearTimeout); timers = []; document.body.classList.remove('is-sheet-hinting', 'is-sheet-nudging'); }
  function sheetHint() {
    if (busy || innerWidth >= 960 || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    document.body.classList.add('is-sheet-hinting');
    timers.push(setTimeout(() => document.body.classList.remove('is-sheet-hinting'), 12000));
    if (count('puts.sheetNudge') < 3) { bump('puts.sheetNudge'); document.body.classList.add('is-sheet-nudging'); timers.push(setTimeout(() => document.body.classList.remove('is-sheet-nudging'), 2000)); }
  }
  onMount(() => {
    if (innerWidth < 960 && !busy) {
      if (count('puts.gestureHints') < 3 && !matchMedia('(prefers-reduced-motion: reduce)').matches) { bump('puts.gestureHints'); gesture = true; timers.push(setTimeout(() => { gesture = false; timers.push(setTimeout(sheetHint, 650)); }, 3300)); }
      else timers.push(setTimeout(sheetHint, 600));
    }
    const interaction = () => stop();
    document.addEventListener('pointerdown', interaction, true);
    document.addEventListener('focusin', interaction, true);
    return () => { stop(); document.removeEventListener('pointerdown', interaction, true); document.removeEventListener('focusin', interaction, true); };
  });
  $effect(() => { if (busy) stop(); });
</script>
{#if gesture}
  <div class="gesture-hint is-visible" aria-hidden="true">
    <svg class="gesture-hint__icon" viewBox="0 0 64 64" width="84" height="84" aria-hidden="true" focusable="false">
      <g class="gesture-hint__track"><path d="M19 27 45 9"/></g>
      <circle class="gesture-hint__tip gesture-hint__tip--a" cx="27" cy="21.5" r="4.5"/><circle class="gesture-hint__tip gesture-hint__tip--b" cx="37" cy="14.5" r="4.5"/>
      <g class="gesture-hint__hand" transform="translate(14 22) scale(1.55)"><path d="M22 14a8 8 0 0 1-8 8M18 11v-1a2 2 0 0 0-2-2a2 2 0 0 0-2 2M14 10V9a2 2 0 0 0-2-2a2 2 0 0 0-2 2v1M10 9.5V4a2 2 0 0 0-2-2a2 2 0 0 0-2 2v10M18 11a2 2 0 1 1 4 0v3a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"/></g>
    </svg>
    <p class="gesture-hint__title">Cubit untuk memperbesar</p><p class="gesture-hint__text">Geser satu jari untuk menjelajah peta</p>
  </div>
{/if}
