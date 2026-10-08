<script lang="ts">
  import type { SurveyState } from '../state/survey.svelte';
  import type { LayerKey } from '../map/create-map';
  import LayerSwitch from './LayerSwitch.svelte';
  import { layerIcons } from '../map/layer-icons';
  let { state: model }: { state: SurveyState } = $props();
  let open = $state(false);
  const rows: { key: LayerKey; label: string }[] = [{ key: 'boundaries', label: 'Batas Kabupaten/Kota' }, { key: 'area', label: 'Area Cakupan' }, { key: 'mask', label: 'Fokus Provinsi' }];
  const points: { key: 'sk' | 'belum' | 'cadangan'; label: string }[] = [{ key: 'sk', label: 'Titik PUTS' }, { key: 'belum', label: 'Lokasi Belum Ditetapkan' }, { key: 'cadangan', label: 'Titik Cadangan' }];
</script>
<svelte:window onkeydown={event => { if (event.key === "Escape") open = false; }}/>
<div id="top-right-container">
  <div class="ol-unselectable ol-control layer-switcher layer-switcher-group-select-style-children layer-switcher-activation-mode-click activationModeClick" class:shown={open}>
    <button type="button" aria-label={open ? 'Tutup pilihan layer' : 'Tampilkan pilihan layer'} data-tooltip="Layer peta" aria-expanded={open} onclick={() => { open = !open; }}></button>
    <span class="ctl-layers-slot" aria-hidden="true"><svg class="ctl-layers" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false"><path class="ctl-layers__top" d="M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z"/><path class="ctl-layers__mid" d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65"/><path class="ctl-layers__bottom" d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65"/></svg></span>
    <div class="panel"><ul>
      <li class="group layer-switcher-fold layer-switcher-open"><span class="layer-group-title">Data Lapangan</span><ul>
        {#each points as point (point.key)}<li class="layer"><LayerSwitch id={`layer-${point.key}`} bind:checked={model.layers[point.key]}/><label for={`layer-${point.key}`}><img src={layerIcons[point.key]} alt=""/> {point.label}{#if point.key === 'cadangan'}{' '}<span class="layer-count">{model.points.filter(point => point.cadangan).length} titik</span>{/if}</label></li>{/each}
      </ul></li>
      {#each rows as row (row.key)}<li class="layer"><LayerSwitch id={`layer-${row.key}`} bind:checked={model.layers[row.key]}/><label for={`layer-${row.key}`}>{row.label}</label></li>{/each}
      <li class="group layer-switcher-base-group layer-switcher-fold layer-switcher-open"><span class="layer-group-title">Peta Dasar</span><ul>
        <li class="layer"><input type="radio" id="layer-google" name="basemap" checked={model.layers.google} onchange={() => { model.layers.google = true; model.layers.esri = false; }}/><label for="layer-google">Google Satelit</label></li>
        <li class="layer"><input type="radio" id="layer-esri" name="basemap" checked={model.layers.esri} onchange={() => { model.layers.google = false; model.layers.esri = true; }}/><label for="layer-esri">Esri Satelit</label></li>
      </ul></li>
    </ul></div>
    <img class="layer-switcher__watermark" src="/assets/logo-esdm.png" alt="Logo ESDM" draggable="false"/>
  </div>
</div>
