import Style from 'ol/style/Style';
import Icon from 'ol/style/Icon';
import CircleStyle from 'ol/style/Circle';
import Fill from 'ol/style/Fill';
import Stroke from 'ol/style/Stroke';
import Text from 'ol/style/Text';
import Polygon from 'ol/geom/Polygon';
import MultiPolygon from 'ol/geom/MultiPolygon';
import type { FeatureLike } from 'ol/Feature';
import type { SurveyPoint } from '../../shared/survey/types';
import { toDisplayCase } from '../../shared/survey/display';
import * as symbols from './pin-symbols';
import { stageBadgeSvg } from '../../shared/survey/progress';
const cache = new Map<string, Style[]>();
const badgeSrc = (stage: number) => `data:image/svg+xml,${encodeURIComponent(stageBadgeSvg(stage))}`;
export function pointStyle(point: SurveyPoint, resolution: number, selected = false, hovered = false, stage = 0): Style[] {
  const kind = point.cadangan ? 'cadangan' : point.belum ? 'belum' : point.duplikat ? 'duplikat' : 'sk';
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
  const image = dot ? new CircleStyle({ radius: radius + (hovered ? 2 : 0), fill: new Fill({ color: fill }), stroke: new Stroke({ color: stroke, width: kind === 'duplikat' || kind === 'belum' ? 2.2 : kind === 'cadangan' ? 1.4 : 1.6 }) }) : new Icon({ src: `data:image/svg+xml,${svg}`, anchor: [0.5, 1], scale: (kind === 'cadangan' && !selected ? .86 : 1) * (hovered ? 1.12 : 1) });
  const styles = [new Style({ image, zIndex: selected ? 10 : hovered ? 5 : kind === 'duplikat' || kind === 'belum' ? 2 : 1 })];
  if (badge) {
    // Sits on the pin head's upper right (or the dot's edge) so the yellow pin and its status ring stay readable.
    const lift = hovered ? 1.12 : 1, displacement = dot ? [radius + (hovered ? 2 : 0), radius + (hovered ? 2 : 0)] : selected ? [10, 33] : [Math.round(9 * lift), Math.round(27 * lift)];
    styles.push(new Style({ image: new Icon({ src: badgeSrc(badge), displacement }), zIndex: (selected ? 10 : hovered ? 5 : 2) + .5 }));
  }
  if (selected) styles.unshift(new Style({ image: new CircleStyle({ radius: 15, fill: new Fill({ color: kind === 'cadangan' || kind === 'belum' ? 'rgba(107,122,140,.24)' : 'rgba(254,229,15,.26)' }), stroke: new Stroke({ color: 'rgba(255,255,255,.7)', width: 1.5 }) }), zIndex: 9 }));
  cache.set(key, styles); return styles;
}
const boundaryLine = new Style({ stroke: new Stroke({ color: 'rgba(255,255,255,.8)', width: 1.25 }) });
// Without imagery the map sits on a pale land colour (#map.is-imagery-offline in layout.css), where
// the white lines vanish: boundaries turn dark and a little heavier so the kabupaten stay legible.
const offlineBoundaryLine = new Style({ stroke: new Stroke({ color: 'rgba(41,61,80,.85)', width: 1.75 }) });
let offlineBasemap = false;
export function setOfflineBasemap(offline: boolean) { offlineBasemap = offline; }
const boundaryLabels = new WeakMap<FeatureLike, Map<string, Style>>();
export function boundaryStyle(feature: FeatureLike, resolution: number): Style[] {
  const alpha = Math.round(Math.max(0, Math.min(1, (resolution - 60) / 80)) * 10) / 10;
  const geometry = feature.getGeometry();
  const line = offlineBasemap ? offlineBoundaryLine : boundaryLine;
  if (!alpha || !(geometry instanceof Polygon || geometry instanceof MultiPolygon)) return [line];
  const name = toDisplayCase(feature.get('KABUPATEN_'));
  const key = `${name}|${alpha}|${offlineBasemap}`;
  let labels = boundaryLabels.get(feature); if (!labels) { labels = new Map(); boundaryLabels.set(feature, labels); }
  let label = labels.get(key);
  if (!label) {
    const largest = geometry instanceof Polygon ? geometry : geometry.getPolygons().sort((a, b) => b.getArea() - a.getArea())[0];
    label = new Style({ geometry: largest.getInteriorPoint(), text: new Text({ text: name, font: '600 12.5px Manrope, "Source Sans 3", system-ui, sans-serif', fill: new Fill({ color: offlineBasemap ? `rgba(41,61,80,${alpha})` : `rgba(255,255,255,${alpha * .96})` }), stroke: new Stroke({ color: offlineBasemap ? `rgba(255,255,255,${alpha * .9})` : `rgba(11,41,66,${alpha * .7})`, width: 2.6 }) }) });
    labels.set(key, label);
  }
  return [line, label];
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
