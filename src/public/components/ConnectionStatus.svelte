<script lang="ts">
  import type { Connection } from '../state/connection.svelte';
  import Icon from './Icon.svelte';
  // hasData: points are on screen (fresh or stored), so offline only costs the imagery.
  let { connection, hasData }: { connection: Connection; hasData: boolean } = $props();
  const waitingForData = $derived(!hasData && connection.dataLoading);
  // A plain first load gets no chip: until points arrive the panel (sidebar, or the sheet's peek on
  // phones) already shows its own spinner with "Memuat data titik…", so a chip would only repeat it.
  // Weak signal and offline still get one, because the panel says nothing about the connection.
  const kind = $derived(connection.offline ? 'offline' : connection.slow ? 'slow' : null);
</script>
{#if kind}
  <p class={`connection-chip connection-chip--${kind}`} role="status">
    {#if kind === 'offline'}<Icon name="offline" size={16}/>{:else}<span class="connection-chip__spinner" aria-hidden="true"></span>{/if}
    <span>
      {#if kind === 'offline'}<b>Tidak ada internet.</b> {hasData ? 'Citra satelit tidak tampil; titik dan batas wilayah tetap bisa dibuka.' : 'Data titik dimuat begitu koneksi kembali.'}
      {:else}<b>Sinyal lemah.</b> {waitingForData ? 'Memuat data titik…' : 'Citra peta dimuat pelan…'}{/if}
    </span>
  </p>
{/if}
