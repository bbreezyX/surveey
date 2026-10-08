<script lang="ts">
  let { name, size = 20 }: { name: 'search' | 'close' | 'back' | 'collapse' | 'fit' | 'layers' | 'route' | 'external' | 'location' | 'coordinate' | 'calendar' | 'info'; size?: number } = $props();
</script>
<svg class:panel-icon={name === 'back' || name === 'fit' || name === 'collapse'} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
  {#if name === 'search'}<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>
  {:else if name === 'close'}<path d="m7 7 10 10M7 17 17 7"/>
  {:else if name === 'back'}<path d="m14.5 6-6 6 6 6"/>
  {:else if name === 'collapse'}<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><path d="M9.5 4.5v15M16 10l-2 2 2 2"/>
  {:else if name === 'fit'}<path d="M4 9V5a1 1 0 0 1 1-1h4M15 4h4a1 1 0 0 1 1 1v4M20 15v4a1 1 0 0 1-1 1h-4M9 20H5a1 1 0 0 1-1-1v-4"/><circle cx="12" cy="12" r="2.2"/>
  {:else if name === 'layers'}<path d="m12 3 9 5-9 5-9-5Zm-9 9 9 5 9-5m-18 5 9 5 9-5"/>
  {:else if name === 'route'}<path d="M21.4 2.6a1 1 0 0 0-1.06-.23L3.3 8.87a1 1 0 0 0 .06 1.88l6.86 2.29 2.29 6.86a1 1 0 0 0 .93.68h.03a1 1 0 0 0 .92-.62l6.5-17.04a1 1 0 0 0-.49-1.32z" fill="currentColor" stroke="none"/>
  {:else if name === 'location'}<path d="M20 10c0 6-8 12-8 12S4 16 4 10a8 8 0 1 1 16 0Z"/><circle cx="12" cy="10" r="2.5"/>
  {:else if name === 'coordinate'}<circle cx="12" cy="12" r="7"/><path d="M12 2v5m0 10v5M2 12h5m10 0h5"/>
  {:else if name === 'calendar'}<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4m10-4v4M3 10h18"/>
  {:else if name === 'info'}<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10v.1"/>
  {:else}<path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/>{/if}
</svg>
