import type OlMap from 'ol/Map';
import Feature from 'ol/Feature';
import Point from 'ol/geom/Point';
import VectorSource from 'ol/source/Vector';
import VectorLayer from 'ol/layer/Vector';
import Overlay from 'ol/Overlay';
import Style from 'ol/style/Style';
import Text from 'ol/style/Text';
import Fill from 'ol/style/Fill';
import Stroke from 'ol/style/Stroke';
import CircleStyle from 'ol/style/Circle';
import { fromLonLat } from 'ol/proj';
import { getVectorContext } from 'ol/render';
import { unByKey } from 'ol/Observable';
import { pointStyle } from './styles';
import type { SurveyPoint } from '../../shared/survey/types';

export function codeList(codes: string[]): string {
  const sorted = codes.slice().sort(), nums = sorted.map(Number);
  return sorted.length >= 3 && nums.every((n, i) => i === 0 || n === nums[i - 1] + 1) ? `${sorted[0]}–${sorted.at(-1)}` : sorted.join(', ');
}
export function attachPointFeedback(map: OlMap, pointLayer: VectorLayer<VectorSource<Feature<Point>>>, points: SurveyPoint[], shown: (point: SurveyPoint) => boolean, selection: () => string | null) {
  let disposed = false, hovered: string | null = null, frame = 0;
  const byId = new Map(points.map(point => [point.nomor, point]));
  const spots = new Map<string, { at: number[]; units: SurveyPoint[] }>();
  for (const point of points) {
    const at = fromLonLat([point.lonNum, point.latNum]), key = `${Math.round(at[0] * 2)},${Math.round(at[1] * 2)}`;
    const spot = spots.get(key) ?? { at, units: [] }; spot.units.push(point); spots.set(key, spot);
  }
  const labelStyles = new Map<string, Style>();
  const labels = new VectorLayer({
    source: new VectorSource({ features: [...spots.values()].map(spot => new Feature({ geometry: new Point(spot.at), units: spot.units })) }),
    declutter: true, maxResolution: 4.8,
    style: feature => {
      const units: SurveyPoint[] = feature.get('units'), codes = units.filter(shown).map(point => point.display.code);
      if (!codes.length) return undefined;
      const text = codeList(codes); let style = labelStyles.get(text);
      if (!style) { style = new Style({ text: new Text({ text, font: '700 11px Figtree, system-ui, sans-serif', textAlign: 'left', textBaseline: 'middle', offsetX: 14, offsetY: -20, padding: [3, 5, 2, 5], fill: new Fill({ color: '#293d50' }), backgroundFill: new Fill({ color: 'rgba(255,255,255,.92)' }), backgroundStroke: new Stroke({ color: 'rgba(41,61,80,.28)', width: 1 }) }) }); labelStyles.set(text, style); }
      return style;
    },
  });
  map.addLayer(labels);
  const hoverSource = new VectorSource<Feature<Point>>();
  const hoverLayer = new VectorLayer({ source: hoverSource, declutter: false, zIndex: 4, style: (feature, resolution) => { const point: SurveyPoint = feature.get('point'); return pointStyle(point, resolution, false, true); } });
  map.addLayer(hoverLayer);
  const tip = document.createElement('div'); tip.className = 'pin-tip'; tip.setAttribute('aria-hidden', 'true');
  const overlay = new Overlay({ element: tip, positioning: 'bottom-center', stopEvent: false, insertFirst: false }); map.addOverlay(overlay);
  function setHover(id: string | null) {
    if (id === hovered) return;
    hovered = id; cancelAnimationFrame(frame); hoverSource.clear(); tip.classList.remove('is-visible'); overlay.setPosition(undefined);
    const point = id ? byId.get(id) : undefined;
    if (!point || !shown(point) || point.nomor === selection()) return;
    const at = fromLonLat([point.lonNum, point.latNum]); hoverSource.addFeature(new Feature({ geometry: new Point(at), point }));
    const title = point.display.primary.length > 34 ? `${point.display.primary.slice(0, 33).trim()}…` : point.display.primary;
    tip.textContent = `Titik ${point.display.code}${title ? ` · ${title}` : ''}`;
    overlay.setOffset([0, (map.getView().getResolution() ?? 100) > 76 ? -17 : -46]); overlay.setPosition(at);
    frame = requestAnimationFrame(() => { if (!disposed && hovered === id) tip.classList.add('is-visible'); });
  }
  const pointer = map.on('pointermove', event => {
    if (event.dragging || !matchMedia('(hover: hover) and (pointer: fine)').matches) { setHover(null); return; }
    const hit = map.forEachFeatureAtPixel(event.pixel, feature => String(feature.getId()), { layerFilter: layer => layer === pointLayer, hitTolerance: 3 }); setHover(hit ?? null);
  });
  const leave = () => setHover(null); map.getViewport().addEventListener('pointerleave', leave);
  const sidebar = document.getElementById('sidebar');
  const fromList = (event: Event) => { const target = event.target; if (target instanceof HTMLElement) setHover(target.closest<HTMLElement>('[data-item-id]')?.dataset.itemId ?? null); };
  sidebar?.addEventListener('mouseover', fromList); sidebar?.addEventListener('focusin', fromList); sidebar?.addEventListener('mouseleave', leave); sidebar?.addEventListener('focusout', leave);
  let pulse: { coordinate: number[]; start: number } | null = null;
  const postrender = pointLayer.on('postrender', event => {
    if (!pulse) return;
    const elapsed = Date.now() - pulse.start;
    if (elapsed > 1400) { pulse = null; return; }
    const context = getVectorContext(event), point = new Point(pulse.coordinate);
    for (let k = 0; k < 2; k++) { const t = elapsed / 800 - k * .45; if (t < 0 || t > 1) continue; context.setStyle(new Style({ image: new CircleStyle({ radius: 10 + 24 * (1 - (1 - t) ** 3), stroke: new Stroke({ color: `rgba(254,229,15,${.6 * (1 - t)})`, width: 2.5 }) }) })); context.drawGeometry(point); }
    map.render();
  });
  return {
    refresh() { setHover(null); labels.changed(); },
    pulse(coordinate: number[]) { setHover(null); if (!matchMedia('(prefers-reduced-motion: reduce)').matches) { pulse = { coordinate, start: Date.now() }; map.render(); } },
    dispose() { disposed = true; pulse = null; cancelAnimationFrame(frame); unByKey([pointer, postrender]); map.getViewport().removeEventListener('pointerleave', leave); sidebar?.removeEventListener('mouseover', fromList); sidebar?.removeEventListener('focusin', fromList); sidebar?.removeEventListener('mouseleave', leave); sidebar?.removeEventListener('focusout', leave); map.removeOverlay(overlay); overlay.setElement(undefined); map.removeLayer(labels); map.removeLayer(hoverLayer); },
  };
}
