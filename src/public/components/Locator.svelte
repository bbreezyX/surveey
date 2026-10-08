<script lang="ts">
  import GeoJSON from 'ol/format/GeoJSON';
  import { createEmpty, extend } from 'ol/extent';
  import type { RegionFeature } from '../../shared/survey/types';
  import { thumbnail } from '../map/shapes';
  import { regionKey } from '../data/regions';
  let { regions, active }: { regions: RegionFeature[]; active: string } = $props();
  const paths = $derived.by(() => {
    const extent = createEmpty();
    for (const feature of new GeoJSON().readFeatures({ type: 'FeatureCollection', features: regions }, { featureProjection: 'EPSG:3857' })) { const geometry = feature.getGeometry(); if (geometry) extend(extent, geometry.getExtent()); }
    return regions.map(region => ({ key: String(region.properties.KABUPATEN_), on: regionKey(String(region.properties.KABUPATEN_)) === regionKey(active), path: thumbnail(region, [], 112, 84, extent).path })).sort((a, b) => Number(a.on) - Number(b.on));
  });
</script>
<svg viewBox="0 0 112 84" aria-hidden="true" focusable="false">{#each paths as item (item.key)}<path class="atlas-loc" class:is-on={item.on} fill-rule="evenodd" d={item.path}/>{/each}</svg>
