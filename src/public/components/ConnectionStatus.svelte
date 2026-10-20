<script lang="ts">
  import type { Connection } from '../state/connection.svelte';
  import Icon from './Icon.svelte';
  // hasData: points are on screen (fresh or stored), so offline only costs the imagery.
  let { connection, hasData }: { connection: Connection; hasData: boolean } = $props();
  const waitingForData = $derived(!hasData && connection.dataLoading);
  const kind = $derived(connection.offline ? 'offline' : connection.slow ? 'slow' : waitingForData ? 'loading' : null);
</script>
{#if kind}
  <p class={`connection-chip connection-chip--${kind}`} role="status">
    {#if kind === 'offline'}<Icon name="offline" size={16}/>{:else}<span class="connection-chip__spinner" aria-hidden="true"></span>{/if}
    <span>
      {#if kind === 'offline'}<b>Tidak ada internet.</b> {hasData ? 'Citra satelit tidak tampil; titik dan batas wilayah tetap bisa dibuka.' : 'Data titik dimuat begitu koneksi kembali.'}
      {:else if kind === 'slow'}<b>Sinyal lemah.</b> {waitingForData ? 'Memuat data titik…' : 'Citra peta dimuat pelan…'}
      {:else}Memuat data titik…{/if}
    </span>
  </p>
{/if}
