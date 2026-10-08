import GeoJSON from 'ol/format/GeoJSON';
import Polygon from 'ol/geom/Polygon';
import MultiPolygon from 'ol/geom/MultiPolygon';
import { fromLonLat } from 'ol/proj';
import type { RegionFeature, SurveyPoint } from '../../shared/survey/types';
const geometryCache = new WeakMap<RegionFeature, { rings: number[][][]; extent: number[] }>();
export function thumbnail(region: RegionFeature | undefined, points: readonly SurveyPoint[], width = 160, height = 54, sharedExtent?: number[]) {
  if (!region) return { path: '', dots: [] as { x: number; y: number; kind: string; id: string }[] };
  let geometry = geometryCache.get(region);
  if (!geometry) {
    const parsed = new GeoJSON().readFeatures(region, { featureProjection: 'EPSG:3857' })[0]?.getGeometry();
    const rings = parsed instanceof Polygon ? parsed.getCoordinates() : parsed instanceof MultiPolygon ? parsed.getCoordinates().flat() : [];
    geometry = { rings, extent: parsed?.getExtent() ?? [0, 0, 1, 1] }; geometryCache.set(region, geometry);
  }
  const [left, bottom, right, top] = sharedExtent ?? geometry.extent;
  const scale = Math.min((width - 8) / (right - left || 1), (height - 8) / (top - bottom || 1));
  const transform = (coordinate: number[]) => [4 + (coordinate[0] - left) * scale, (height - (top - bottom) * scale) / 2 + (top - coordinate[1]) * scale];
  let path = '';
  for (const ring of geometry.rings) {
    let previous: number[] | null = null, count = 0;
    for (const coordinate of ring) { const point = transform(coordinate); if (previous && Math.abs(point[0] - previous[0]) + Math.abs(point[1] - previous[1]) < .6) continue; path += `${count++ ? 'L' : 'M'}${point[0].toFixed(1)} ${point[1].toFixed(1)}`; previous = point; }
    if (count > 2) path += 'Z';
  }
  return { path, dots: points.filter(point => !point.cadangan).map(point => { const [x, y] = transform(fromLonLat([point.lonNum, point.latNum])); return { x, y, kind: point.belum ? 'belum' : point.duplikat ? 'duplikat' : 'sk', id: point.nomor }; }).sort((a, b) => Number(a.kind !== 'sk') - Number(b.kind !== 'sk')) };
}
