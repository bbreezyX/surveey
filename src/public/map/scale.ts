import ScaleLine from 'ol/control/ScaleLine';
import type MapEvent from 'ol/MapEvent';
import { getPointResolution } from 'ol/proj';
/** Original full-card ruler: its distance follows the actual visible width. */
export class FullWidthScaleLine extends ScaleLine {
  constructor() { super(); this.element.classList.add('ol-control'); }
  override render(event: MapEvent) {
    const frame = event.frameState; if (!frame) return;
    const ruler = this.element.querySelector<HTMLElement>('.ol-scale-line-inner'); if (!ruler) return;
    this.element.style.display = ''; const width = ruler.getBoundingClientRect().width; if (!width) return;
    const view = frame.viewState, length = getPointResolution(view.projection, view.resolution, view.center, 'm') * width;
    if (!Number.isFinite(length) || length <= 0) return;
    const label = `≈ ${(length >= 1000 ? length / 1000 : length).toLocaleString('id-ID', { maximumSignificantDigits: 3 })}${length >= 1000 ? ' km' : ' m'}`;
    if (ruler.textContent !== label) ruler.textContent = label;
  }
}
