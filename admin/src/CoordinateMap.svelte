<script lang="ts">
  import { onMount } from 'svelte';
  import Map from 'ol/Map';
  import View from 'ol/View';
  import TileLayer from 'ol/layer/Tile';
  import VectorLayer from 'ol/layer/Vector';
  import VectorSource from 'ol/source/Vector';
  import XYZ from 'ol/source/XYZ';
  import Feature from 'ol/Feature';
  import Point from 'ol/geom/Point';
  import Modify from 'ol/interaction/Modify';
  import { fromLonLat, toLonLat } from 'ol/proj';
  import { Style, Circle, Fill, Stroke } from 'ol/style';
  let { lat = $bindable(), lon = $bindable(), original }: { lat: number; lon: number; original?: { lat: number; lon: number } } = $props();
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
    map = new Map({ target, layers: [new TileLayer({ source: new XYZ({ url: 'https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}', maxZoom: 21, attributions: 'Tiles © Google' }) }),
      new VectorLayer({ source: oldSource }), new VectorLayer({ source, style })], view: new View({ center: fromLonLat(center), zoom: 17 }) });
    const modify = new Modify({ source });
    map.addInteraction(modify);
    modify.on('modifyend', () => {
      const geometry = pin?.getGeometry();
      if (geometry) { const next = toLonLat(geometry.getCoordinates()); lon = +next[0].toFixed(8); lat = +next[1].toFixed(8); }
    });
    map.on('singleclick', event => { const next = toLonLat(event.coordinate); lon = +next[0].toFixed(8); lat = +next[1].toFixed(8); });
    const observer = new ResizeObserver(() => map?.updateSize()); observer.observe(target);
    return () => { observer.disconnect(); map?.setTarget(undefined); map?.dispose(); map = undefined; };
  });
  $effect(() => {
    if (map && Number.isFinite(lon) && Number.isFinite(lat) && Math.abs(lon) <= 180 && Math.abs(lat) <= 90) {
      const xy = fromLonLat([lon, lat]);
      if (!pin) { pin = new Feature(new Point(xy)); source.addFeature(pin); }
      else pin.getGeometry()?.setCoordinates(xy);
    }
  });
</script>
<div class="coordinate-map" bind:this={target} aria-label="Peta penyuntingan koordinat"></div>
<button type="button" disabled={!Number.isFinite(lat) || !Number.isFinite(lon)} onclick={() => map?.getView().setCenter(fromLonLat([lon, lat]))}>Lihat lokasi usulan</button>
<p class="hint">Klik pada peta atau pergeseran pin kuning mengubah koordinat usulan. Pin abu-abu menandai lokasi sebelumnya. Pemindahan pin tidak menandai lokasi sebagai terverifikasi.</p>
