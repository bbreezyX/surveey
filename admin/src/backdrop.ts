import OlMap from 'ol/Map';
import View from 'ol/View';
import Feature from 'ol/Feature';
import Point from 'ol/geom/Point';
import GeoJSON from 'ol/format/GeoJSON';
import VectorSource from 'ol/source/Vector';
import XYZ from 'ol/source/XYZ';
import VectorLayer from 'ol/layer/Vector';
import TileLayer from 'ol/layer/Tile';
import Attribution from 'ol/control/Attribution';
import { fromLonLat } from 'ol/proj';
import { unByKey } from 'ol/Observable';
import type { SurveyPoint } from '../../src/shared/survey/types';
import { pointStyle, boundaryStyle, maskStyle } from '../../src/public/map/styles';

// The public map drawn behind the login sheet and the dashboard, using the
// public map's own pin and boundary styles so both read as the same map.
// It is scenery: no zoom or pan, and it always frames the whole province
// the same way, so the login page and the dashboard line up across the
// full-page navigation between them.
export interface MapPoint { id: string; lon: number; lat: number; status: string; duplikat: boolean }

export function createBackdrop(target: HTMLElement, options: { onSelect?: (id: string) => void } = {}) {
  const format = new GeoJSON({ featureProjection: 'EPSG:3857' });
  const mask = new VectorLayer({ source: new VectorSource() });
  const regions = new VectorLayer({ source: new VectorSource({ attributions: 'Batas &copy; BIG' }), style: boundaryStyle });
  const pins = new VectorSource();
  let selected: string | null = null;
  const pinLayer = new VectorLayer({ source: pins, style: (feature, resolution) => {
    // pointStyle only reads the three status flags.
    const flags = { cadangan: feature.get('status') === 'Cadangan', belum: feature.get('status') === 'Belum Ditetapkan', duplikat: !!feature.get('duplikat') };
    return pointStyle(flags as SurveyPoint, resolution, feature.getId() === selected);
  } });
  const map = new OlMap({
    target,
    layers: [new TileLayer({ source: new XYZ({ url: 'https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}', maxZoom: 21, attributions: 'Tiles &copy; Google' }) }), mask, regions, pinLayer],
    view: new View({ center: fromLonLat([102.85, -1.62]), zoom: 8 }),
    controls: [new Attribution({ collapsible: false })],
    interactions: [],
  });
  const frame = () => {
    const extent = mask.getSource()!.getExtent();
    if (!Number.isFinite(extent[0])) return;
    const narrow = innerWidth < 700;
    map.getView().fit(extent, { padding: narrow ? [24, 16, 24, 16] : [56, 56, 56, 56] });
  };
  const load = (url: string) => fetch(url, { credentials: 'same-origin' }).then(r => r.ok ? r.json() : Promise.reject(new Error(url)));
  let disposed = false;
  Promise.all([load('/admin/assets/provinsi.json'), load('/admin/assets/kabupaten.json')]).then(([province, kabupaten]) => {
    if (disposed) return;
    const outline = format.readFeatures(province);
    mask.getSource()!.addFeatures(outline);
    mask.setStyle(maskStyle(outline));
    regions.getSource()!.addFeatures(format.readFeatures(kabupaten));
    frame();
  }).catch(() => { /* Scenery only: a missing boundary leaves plain imagery. */ });
  addEventListener('resize', frame);
  const click = map.on('click', event => {
    const hit = map.forEachFeatureAtPixel(event.pixel, feature => feature, { layerFilter: layer => layer === pinLayer, hitTolerance: 4 });
    if (hit && options.onSelect) options.onSelect(String(hit.getId()));
  });
  const hover = map.on('pointermove', event => {
    if (!options.onSelect) return;
    target.style.cursor = map.hasFeatureAtPixel(event.pixel, { layerFilter: layer => layer === pinLayer, hitTolerance: 4 }) ? 'pointer' : '';
  });
  return {
    setPoints(points: MapPoint[]) {
      pins.clear(true);
      pins.addFeatures(points.map(point => {
        const feature = new Feature({ geometry: new Point(fromLonLat([point.lon, point.lat])), status: point.status, duplikat: point.duplikat });
        feature.setId(point.id);
        return feature;
      }));
    },
    setSelected(id: string | null) { selected = id; pinLayer.changed(); },
    dispose() {
      disposed = true;
      removeEventListener('resize', frame);
      unByKey([click, hover]);
      map.setTarget(undefined); map.dispose();
    },
  };
}
