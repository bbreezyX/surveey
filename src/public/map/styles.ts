import Style from 'ol/style/Style';
import Icon from 'ol/style/Icon';
import CircleStyle from 'ol/style/Circle';
import Fill from 'ol/style/Fill';
import Stroke from 'ol/style/Stroke';
import Text from 'ol/style/Text';
import Point from 'ol/geom/Point';
import Polygon from 'ol/geom/Polygon';
import MultiPolygon from 'ol/geom/MultiPolygon';
import type { FeatureLike } from 'ol/Feature';
import type { SurveyPoint } from '../../shared/survey/types';
import { toDisplayCase } from '../../shared/survey/display';
import * as symbols from './pin-symbols';
import { stageBadgeSvg, stageDone, type SurveyProgress } from '../../shared/survey/progress';
import { regionKey } from '../data/regions';
const cache = new Map<string, Style[]>();
const badgeSrc = (stage: number) => `data:image/svg+xml,${encodeURIComponent(stageBadgeSvg(stage))}`;
export function pointStyle(point: SurveyPoint, resolution: number, selected = false, hovered = false, stage = 0): Style[] {
  // A stage accepted on esdm.cloud means the crew found the spot and dug there, so the shared-coordinate
  // warning has done its job; the map holds its own copy of the points, hence the check on stage here too.
  const kind = point.cadangan ? 'cadangan' : point.belum ? 'belum' : point.duplikat && !stage ? 'duplikat' : 'sk';
  const radius = Math.round((5 + 2 * Math.max(0, Math.min(1, (430 - resolution) / 354))) * 2) / 2;
  const dot = resolution > 76 && !selected;
  // Cadangan is never built, so it never wears the badge whatever the data says. parseProgress only
  // admits stages 1 to 4, and each one draws its own badge.
  const badge = kind === 'cadangan' ? 0 : stage;
  const key = `${kind}|${dot ? radius : 'pin'}|${selected}|${hovered}|${badge}`;
  const cached = cache.get(key); if (cached) return cached;
  const fill = kind === 'cadangan' ? '#c5cdd6' : kind === 'belum' ? '#f4f6f8' : '#fee50f';
  const stroke = kind === 'duplikat' ? '#e8731a' : kind === 'belum' ? '#6b7a8c' : '#293d50';
  const svg = selected ? { sk: symbols.selectedPinSvg, duplikat: symbols.duplikatSelectedSvg, belum: symbols.belumSelectedSvg, cadangan: symbols.cadanganSelectedSvg }[kind] : { sk: symbols.normalPinSvg, duplikat: symbols.duplikatPinSvg, belum: symbols.belumPinSvg, cadangan: symbols.cadanganPinSvg }[kind];
  const anchorY = kind === 'sk' && !selected ? symbols.normalPinAnchorY : 1;
  const image = dot ? new CircleStyle({ radius: radius + (hovered ? 2 : 0), fill: new Fill({ color: fill }), stroke: new Stroke({ color: stroke, width: kind === 'duplikat' || kind === 'belum' ? 2.2 : kind === 'cadangan' ? 1.4 : 1.6 }) }) : new Icon({ src: `data:image/svg+xml,${svg}`, anchor: [0.5, anchorY], scale: (kind === 'cadangan' && !selected ? .86 : 1) * (hovered ? 1.12 : 1) });
  const styles = [new Style({ image, zIndex: selected ? 10 : hovered ? 5 : kind === 'duplikat' || kind === 'belum' ? 2 : 1 })];
  if (badge) {
    // Sits on the pin head's upper right (or the dot's edge) so the yellow pin and its status ring stay readable.
    const lift = hovered ? 1.12 : 1, displacement = dot ? [radius + (hovered ? 2 : 0), radius + (hovered ? 2 : 0)] : selected ? [10, 33] : [Math.round(9 * lift), Math.round(27 * lift)];
    styles.push(new Style({ image: new Icon({ src: badgeSrc(badge), displacement }), zIndex: (selected ? 10 : hovered ? 5 : 2) + .5 }));
  }
  if (selected) styles.unshift(new Style({ image: new CircleStyle({ radius: 15, fill: new Fill({ color: kind === 'cadangan' || kind === 'belum' ? 'rgba(107,122,140,.24)' : 'rgba(254,229,15,.26)' }), stroke: new Stroke({ color: 'rgba(255,255,255,.7)', width: 1.5 }) }), zIndex: 9 }));
  cache.set(key, styles); return styles;
}
// Only kabupaten whose official units are 100% terpasang (stage 4) are marked on the map,
// excluding Cadangan so the map matches ProgressGrid's "Semua terpasang" state.
export function completedRegions(points: readonly Pick<SurveyPoint, 'nomor' | 'kabupaten' | 'cadangan'>[], progress: SurveyProgress): ReadonlySet<string> {
  const completed = new Set<string>();
  if (!progress.size) return completed;
  const counts = new Map<string, { total: number; done: number }>();
  for (const point of points) {
    if (point.cadangan) continue;
    const key = regionKey(point.kabupaten);
    let entry = counts.get(key);
    if (!entry) { entry = { total: 0, done: 0 }; counts.set(key, entry); }
    entry.total++;
    if (stageDone(progress.get(point.nomor) ?? 0)) entry.done++;
  }
  for (const [key, { total, done }] of counts) {
    if (total > 0 && done === total) completed.add(key);
  }
  return completed;
}
// Satellite tiles across Jambi are deep forest green. A finished (100% terpasang) kabupaten gets a
// deeper dark-emerald shade, a crisp green border and a large checkmark badge on a top overlay layer
// above pins (boundaryBadgeStyle) so settled regions visibly step back while every unfinished kabupaten
// stays bright with its plain white border. Fills and badges fade out as the reader zooms in (same
// resolution curve as kabupaten labels) so houses, roads and poles stay clear. Separate zIndex bands
// keep fills (0) below every stroke (1..3) so a finished border always wins over an adjacent unfinished one.
const DONE_REGION_CHECK_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#1f7a5a"/><stop offset="100%" stop-color="#13543e"/></linearGradient></defs><circle cx="20" cy="21.4" r="15.4" fill="rgba(4,16,13,0.45)"/><circle cx="20" cy="20" r="14.8" fill="url(#g)" stroke="#7ee0b8" stroke-opacity="0.9" stroke-width="1.5"/><circle cx="20" cy="20" r="13.2" fill="none" stroke="rgba(255,255,255,0.12)" stroke-width="0.9"/><path d="M13.8 20.4 18 24.5 26.5 16" fill="none" stroke="#effdf6" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const doneRegionCheckSrc = `data:image/svg+xml,${encodeURIComponent(DONE_REGION_CHECK_SVG)}`;
const boundaryShapes = new Map<string, Style[]>();
function boundaryShapeStyles(done: boolean, alpha: number, offline: boolean): Style[] {
  const key = `${done}|${alpha}|${offline}`;
  const cached = boundaryShapes.get(key);
  if (cached) return cached;
  const styles: Style[] = [];
  if (offline) {
    // Without imagery the map sits on a pale land colour (#map.is-imagery-offline in layout.css), where
    // white and light-jade lines vanish: boundaries use dark ink or muted deep jade (#196e52) instead.
    if (done) {
      if (alpha) styles.push(new Style({ fill: new Fill({ color: `rgba(25,110,82,${+(alpha * .18).toFixed(3)})` }), zIndex: 0 }));
      styles.push(new Style({ stroke: new Stroke({ color: 'rgba(25,110,82,.92)', width: 2.1 }), zIndex: 3 }));
    } else {
      styles.push(new Style({ stroke: new Stroke({ color: 'rgba(41,61,80,.85)', width: 1.75 }), zIndex: 1 }));
    }
  } else if (done) {
    if (alpha) styles.push(new Style({ fill: new Fill({ color: `rgba(7,26,22,${+(alpha * .58).toFixed(3)})` }), zIndex: 0 }));
    styles.push(
      new Style({ stroke: new Stroke({ color: 'rgba(6,22,18,.65)', width: 3.2 }), zIndex: 2.5 }),
      new Style({ stroke: new Stroke({ color: 'rgba(110,212,168,.88)', width: 1.75 }), zIndex: 3 }),
    );
  } else {
    styles.push(new Style({ stroke: new Stroke({ color: 'rgba(255,255,255,.8)', width: 1.25 }), zIndex: 1 }));
  }
  boundaryShapes.set(key, styles);
  return styles;
}
let offlineBasemap = false;
export function setOfflineBasemap(offline: boolean) { offlineBasemap = offline; }
const boundaryLabels = new WeakMap<FeatureLike, Map<string, Style>>();
const doneBadges = new WeakMap<FeatureLike, Map<string, Style[]>>();
const polygonCenters = new WeakMap<Polygon, { point: Point; radius: number }>();
const regionAlpha = (resolution: number) => Math.round(Math.max(0, Math.min(1, (resolution - 60) / 80)) * 10) / 10;
const largestPolygon = (geometry: Polygon | MultiPolygon) => geometry instanceof Polygon ? geometry : geometry.getPolygons().sort((a, b) => b.getArea() - a.getArea())[0];
function distanceToRing(px: number, py: number, ring: number[][]): number {
  let minSq = Infinity;
  for (let i = 0; i < ring.length - 1; i++) {
    const x1 = ring[i][0], y1 = ring[i][1], dx = ring[i + 1][0] - x1, dy = ring[i + 1][1] - y1;
    const t = dx || dy ? Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy))) : 0;
    const nx = x1 + t * dx - px, ny = y1 + t * dy - py, dSq = nx * nx + ny * ny;
    if (dSq < minSq) minSq = dSq;
  }
  return Math.sqrt(minSq);
}
// OpenLayers' getInteriorPoint() only scans the horizontal midline, which lands close to the curved southern
// border of Tanjung Jabung Timur (~8px clearance on a phone). A coarse+refined pole-of-inaccessibility search
// finds the deepest interior point once per polygon (~24-33px clearance) so the checkmark never drifts into a
// neighbouring kabupaten at any zoom level.
function visualCenter(polygon: Polygon): { point: Point; radius: number } {
  const cached = polygonCenters.get(polygon);
  if (cached) return cached;
  const extent = polygon.getExtent(), rings = polygon.getCoordinates();
  const clearance = (x: number, y: number) => {
    if (!polygon.intersectsCoordinate([x, y])) return -1;
    let d = Infinity;
    for (const ring of rings) d = Math.min(d, distanceToRing(x, y, ring));
    return d;
  };
  const fallback = polygon.getInteriorPoint().getCoordinates();
  let bestX = fallback[0], bestY = fallback[1], bestD = clearance(bestX, bestY);
  const steps = 16, stepX = (extent[2] - extent[0]) / steps, stepY = (extent[3] - extent[1]) / steps;
  if (stepX > 0 && stepY > 0) {
    for (let r = 1; r < steps; r++) {
      for (let c = 1; c < steps; c++) {
        const x = extent[0] + c * stepX, y = extent[1] + r * stepY, d = clearance(x, y);
        if (d > bestD) { bestX = x; bestY = y; bestD = d; }
      }
    }
    const refineX = stepX / 4, refineY = stepY / 4, originX = bestX, originY = bestY;
    for (let dr = -3; dr <= 3; dr++) {
      for (let dc = -3; dc <= 3; dc++) {
        if (!dr && !dc) continue;
        const x = originX + dc * refineX, y = originY + dr * refineY, d = clearance(x, y);
        if (d > bestD) { bestX = x; bestY = y; bestD = d; }
      }
    }
  }
  const result = { point: new Point([bestX, bestY]), radius: Math.max(bestD, 0) };
  polygonCenters.set(polygon, result);
  return result;
}
export function boundaryStyle(feature: FeatureLike, resolution: number, completed?: ReadonlySet<string>): Style[] {
  const alpha = regionAlpha(resolution);
  const geometry = feature.getGeometry();
  const rawName = String(feature.get('KABUPATEN_') ?? '');
  const done = !!completed?.has(regionKey(rawName));
  const shapes = boundaryShapeStyles(done, alpha, offlineBasemap);
  // Done regions draw their label together with the large checkmark on the top overlay layer (boundaryBadgeStyle).
  if (!alpha || done || !(geometry instanceof Polygon || geometry instanceof MultiPolygon)) return shapes;
  const name = toDisplayCase(rawName);
  const key = `${name}|${alpha}|${offlineBasemap}`;
  let labels = boundaryLabels.get(feature); if (!labels) { labels = new Map(); boundaryLabels.set(feature, labels); }
  let label = labels.get(key);
  if (!label) {
    label = new Style({ geometry: largestPolygon(geometry).getInteriorPoint(), zIndex: 4, text: new Text({ text: name, font: '600 12.5px Manrope, "Source Sans 3", system-ui, sans-serif', fill: new Fill({ color: offlineBasemap ? `rgba(41,61,80,${alpha})` : `rgba(255,255,255,${alpha * .96})` }), stroke: new Stroke({ color: offlineBasemap ? `rgba(255,255,255,${alpha * .9})` : `rgba(11,41,66,${alpha * .7})`, width: 2.6 }) }) });
    labels.set(key, label);
  }
  return [...shapes, label];
}
// Drawn above pointLayer at each polygon's deepest interior point (displacement [0, 0]) so finished kabupaten
// checkmarks stay strictly inside their own boundaries and remain immediately visible on mobile over dense pins.
export function boundaryBadgeStyle(feature: FeatureLike, resolution: number, completed?: ReadonlySet<string>): Style[] | undefined {
  const alpha = regionAlpha(resolution);
  if (!alpha) return undefined;
  const geometry = feature.getGeometry();
  if (!(geometry instanceof Polygon || geometry instanceof MultiPolygon)) return undefined;
  const rawName = String(feature.get('KABUPATEN_') ?? '');
  if (!completed?.has(regionKey(rawName))) return undefined;
  const { point, radius } = visualCenter(largestPolygon(geometry));
  const clearPx = radius / Math.max(resolution, 1);
  // Fit the 40px badge inside the polygon's inscribed circle; cap slightly smaller on phone-overview zooms (>600 m/px).
  const maxScale = resolution > 600 ? .84 : 1;
  const scale = Math.round(Math.max(.55, Math.min(maxScale, (clearPx * .78) / 18.5)) * 20) / 20;
  const labelDrop = Math.round(17 * scale) + 7;
  const compact = resolution > 600 || scale < .75;
  const name = toDisplayCase(rawName);
  const key = `${name}|${scale}|${compact}|${alpha}|${offlineBasemap}`;
  let cached = doneBadges.get(feature); if (!cached) { cached = new Map(); doneBadges.set(feature, cached); }
  let styles = cached.get(key);
  if (!styles) {
    const font = compact ? '600 11.5px Manrope, "Source Sans 3", system-ui, sans-serif' : '600 12.5px Manrope, "Source Sans 3", system-ui, sans-serif';
    styles = [
      new Style({ geometry: point, zIndex: 1, text: new Text({ text: name, offsetY: labelDrop, font, fill: new Fill({ color: offlineBasemap ? `rgba(25,110,82,${alpha})` : `rgba(236,250,244,${alpha * .96})` }), stroke: new Stroke({ color: offlineBasemap ? `rgba(255,255,255,${alpha * .9})` : `rgba(6,22,18,${alpha * .88})`, width: 2.8 }) }) }),
      new Style({ geometry: point, zIndex: 2, image: new Icon({ src: doneRegionCheckSrc, scale, opacity: alpha }) }),
    ];
    cached.set(key, styles);
  }
  return styles;
}
export function maskStyle(features: FeatureLike[]): Style {
  const holes: number[][][] = [];
  for (const feature of features) {
    const geometry = feature.getGeometry();
    const polygons = geometry instanceof Polygon ? [geometry] : geometry instanceof MultiPolygon ? geometry.getPolygons() : [];
    for (const polygon of polygons) {
      const ring = polygon.getCoordinates()[0];
      let area = 0;
      for (let i = 0; i < ring.length - 1; i++) area += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1];
      holes.push(area < 0 ? ring.slice().reverse() : ring);
    }
  }
  const w = 20037508.342789244;
  return new Style({ geometry: new Polygon([[[-w, -w], [-w, w], [w, w], [w, -w], [-w, -w]], ...holes]), fill: new Fill({ color: 'rgba(10,20,32,.5)' }) });
}
