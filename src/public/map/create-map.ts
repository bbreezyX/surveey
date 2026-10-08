import OlMap from 'ol/Map';
import View from 'ol/View';
import Feature from 'ol/Feature';
import Point from 'ol/geom/Point';
import GeoJSON from 'ol/format/GeoJSON';
import VectorSource from 'ol/source/Vector';
import XYZ from 'ol/source/XYZ';
import VectorLayer from 'ol/layer/Vector';
import TileLayer from 'ol/layer/Tile';
import Overlay from 'ol/Overlay';
import { defaults as defaultInteractions } from 'ol/interaction/defaults';
import { defaults as defaultControls } from 'ol/control/defaults';
import { FullWidthScaleLine } from './scale';
import { inAndOut } from 'ol/easing';
import { fromLonLat } from 'ol/proj';
import { createEmpty, extendCoordinate } from 'ol/extent';
import type { SurveyDataset, SurveyPoint } from '../../shared/survey/types';
import { attachPointFeedback } from './feedback';
import { attachControlLayout } from './controls';
import { unByKey } from 'ol/Observable';
import { pointStyle, boundaryStyle, maskStyle } from './styles';
export type LayerKey = 'google' | 'esri' | 'boundaries' | 'mask' | 'area' | 'sk' | 'cadangan' | 'belum';
export interface FitOptions { duration?: number; maxZoom?: number; padding?: number[] }
export interface SurveyMapAdapter {
  setSelection(nomor: string | null): void;
  setVisiblePoints(ids: ReadonlySet<string>): void;
  fitToPoints(ids: ReadonlySet<string>, options?: FitOptions): void;
  setLayerVisibility(key: LayerKey, visible: boolean): void;
  updateSize(): void;
  dispose(): void;
}
export function createSurveyMap(options: { target: HTMLElement; popup: HTMLElement; dataset: SurveyDataset; onSelect: (nomor: string | null) => void }): SurveyMapAdapter {
  const { points, boundaries, dissolved } = options.dataset;
  const byId = new Map(points.map(point => [point.nomor, point]));
  const coordinateKey = (point: SurveyPoint) => `${point.latNum.toFixed(6)},${point.lonNum.toFixed(6)}`;
  const atCoordinate = new Map<string, SurveyPoint[]>();
  for (const point of points) { const key = coordinateKey(point), group = atCoordinate.get(key) ?? []; group.push(point); atCoordinate.set(key, group); }
  let visibleIds: ReadonlySet<string> = new Set(points.map(point => point.nomor));
  let selected: string | null = null, disposed = false;
  const flags = { sk: true, cadangan: false, belum: true };
  const format = new GeoJSON();
  const projection = { featureProjection: 'EPSG:3857' };
  const regions = format.readFeatures({ type: 'FeatureCollection', features: boundaries }, projection);
  const dissolvedFeatures = format.readFeatures(dissolved, projection);
  const source = new VectorSource({ features: points.map(point => { const feature = new Feature(new Point(fromLonLat([point.lonNum, point.latNum]))); feature.setId(point.nomor); return feature; }) });
  const google = new TileLayer({ source: new XYZ({ url: 'https://mt1.google.com/vt/lyrs=s&x={x}&y={y}&z={z}', maxZoom: 21, attributions: 'Tiles &copy; Google' }) });
  const esri = new TileLayer({ visible: false, source: new XYZ({ url: 'https://services.arcgisonline.com/arcgis/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', maxZoom: 18, attributions: 'Citra &copy; Esri, Vantor, Earthstar Geographics, and the GIS User Community' }) });
  const mask = new VectorLayer({ source: new VectorSource({ features: dissolvedFeatures }), style: maskStyle(dissolvedFeatures), declutter: false });
  const area = new VectorLayer({ visible: false, source: new VectorSource({ features: dissolvedFeatures }), style: { 'stroke-color': 'rgba(245,158,11,.6)', 'stroke-width': 1.5, 'stroke-line-dash': [6, 4], 'fill-color': 'rgba(245,158,11,.1)' }, declutter: false });
  const regionLayer = new VectorLayer({ source: new VectorSource({ features: regions, attributions: 'Batas &copy; <a href="https://geoservices.big.go.id/rbi/rest/services/BATASWILAYAH/BATAS_KABKOTA_AR/MapServer" target="_blank" rel="noopener">BIG</a> &middot; Juni 2026' }), style: boundaryStyle, declutter: false });
  const pointLayer = new VectorLayer({ source, declutter: false, style: (feature, resolution) => {
    const id = String(feature.getId()); const point = byId.get(id);
    if (!point || !visibleIds.has(id) || !shown(point) && id !== selected) return undefined;
    return pointStyle(point, resolution, id === selected);
  } });
  const overlay = new Overlay({ element: options.popup, positioning: 'bottom-center', offset: [0, 0], stopEvent: true });
  const scaleControl = new FullWidthScaleLine();
  const map = new OlMap({ target: options.target, layers: [esri, google, mask, area, regionLayer, pointLayer], overlays: [overlay], view: new View({ maxZoom: 28, minZoom: 1 }), interactions: defaultInteractions({ doubleClickZoom: false }), controls: defaultControls({ attributionOptions: { collapsible: false, className: 'bottom-attribution' }, zoomOptions: { zoomInTipLabel: 'Perbesar', zoomOutTipLabel: 'Perkecil' } }).extend([scaleControl]) });
  const controlCleanup = attachControlLayout(map);
  function shown(point: SurveyPoint) { return visibleIds.has(point.nomor) && (point.cadangan ? flags.cadangan : point.belum ? flags.belum : flags.sk); }
  const feedback = attachPointFeedback(map, pointLayer, points, shown, () => selected);
  const padding = () => {
    const sidebar = document.getElementById('sidebar')?.getBoundingClientRect();
    if (window.innerWidth < 960) return [72, 24, (parseInt(getComputedStyle(document.documentElement).getPropertyValue('--sheet-peek'), 10) || 240) + 24, 24];
    return [56, 72, 72, (document.body.classList.contains('is-sidebar-collapsed') ? 0 : Math.round(sidebar?.right ?? 0)) + 48];
  };
  function fitToPoints(ids: ReadonlySet<string>, fit: FitOptions = {}) {
    if (disposed) return;
    const extent = createEmpty(); let found = false;
    for (const id of ids) { const point = byId.get(id); if (point) { extendCoordinate(extent, fromLonLat([point.lonNum, point.latNum])); found = true; } }
    if (found) map.getView().fit(extent, { padding: fit.padding ?? padding(), maxZoom: fit.maxZoom ?? 15, duration: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : fit.duration ?? 700 });
    else map.getView().fit(regionLayer.getSource()!.getExtent(), { padding: padding(), duration: 0 });
  }
  function positionPopup(point: SurveyPoint) {
    overlay.setPosition(fromLonLat([point.lonNum, point.latNum]));
    options.popup.style.display = 'block';

  }
  const click = map.on('click', event => {
    const candidates: SurveyPoint[] = [];
    map.forEachFeatureAtPixel(event.pixel, feature => { const point = byId.get(String(feature.getId())); if (point) for (const unit of atCoordinate.get(coordinateKey(point)) ?? [point]) if (shown(unit) && !candidates.includes(unit)) candidates.push(unit); }, { layerFilter: layer => layer === pointLayer, hitTolerance: 8 });
    if (!candidates.length) options.onSelect(null);
    else { const index = candidates.findIndex(point => point.nomor === selected); options.onSelect(candidates[(index + 1) % candidates.length].nomor); }
  });
  const pointer = map.on('pointermove', event => { options.target.style.cursor = !event.dragging && map.hasFeatureAtPixel(event.pixel, { layerFilter: layer => layer === pointLayer, hitTolerance: 8 }) ? 'pointer' : ''; });
  const observer = new ResizeObserver(() => { if (!disposed) map.updateSize(); }); observer.observe(options.target);
  function focusPoint(point: SurveyPoint, zoom: number, animate = false) {
    const coordinate = fromLonLat([point.lonNum, point.latNum]), view = map.getView();
    view.cancelAnimations(); const resolution = view.getResolutionForZoom(zoom);
    const [, right, , left] = padding();
    const pinY = innerWidth < 960 ? Math.min(options.popup.getBoundingClientRect().bottom + 56, innerHeight - 28) : Math.min(options.popup.offsetHeight + 72, innerHeight - 56);
    const center = [coordinate[0] - (left - right) * resolution / 2, coordinate[1] + (pinY - innerHeight / 2) * resolution];
    if (!animate || matchMedia('(prefers-reduced-motion: reduce)').matches) { view.setZoom(zoom); view.setCenter(center); return; }
    const currentZoom = view.getZoom() ?? 0, delta = Math.abs(zoom - currentZoom), current = view.getCenter();
    const panPixels = current ? Math.hypot(coordinate[0] - current[0], coordinate[1] - current[1]) / (view.getResolution() ?? resolution) : 0;
    const base = innerWidth < 960 ? 560 : 760;
    const duration = Math.round(Math.max(base, Math.min(base + Math.min(delta * 42, 360) + Math.min(panPixels * .22, 260), 1180)));
    if (delta <= 2.5) view.animate({ center, zoom, duration, easing: inAndOut });
    else { const bridge = zoom > currentZoom ? Math.min(currentZoom + delta * .58, zoom - .4) : Math.max(currentZoom - delta * .58, zoom + .4), phaseOne = Math.round(duration * .44); view.animate({ center, zoom: bridge, duration: phaseOne, easing: inAndOut }, { center, zoom, duration: duration - phaseOne, easing: inAndOut }); }
  }
  let positionFrame = 0;
  const resize = () => { if (disposed) return; map.updateSize(); if (selected) { const point = byId.get(selected); if (point) { focusPoint(point, map.getView().getZoom() ?? 17); positionPopup(point); } } };
  window.addEventListener('resize', resize);
  fitToPoints(visibleIds, { duration: 0 });
  return {
    setSelection(nomor) {
      selected = nomor; feedback.refresh(); pointLayer.changed(); cancelAnimationFrame(positionFrame);
      const point = nomor ? byId.get(nomor) : undefined;
      if (!point) { overlay.setPosition(undefined); options.popup.style.display = 'none'; return; }
      const coordinate = fromLonLat([point.lonNum, point.latNum]);
      feedback.pulse(coordinate);
      const zoom = Math.max(map.getView().getZoom() ?? 0, 17);
      options.popup.style.display = 'block';
      positionFrame = requestAnimationFrame(() => { if (!disposed && selected === nomor) { positionPopup(point); focusPoint(point, zoom, true); } });
    },
    setVisiblePoints(ids) { visibleIds = ids; feedback.refresh(); pointLayer.changed(); },
    fitToPoints,
    setLayerVisibility(key, visible) {
      if (key === 'sk' || key === 'cadangan' || key === 'belum') { flags[key] = visible; feedback.refresh(); pointLayer.changed(); }
      else if (key === 'google' || key === 'esri') { if (key === 'google') google.setVisible(visible); else esri.setVisible(visible); }
      else ({ boundaries: regionLayer, mask, area })[key].setVisible(visible);
    },
    updateSize: resize,
    dispose() { disposed = true; cancelAnimationFrame(positionFrame); observer.disconnect(); window.removeEventListener('resize', resize); feedback.dispose(); controlCleanup(); unByKey([click, pointer]); overlay.setElement(undefined); map.setTarget(undefined); map.dispose(); },
  };
}
