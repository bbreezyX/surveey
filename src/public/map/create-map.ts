import OlMap from 'ol/Map';
import View from 'ol/View';
import Feature from 'ol/Feature';
import Point from 'ol/geom/Point';
import Circle from 'ol/geom/Circle';
import LineString from 'ol/geom/LineString';
import Style from 'ol/style/Style';
import Fill from 'ol/style/Fill';
import Stroke from 'ol/style/Stroke';
import CircleStyle from 'ol/style/Circle';
import GeoJSON from 'ol/format/GeoJSON';
import VectorSource from 'ol/source/Vector';
import VectorLayer from 'ol/layer/Vector';
import Overlay from 'ol/Overlay';
import { defaults as defaultInteractions } from 'ol/interaction/defaults';
import { defaults as defaultControls } from 'ol/control/defaults';
import { easeOut, inAndOut } from 'ol/easing';
import { fromLonLat } from 'ol/proj';
import { createEmpty, extend, extendCoordinate } from 'ol/extent';
import type { SurveyDataset, SurveyPoint } from '../../shared/survey/types';
import type { Fix } from '../state/nearby';
import { attachPointFeedback } from './feedback';
import { attachControlLayout } from './controls';
import { unByKey } from 'ol/Observable';
import type { SurveyProgress } from '../../shared/survey/progress';
import { pointStyle, boundaryStyle, boundaryBadgeStyle, maskStyle, setOfflineBasemap, completedRegions } from './styles';
import { watchTiles } from './imagery-status';
import { projectRegions } from '../data/regions';
import { satelliteLayers } from './google-tiles';
export type LayerKey = 'google' | 'esri' | 'boundaries' | 'mask' | 'area' | 'sk' | 'cadangan' | 'belum';
export interface FitOptions { duration?: number; maxZoom?: number; padding?: number[] }
export interface SurveyMapAdapter {
  setSelection(nomor: string | null): void;
  // Phones: centres a just-closed point in the map left open above the list sheet's peek.
  centerAfterClose(nomor: string): void;
  setProgress(progress: SurveyProgress): void;
  setVisiblePoints(ids: ReadonlySet<string>): void;
  // No internet: a pale basemap with dark boundaries instead of the navy field (imagery cannot be kept offline).
  setImageryOffline(offline: boolean): void;
  // Newer points after a reconnect; the view, layers and selection stay as the reader left them.
  setPoints(points: SurveyPoint[]): void;
  fitToPoints(ids: ReadonlySet<string>, options?: FitOptions): void;
  setLayerVisibility(key: LayerKey, visible: boolean): void;
  updateSize(): void;
  setUserLocation(fix: Fix | null, nearest: SurveyPoint | null, here?: boolean, frame?: boolean): void;
  dispose(): void;
}
export function createSurveyMap(options: { target: HTMLElement; popup: HTMLElement; dataset: SurveyDataset; onSelect: (nomor: string | null, nearby?: boolean) => void; onBasemapFallback?: () => void; onTileTrouble?: () => void; onTilesSlow?: (slow: boolean) => void }): SurveyMapAdapter {
  const { boundaries, dissolved } = options.dataset;
  let points = options.dataset.points;
  const coordinateKey = (point: SurveyPoint) => `${point.latNum.toFixed(6)},${point.lonNum.toFixed(6)}`;
  let byId = new Map<string, SurveyPoint>(), atCoordinate = new Map<string, SurveyPoint[]>();
  function index() {
    byId = new Map(points.map(point => [point.nomor, point])); atCoordinate = new Map();
    for (const point of points) { const key = coordinateKey(point), group = atCoordinate.get(key) ?? []; group.push(point); atCoordinate.set(key, group); }
  }
  index();
  const pointFeatures = () => points.map(point => { const feature = new Feature(new Point(fromLonLat([point.lonNum, point.latNum]))); feature.setId(point.nomor); return feature; });
  let visibleIds: ReadonlySet<string> = new Set(points.map(point => point.nomor));
  let selected: string | null = null, disposed = false;
  let progress: SurveyProgress = new Map();
  let doneRegions: ReadonlySet<string> = new Set();
  const flags = { sk: true, cadangan: false, belum: true };
  const format = new GeoJSON();
  const projection = { featureProjection: 'EPSG:3857' };
  const regions = projectRegions(boundaries);
  const dissolvedFeatures = format.readFeatures(dissolved, projection);
  const source = new VectorSource({ features: pointFeatures() });
  const satellite = satelliteLayers(options.onBasemapFallback), { google, esri } = satellite;
  const mask = new VectorLayer({ source: new VectorSource({ features: dissolvedFeatures }), style: maskStyle(dissolvedFeatures), declutter: false });
  const area = new VectorLayer({ visible: false, source: new VectorSource({ features: dissolvedFeatures }), style: { 'stroke-color': 'rgba(245,158,11,.6)', 'stroke-width': 1.5, 'stroke-line-dash': [6, 4], 'fill-color': 'rgba(245,158,11,.1)' }, declutter: false });
  const regionSource = new VectorSource({ features: regions, attributions: 'Batas &copy; <a href="https://geoservices.big.go.id/rbi/rest/services/BATASWILAYAH/BATAS_KABKOTA_AR/MapServer" target="_blank" rel="noopener">BIG</a> &middot; Juni 2026' });
  const regionLayer = new VectorLayer({ source: regionSource, style: (feature, resolution) => boundaryStyle(feature, resolution, doneRegions), declutter: false });
  // Sits above pointLayer so finished-kabupaten checkmarks remain immediately legible over dense mobile pin clusters;
  // click and hover hit-testing stay restricted to pointLayer, so pins underneath stay fully interactive.
  const regionBadgeLayer = new VectorLayer({ source: regionSource, style: (feature, resolution) => boundaryBadgeStyle(feature, resolution, doneRegions), declutter: false });
  const pointLayer = new VectorLayer({ source, declutter: false, style: (feature, resolution) => {
    const id = String(feature.getId()); const point = byId.get(id);
    if (!point || !visibleIds.has(id) || !shown(point) && id !== selected) return undefined;
    return pointStyle(point, resolution, id === selected, false, progress.get(id) ?? 0);
  } });
  // The accuracy disc and the dashed lead to the nearest unit are drawn under the pins, so neither hides
  // the unit itself. The lead is what answers "which point am I at": the dot alone only says where you are.
  const discStyle = new Style({ fill: new Fill({ color: 'rgba(0,114,188,.14)' }), stroke: new Stroke({ color: 'rgba(0,114,188,.55)', width: 1.25 }) });
  const leadStyles = [new Style({ stroke: new Stroke({ color: 'rgba(255,255,255,.85)', width: 4.5 }) }), new Style({ stroke: new Stroke({ color: '#0072bc', width: 2.5, lineDash: [6, 6] }) })];
  // Standing at the unit, the lead shrinks to a stub buried under the pin and the dot; a held yellow ring
  // on the unit says "this one" instead. Yellow because the pins and the selection already speak it.
  const hereStyles = [new Style({ image: new CircleStyle({ radius: 19, stroke: new Stroke({ color: 'rgba(255,255,255,.9)', width: 6 }) }) }), new Style({ image: new CircleStyle({ radius: 19, fill: new Fill({ color: 'rgba(254,229,15,.18)' }), stroke: new Stroke({ color: '#fee50f', width: 3 }) }) })];
  const userSource = new VectorSource();
  const userLayer = new VectorLayer({ source: userSource, declutter: false, style: feature => { const geometry = feature.getGeometry(); return geometry instanceof LineString ? leadStyles : geometry instanceof Point ? hereStyles : discStyle; } });
  // The dot is a DOM overlay, not a canvas feature, so its pulse runs on the compositor instead of
  // re-rendering the whole map every frame on a phone already busy with GPS.
  const userDot = document.createElement('div'); userDot.className = 'user-dot'; userDot.setAttribute('aria-hidden', 'true');
  const userOverlay = new Overlay({ element: userDot, positioning: 'center-center', stopEvent: false });
  const overlay = new Overlay({ element: options.popup, positioning: 'bottom-center', offset: [0, 0], stopEvent: true });
  // A 390×844 phone at DPR 3 allocated a 1170×2532 canvas. Capping only the
  // map backing store at 2× removes 56% of those pixels while retaining HiDPI
  // pins and leaving the surrounding DOM text/photos at native resolution.
  const map = new OlMap({ target: options.target, pixelRatio: Math.min(window.devicePixelRatio || 1, 2), layers: [esri, google, mask, area, regionLayer, userLayer, pointLayer, regionBadgeLayer], overlays: [userOverlay, overlay], view: new View({ maxZoom: 28, minZoom: 1 }), interactions: defaultInteractions({ doubleClickZoom: false }), controls: defaultControls({ attributionOptions: { collapsible: false, className: 'bottom-attribution' }, zoomOptions: { zoomInTipLabel: 'Perbesar', zoomOutTipLabel: 'Perkecil' } }) });
  const controlCleanup = attachControlLayout(map);
  const satelliteCleanup = satellite.attach(map);
  const tiles = watchTiles(map, [google, esri], { suspect: () => options.onTileTrouble?.(), slow: value => options.onTilesSlow?.(value) });
  let imageryOffline = false;
  function shown(point: SurveyPoint) { return visibleIds.has(point.nomor) && (point.cadangan ? flags.cadangan : point.belum ? flags.belum : flags.sk); }
  const attachFeedback = () => attachPointFeedback(map, pointLayer, points, shown, () => selected, point => progress.get(point.nomor) ?? 0);
  let feedback = attachFeedback();
  const padding = () => {
    const sidebar = document.getElementById('sidebar')?.getBoundingClientRect();
    if (window.innerWidth < 960) {
      const styles = getComputedStyle(document.documentElement);
      const sheet = document.body.classList.contains('is-panel-half')
        ? (parseInt(styles.getPropertyValue('--sheet-half'), 10) || Math.round(innerHeight * 0.46))
        : document.body.classList.contains('is-popup-open')
          ? (parseInt(styles.getPropertyValue('--sheet-bar'), 10) || 52)
          : (parseInt(styles.getPropertyValue('--sheet-peek'), 10) || 240);
      return [72, 24, sheet + 24, 24];
    }
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
    else { const index = candidates.findIndex(point => point.nomor === selected); options.onSelect(candidates[(index + 1) % candidates.length].nomor, candidates.length > 1); }
  });
  const pointer = map.on('pointermove', event => { options.target.style.cursor = !event.dragging && map.hasFeatureAtPixel(event.pixel, { layerFilter: layer => layer === pointLayer, hitTolerance: 8 }) ? 'pointer' : ''; });
  const observer = new ResizeObserver(() => { if (!disposed) map.updateSize(); }); observer.observe(options.target);
  // The pan below measures the card when it opens, but the progress block lands later and makes it taller,
  // which slid the card over its own pole on short phones. A height change on an open card re-runs the pan.
  let popupHeight = 0, focusZoom = 17;
  const popupObserver = new ResizeObserver(() => {
    const height = options.popup.offsetHeight, grew = popupHeight > 0 && height > 0 && height !== popupHeight; popupHeight = height;
    const point = grew && !disposed && selected ? byId.get(selected) : undefined; if (point) focusPoint(point, focusZoom, true);
  });
  popupObserver.observe(options.popup);
  function focusPoint(point: SurveyPoint, zoom: number, animate = false) {
    focusZoom = zoom;
    const coordinate = fromLonLat([point.lonNum, point.latNum]), view = map.getView();
    view.cancelAnimations(); const resolution = view.getResolutionForZoom(zoom);
    const [, right, , left] = padding();
    const bar = innerWidth < 960 ? (parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sheet-bar')) || 52) : 0;
    // Desktop centres the card and its pin together: the card ends 48px above the pin (popup.css), so the
    // pair is card + 48 tall. On a short window it falls back to a 24px gap above the card, as before.
    const card = options.popup.offsetHeight;
    const pinY = innerWidth < 960 ? Math.min(options.popup.getBoundingClientRect().bottom + 56, innerHeight - bar - 16) : Math.min(Math.max(card + 72, (innerHeight + card + 48) / 2), innerHeight - 56);
    const center = [coordinate[0] - (left - right) * resolution / 2, coordinate[1] + (pinY - innerHeight / 2) * resolution];
    if (!animate || matchMedia('(prefers-reduced-motion: reduce)').matches) { view.setZoom(zoom); view.setCenter(center); return; }
    const currentZoom = view.getZoom() ?? 0, delta = Math.abs(zoom - currentZoom), current = view.getCenter();
    const panPixels = current ? Math.hypot(coordinate[0] - current[0], coordinate[1] - current[1]) / (view.getResolution() ?? resolution) : 0;
    const base = innerWidth < 960 ? 780 : 880;
    const duration = Math.round(Math.max(base, Math.min(base + Math.min(delta * 46, 380) + Math.min(panPixels * .25, 280), 1350)));
    if (delta <= 2.5) view.animate({ center, zoom, duration, easing: inAndOut });
    else { const bridge = zoom > currentZoom ? Math.min(currentZoom + delta * .58, zoom - .4) : Math.max(currentZoom - delta * .58, zoom + .4), phaseOne = Math.round(duration * .44); view.animate({ center, zoom: bridge, duration: phaseOne, easing: inAndOut }, { center, zoom, duration: duration - phaseOne, easing: inAndOut }); }
  }
  let positionFrame = 0, glideFrame = 0, userAt: number[] | null = null;
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
    // The open card parks its pin just under itself, which is behind the sheet's peek once the card closes.
    // The pin then always lands in the same place, the middle of the map left open between the masthead and
    // the peek (not the raw viewport centre, which the sheet pushes visibly low), at the same zoom.
    centerAfterClose(nomor) {
      const point = byId.get(nomor); if (disposed || !point || innerWidth >= 960) return;
      const view = map.getView(), center = view.getCenter(), resolution = view.getResolution(), pixel = map.getPixelFromCoordinate(fromLonLat([point.lonNum, point.latNum]));
      if (!center || !resolution || !pixel) return;
      // The pixel is the pin's tip; its 40px body sits above, so the tip goes 20px below the middle.
      const [top, right, bottom, left] = padding(), x = (left + innerWidth - right) / 2, y = (top + innerHeight - bottom) / 2 + 20;
      if (Math.hypot(pixel[0] - x, pixel[1] - y) < 2) return;
      view.cancelAnimations(); view.animate({ center: [center[0] + (pixel[0] - x) * resolution, center[1] - (pixel[1] - y) * resolution], duration: matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 760, easing: inAndOut });
    },
    setProgress(next) { progress = next; doneRegions = completedRegions(points, progress); feedback.refresh(); pointLayer.changed(); regionLayer.changed(); regionBadgeLayer.changed(); },
    setVisiblePoints(ids) { visibleIds = ids; feedback.refresh(); pointLayer.changed(); },
    setImageryOffline(offline) {
      if (disposed || offline === imageryOffline) return;
      imageryOffline = offline; options.target.classList.toggle('is-imagery-offline', offline); setOfflineBasemap(offline); regionLayer.changed(); regionBadgeLayer.changed();
      if (!offline) tiles.reload();
    },
    setPoints(next) {
      if (disposed || next === points) return;
      points = next; index(); doneRegions = completedRegions(points, progress); source.clear(true); source.addFeatures(pointFeatures());
      feedback.dispose(); feedback = attachFeedback(); pointLayer.changed(); regionLayer.changed(); regionBadgeLayer.changed();
      // A moved pin takes its open popup with it, without re-running the fly-to.
      const point = selected ? byId.get(selected) : undefined; if (point) positionPopup(point);
    },
    fitToPoints,
    setLayerVisibility(key, visible) {
      if (key === 'sk' || key === 'cadangan' || key === 'belum') { flags[key] = visible; feedback.refresh(); pointLayer.changed(); }
      else if (key === 'google' || key === 'esri') { if (key === 'google') google.setVisible(visible); else esri.setVisible(visible); }
      else if (key === 'boundaries') { regionLayer.setVisible(visible); regionBadgeLayer.setVisible(visible); }
      else ({ mask, area })[key].setVisible(visible);
    },
    updateSize: resize,
    setUserLocation(fix, nearest, here = false, frame = false) {
      cancelAnimationFrame(glideFrame); userSource.clear();
      if (!fix) { userOverlay.setPosition(undefined); userAt = null; return; }
      const at = fromLonLat([fix.lon, fix.lat]), target = nearest ? fromLonLat([nearest.lonNum, nearest.latNum]) : null;
      // Web Mercator stretches distance by 1/cos(latitude); Jambi is near the equator, but the radius is kept true anyway.
      const disc = new Circle(at, fix.accuracy / Math.cos(fix.lat * Math.PI / 180));
      const lead = target && !here ? new LineString([at, target]) : null;
      userSource.addFeature(new Feature(disc));
      if (target) userSource.addFeature(new Feature(lead ?? new Point(target)));
      // A walking reader gets a new fix every second or two; jumping the dot that far each time reads as
      // a glitch, so the dot, its disc and the lead glide there instead. Ease-out because a new fix can
      // arrive mid-glide and restart from wherever the dot is, and an ease-in start would stall it there.
      // The first fix, the framing fix and a jump of more than 250 m (a cold GPS settling, not walking)
      // land at once: a glide across town would draw a path the reader never took.
      const from = userAt, place = (p: number[]) => { userAt = p; userOverlay.setPosition(p); disc.setCenter(p); lead?.setCoordinates([p, target!]); };
      if (!from || frame || Math.hypot(at[0] - from[0], at[1] - from[1]) > 250 || matchMedia('(prefers-reduced-motion: reduce)').matches) place(at);
      else {
        const start = performance.now(); place(from);
        const step = (now: number) => { if (disposed) return; const t = Math.min(1, (now - start) / 500), k = easeOut(t); place([from[0] + (at[0] - from[0]) * k, from[1] + (at[1] - from[1]) * k]); if (t < 1) glideFrame = requestAnimationFrame(step); };
        glideFrame = requestAnimationFrame(step);
      }
      if (!frame || disposed) return;
      // The first view holds both ends: the reader and the unit they are nearest to, however far apart.
      const extent = disc.getExtent().slice(); if (target) extend(extent, [target[0], target[1], target[0], target[1]]);
      map.getView().fit(extent, { padding: padding().map(side => side + 24), maxZoom: 18, duration: matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 600 });
      if (target) feedback.pulse(target);
    },
    dispose() { disposed = true; tiles.dispose(); setOfflineBasemap(false); cancelAnimationFrame(positionFrame); cancelAnimationFrame(glideFrame); observer.disconnect(); popupObserver.disconnect(); window.removeEventListener('resize', resize); feedback.dispose(); controlCleanup(); satelliteCleanup(); unByKey([click, pointer]); overlay.setElement(undefined); map.setTarget(undefined); map.dispose(); },
  };
}
