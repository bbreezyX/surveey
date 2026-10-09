import GeoJSON from 'ol/format/GeoJSON';
import type OlFeature from 'ol/Feature';
import type { SurveyPoint, RegionFeature } from '../../shared/survey/types';
import { fromLonLat } from 'ol/proj';
import { toDisplayCase } from '../../shared/survey/display';
// Region assignment, the map layer and the sidebar thumbnails all need the
// kabupaten in EPSG:3857. Projecting ~36k vertices three times showed up in the
// first-render long task on a throttled phone, so each region is read once and
// shared; every consumer only reads the geometry.
const projected = new WeakMap<RegionFeature, OlFeature>();
export function projectRegions(regions: RegionFeature[]): OlFeature[] {
  const missing = regions.filter(region => !projected.has(region));
  if (missing.length) new GeoJSON().readFeatures({ type: 'FeatureCollection', features: missing }, { featureProjection: 'EPSG:3857' }).forEach((feature, index) => projected.set(missing[index], feature));
  return regions.map(region => projected.get(region)!);
}
// Keep the former projected nearest-boundary fallback for coastal/off-edge pins.
export function assignRegions(points: SurveyPoint[], boundaries: RegionFeature[]): void {
  const features = projectRegions(boundaries);
  for (const point of points) {
    const coordinate = fromLonLat([point.lonNum, point.latNum]);
    let feature = features.find(region => region.getGeometry()?.intersectsCoordinate(coordinate));
    if (!feature) {
      let nearest = Infinity;
      for (const region of features) {
        const closest = region.getGeometry()?.getClosestPoint(coordinate);
        if (!closest) continue;
        const distance = (closest[0] - coordinate[0]) ** 2 + (closest[1] - coordinate[1]) ** 2;
        if (distance < nearest) { nearest = distance; feature = region; }
      }
    }
    point.kabupaten = toDisplayCase(feature?.get('KABUPATEN_') ?? point.nomor.split('-')[0]) || 'Lainnya';
    point.searchText += ` ${point.kabupaten.toLowerCase()}`;
  }
}
export function regionKey(value: string): string { return value.toUpperCase().replace(/^KAB(UPATEN)?\.?\s+/, '').replace(/\s+/g, ' ').trim(); }
