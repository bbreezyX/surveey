<script lang="ts">
  import { onMount } from 'svelte';
  import Map from 'ol/Map';
  import View from 'ol/View';
  import VectorLayer from 'ol/layer/Vector';
  import VectorSource from 'ol/source/Vector';
  import Feature from 'ol/Feature';
  import Point from 'ol/geom/Point';
  import Modify from 'ol/interaction/Modify';
  import { fromLonLat, toLonLat } from 'ol/proj';
  import { containsCoordinate } from 'ol/extent';
  import { Style, Circle, Fill, Stroke } from 'ol/style';
  import { satelliteLayers } from '../../src/public/map/google-tiles';
  import type { Basemap } from '../../src/public/state/work-memory';
  import type { MapPoint } from './backdrop';
  import { distance, formatDistance } from './api';
  let { lat = $bindable(), lon = $bindable(), original, disabled = false, nearby = [], currentId }: {
    lat: number; lon: number; original?: { lat: number; lon: number };
    disabled?: boolean; nearby?: readonly MapPoint[]; currentId?: string;
  } = $props();
  let moved = $derived(original && [lat, lon, original.lat, original.lon].every(Number.isFinite) ? distance(original, { lat, lon }) : null);
  let target: HTMLDivElement;
  let map = $state<Map>();
  let basemap = $state<Basemap>('esri');
  let hoveredNeighbor = $state('');
  let layers = $state.raw<ReturnType<typeof satelliteLayers>>();
  let source: VectorSource;
  let nearbySource: VectorSource;
  let modifyInteraction: Modify | undefined;
  let pin: Feature<Point> | undefined;
  const style = new Style({ image: new Circle({ radius: 8, fill: new Fill({ color: '#fee50f' }), stroke: new Stroke({ color: '#293d50', width: 3 }) }) });
  const oldStyle = new Style({ image: new Circle({ radius: 6, fill: new Fill({ color: '#66717c' }), stroke: new Stroke({ color: '#fff', width: 2 }) }) });
  const neighborStyle = new Style({ image: new Circle({ radius: 5, fill: new Fill({ color: 'rgba(0, 114, 188, 0.78)' }), stroke: new Stroke({ color: '#fff', width: 1.5 }) }) });
  const neighborDupStyle = new Style({ image: new Circle({ radius: 5, fill: new Fill({ color: 'rgba(232, 115, 26, 0.85)' }), stroke: new Stroke({ color: '#fff', width: 1.5 }) }) });
  function pickBasemap(next: Basemap) { basemap = next; }
  function resetPin() {
    if (!original || disabled) return;
    lat = original.lat; lon = original.lon;
  }
  onMount(() => {
    source = new VectorSource();
    nearbySource = new VectorSource();
    const old = original && Number.isFinite(original.lon) && Number.isFinite(original.lat) ? new Feature(new Point(fromLonLat([original.lon, original.lat]))) : undefined;
    if (old) old.setStyle(oldStyle);
    const oldSource = new VectorSource({ features: old ? [old] : [] });
    const hasCoords = Number.isFinite(lon) && Number.isFinite(lat);
    const center = hasCoords ? [lon, lat] : [102.85, -1.62];
    const satellite = satelliteLayers(() => { basemap = 'esri'; });
    satellite.esri.setVisible(basemap === 'esri');
    satellite.google.setVisible(basemap === 'google');
    layers = satellite;
    const nearbyLayer = new VectorLayer({
      source: nearbySource,
      style: feature => feature.get('duplikat') ? neighborDupStyle : neighborStyle,
    });
    map = new Map({ target, layers: [satellite.esri, satellite.google,
      nearbyLayer, new VectorLayer({ source: oldSource }), new VectorLayer({ source, style })],
      view: new View({ center: fromLonLat(center), zoom: hasCoords ? 17 : 8 }) });
    const satelliteCleanup = satellite.attach(map);
    const modify = new Modify({ source });
    modify.setActive(!disabled);
    modifyInteraction = modify;
    map.addInteraction(modify);
    modify.on('modifyend', () => {
      if (disabled) return;
      const geometry = pin?.getGeometry();
      if (geometry) { const next = toLonLat(geometry.getCoordinates()); lon = +next[0].toFixed(6); lat = +next[1].toFixed(6); }
    });
    map.on('singleclick', event => {
      if (disabled) return;
      const next = toLonLat(event.coordinate); lon = +next[0].toFixed(6); lat = +next[1].toFixed(6);
    });
    map.on('pointermove', event => {
      const hit = map?.forEachFeatureAtPixel(event.pixel, feature => feature, { layerFilter: layer => layer === nearbyLayer, hitTolerance: 5 });
      hoveredNeighbor = hit ? String(hit.get('label') || '') : '';
    });
    const observer = new ResizeObserver(() => map?.updateSize()); observer.observe(target);
    return () => { observer.disconnect(); satelliteCleanup(); map?.setTarget(undefined); map?.dispose(); map = undefined; layers = undefined; modifyInteraction = undefined; };
  });
  $effect(() => {
    modifyInteraction?.setActive(!disabled);
  });
  $effect(() => {
    layers?.esri.setVisible(basemap === 'esri');
    layers?.google.setVisible(basemap === 'google');
  });
  $effect(() => {
    if (!map || !nearbySource) return;
    nearbySource.clear(true);
    const refLat = Number.isFinite(lat) ? lat : original?.lat;
    const refLon = Number.isFinite(lon) ? lon : original?.lon;
    if (!Number.isFinite(refLat) || !Number.isFinite(refLon)) return;
    const features: Feature<Point>[] = [];
    for (const point of nearby) {
      if (point.id === currentId || point.status === 'Cadangan') continue;
      // Only plot points within ~2.5 km so the small editor map stays fast and uncluttered.
      if (Math.abs(point.lat - refLat!) > 0.025 || Math.abs(point.lon - refLon!) > 0.025) continue;
      const dist = distance({ lat: refLat!, lon: refLon! }, point);
      const label = `${point.nomor || point.id}${Number.isFinite(dist) ? ` (${formatDistance(dist)})` : ''}`;
      features.push(new Feature({ geometry: new Point(fromLonLat([point.lon, point.lat])), duplikat: point.duplikat, label }));
    }
    if (features.length) nearbySource.addFeatures(features);
  });
  $effect(() => {
    if (map && Number.isFinite(lon) && Number.isFinite(lat) && Math.abs(lon) <= 180 && Math.abs(lat) <= 90) {
      const xy = fromLonLat([lon, lat]);
      if (!pin) { pin = new Feature(new Point(xy)); source.addFeature(pin); }
      else pin.getGeometry()?.setCoordinates(xy);
      // Typed coordinates can land anywhere; follow them once the pin leaves
      // the view. A click or drag always stays inside it, so those don't jump.
      const view = map.getView();
      if (!containsCoordinate(view.calculateExtent(map.getSize()), xy)) view.setCenter(xy);
    }
  });
</script>
<div class="coordinate-map-frame">
  <div class="coordinate-map" bind:this={target} aria-label="Peta Penyuntingan Koordinat"></div>
  <div class="map-basemap" role="group" aria-label="Peta Dasar">
    <button type="button" aria-pressed={basemap === 'esri'} onclick={() => pickBasemap('esri')}>Esri</button>
    <button type="button" aria-pressed={basemap === 'google'} onclick={() => pickBasemap('google')}>Google</button>
  </div>
  {#if hoveredNeighbor}<div class="map-hover" aria-hidden="true">{hoveredNeighbor}</div>{/if}
</div>
<!-- The legend replaces the paragraph that explained the two pins in words. -->
<div class="map-bar">
  <p class="map-legend"><span class="map-dot map-dot--new" aria-hidden="true"></span>Baru{#if original}<span class="map-dot map-dot--old" aria-hidden="true"></span>Lama{#if moved}<span class="map-legend__distance" title="Jarak pin baru dari lokasi lama">· {formatDistance(moved)}</span>{/if}{/if}{#if nearby.length}<span class="map-dot map-dot--neighbor" aria-hidden="true"></span>Sekitar{/if}</p>
  <div class="map-bar__actions">
    {#if original && moved}<button type="button" class="text-action" disabled={disabled} onclick={resetPin}>Kembalikan Pin</button>{/if}
    <button type="button" class="btn-ghost" disabled={!Number.isFinite(lat) || !Number.isFinite(lon)} onclick={() => map?.getView().setCenter(fromLonLat([lon, lat]))}>Lihat Lokasi</button>
  </div>
</div>
<p class="hint">Klik peta atau geser pin (presisi 6 desimal); verifikasi tidak berubah.</p>
