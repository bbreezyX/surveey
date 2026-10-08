import GeoJSON from 'ol/format/GeoJSON';
import type { SurveyPoint, RegionFeature } from '../../shared/survey/types';
import { fromLonLat } from 'ol/proj';
import { toDisplayCase } from '../../shared/survey/display';
// Keep the former projected nearest-boundary fallback for coastal/off-edge pins.
export function assignRegions(points: SurveyPoint[], boundaries: RegionFeature[]): void {
  const features = new GeoJSON().readFeatures({ type: 'FeatureCollection', features: boundaries }, { featureProjection: 'EPSG:3857' });
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
