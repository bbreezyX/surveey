import type OlMap from 'ol/Map';
import { attachControlFeedback } from './control-feedback';
// One layout anchor keeps zoom and attribution aligned through resizing.
export function attachControlLayout(map: OlMap) {
  const furniture = document.createElement('div'); furniture.className = 'map-meta';
  const info = document.createElement('div'); info.className = 'map-meta__info';
  const viewport = map.getViewport(), zoom = viewport.querySelector('.ol-zoom'), attribution = viewport.querySelector('.bottom-attribution');
  if (zoom) furniture.append(zoom); if (attribution) info.append(attribution); furniture.append(info); (viewport.closest('.app-shell') ?? viewport).append(furniture);
  const feedbackCleanup = attachControlFeedback(zoom, document.querySelector('.layer-switcher'), document.getElementById('panel-toggle'));
  // The legend lines up with the zoom rail: its band ends 16px short of the rail and its foot sits level
  // with the rail's (or, stacked at mid widths, just above the rail). Measured, because the credit strip
  // under the rail is as tall as the tile source's credit wraps.
  const vars = ['--map-meta-inset', '--map-zoom-bottom', '--map-zoom-top'], root = document.documentElement;
  const measure = () => {
    const rail = zoom?.getBoundingClientRect(); if (!rail) return;
    const values = [root.clientWidth - rail.left + 16, root.clientHeight - rail.bottom, root.clientHeight - rail.top];
    vars.forEach((name, index) => root.style.setProperty(name, `${Math.round(values[index])}px`));
  };
  const observer = new ResizeObserver(() => { measure(); map.render(); }); observer.observe(furniture); measure();
  return () => { feedbackCleanup(); observer.disconnect(); vars.forEach(name => root.style.removeProperty(name)); furniture.remove(); };
}
