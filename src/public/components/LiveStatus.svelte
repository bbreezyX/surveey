<script lang="ts">
  import { untrack } from 'svelte';
  // One polite live region, always in the DOM, written half a second after its text last changed: a search
  // answers once when typing stops, not per keystroke. It starts with the current text, so mounting announces
  // nothing. Its own component because Sidebar's `state` prop shadows the $state rune there.
  let { text }: { text: string } = $props();
  let shown = $state(untrack(() => text));
  $effect(() => { const next = text; const timer = setTimeout(() => { shown = next; }, 500); return () => clearTimeout(timer); });
</script>
<p class="visually-hidden" role="status">{shown}</p>
