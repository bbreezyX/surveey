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
  import { distance, formatDistance } from './api';
  let { lat = $bindable(), lon = $bindable(), original }: { lat: number; lon: number; original?: { lat: number; lon: number } } = $props();
  let moved = $derived(original && [lat, lon, original.lat, original.lon].every(Number.isFinite) ? distance(original, { lat, lon }) : null);
  let target: HTMLDivElement;
  let map = $state<Map>();
  let source: VectorSource;
  let pin: Feature<Point> | undefined;
  const style = new Style({ image: new Circle({ radius: 8, fill: new Fill({ color: '#fee50f' }), stroke: new Stroke({ color: '#293d50', width: 3 }) }) });
  const oldStyle = new Style({ image: new Circle({ radius: 6, fill: new Fill({ color: '#66717c' }), stroke: new Stroke({ color: '#fff', width: 2 }) }) });
  onMount(() => {
    source = new VectorSource();
    const old = original && Number.isFinite(original.lon) && Number.isFinite(original.lat) ? new Feature(new Point(fromLonLat([original.lon, original.lat]))) : undefined;
    if (old) old.setStyle(oldStyle);
    const oldSource = new VectorSource({ features: old ? [old] : [] });
    const center = Number.isFinite(lon) && Number.isFinite(lat) ? [lon, lat] : [103.6, -1.6];
    const satellite = satelliteLayers();
    map = new Map({ target, layers: [satellite.esri, satellite.google,
      new VectorLayer({ source: oldSource }), new VectorLayer({ source, style })], view: new View({ center: fromLonLat(center), zoom: 17 }) });
    const satelliteCleanup = satellite.attach(map);
    const modify = new Modify({ source });
    map.addInteraction(modify);
    modify.on('modifyend', () => {
      const geometry = pin?.getGeometry();
      if (geometry) { const next = toLonLat(geometry.getCoordinates()); lon = +next[0].toFixed(8); lat = +next[1].toFixed(8); }
    });
    map.on('singleclick', event => { const next = toLonLat(event.coordinate); lon = +next[0].toFixed(8); lat = +next[1].toFixed(8); });
    const observer = new ResizeObserver(() => map?.updateSize()); observer.observe(target);
    return () => { observer.disconnect(); satelliteCleanup(); map?.setTarget(undefined); map?.dispose(); map = undefined; };
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
<div class="coordinate-map" bind:this={target} aria-label="Peta penyuntingan koordinat"></div>
<!-- The legend replaces the paragraph that explained the two pins in words. -->
<div class="map-bar">
  <p class="map-legend"><span class="map-dot map-dot--new" aria-hidden="true"></span>Baru{#if original}<span class="map-dot map-dot--old" aria-hidden="true"></span>Lama{#if moved}<span class="map-legend__distance" title="Jarak pin baru dari lokasi lama">· {formatDistance(moved)}</span>{/if}{/if}</p>
  <button type="button" class="btn-ghost" disabled={!Number.isFinite(lat) || !Number.isFinite(lon)} onclick={() => map?.getView().setCenter(fromLonLat([lon, lat]))}>Lihat lokasi baru</button>
</div>
<p class="hint">Klik peta atau geser pin; verifikasi tidak berubah.</p>
