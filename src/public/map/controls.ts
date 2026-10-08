import type OlMap from 'ol/Map';
import { attachControlFeedback } from './control-feedback';
// One layout anchor keeps zoom, scale and attribution aligned through resizing.
export function attachControlLayout(map: OlMap) {
  const furniture = document.createElement('div'); furniture.className = 'map-meta';
  const info = document.createElement('div'); info.className = 'map-meta__info';
  const viewport = map.getViewport(), zoom = viewport.querySelector('.ol-zoom'), scale = viewport.querySelector('.ol-scale-line'), attribution = viewport.querySelector('.bottom-attribution');
  if (zoom) furniture.append(zoom); if (scale) info.append(scale); if (attribution) info.append(attribution); furniture.append(info); (viewport.closest('.app-shell') ?? viewport).append(furniture);
  const feedbackCleanup = attachControlFeedback(zoom, document.querySelector('.layer-switcher'), document.getElementById('panel-toggle'));
  const measure = () => document.documentElement.style.setProperty('--map-meta-inset', `${Math.round(furniture.getBoundingClientRect().width + 16)}px`);
  const observer = new ResizeObserver(() => { measure(); map.render(); }); observer.observe(furniture); if (scale) observer.observe(scale); measure();
  return () => { feedbackCleanup(); observer.disconnect(); document.documentElement.style.removeProperty('--map-meta-inset'); furniture.remove(); };
}
