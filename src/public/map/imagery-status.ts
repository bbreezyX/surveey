import type OlMap from 'ol/Map';
import type TileLayer from 'ol/layer/Tile';
import type XYZ from 'ol/source/XYZ';
import type Tile from 'ol/Tile';
import type { TileSourceEvent } from 'ol/source/Tile';
import TileState from 'ol/TileState';
import { listen, type EventsKey } from 'ol/events';
import { getRotatedViewport } from 'ol/extent';
import { unByKey } from 'ol/Observable';
import { SLOW_MS } from '../state/connection.svelte';
// Only imagery needed by the visible basemap at the current view can explain a wait. A delayed
// provider response, a hidden layer or an abandoned zoom is not evidence of weak signal.
const ERRORS_BEFORE_SUSPECT = 4;
type Imagery = { layer: TileLayer<XYZ>; source: XYZ; errors: number };
type PendingTile = { imagery: Imagery; started: number; sourceKey: string; change: EventsKey };
export function watchTiles(map: OlMap, layers: TileLayer<XYZ>[], report: { suspect(): void; slow(value: boolean): void }) {
  const imagery = layers.map(layer => ({ layer, source: layer.getSource()!, errors: 0 }));
  const pending = new Map<Tile, PendingTile>();
  let slow = false, timer: ReturnType<typeof setInterval> | undefined;
  function neededTiles(): (tile: Tile, item: Imagery) => boolean {
    const view = map.getView(), size = map.getSize(), center = view.getCenter(), resolution = view.getResolution();
    if (!size || size[0] <= 0 || size[1] <= 0 || !center || resolution === undefined) return () => false;
    const viewport = getRotatedViewport(center, resolution, view.getRotation(), size);
    const grids = new Map(imagery.filter(item => item.layer.getSource() === item.source && item.layer.isVisible(view))
      .map(item => [item, item.source.getTileGridForProjection(view.getProjection())] as const));
    return (tile, item) => {
      const grid = grids.get(item), coordinate = tile.getTileCoord();
      return !!grid && coordinate[0] === grid.getZForResolution(resolution, item.source.zDirection) && grid.tileCoordIntersectsViewport(coordinate, viewport);
    };
  }
  function forget(tile: Tile) {
    const request = pending.get(tile); if (!request) return;
    unByKey(request.change); pending.delete(tile);
  }
  function measure() {
    const now = Date.now(), needed = neededTiles();
    let next = false, active = false;
    for (const [tile, request] of pending) {
      if (tile.getState() !== TileState.LOADING || request.sourceKey !== request.imagery.source.getKey()) { forget(tile); continue; }
      if (!needed(tile, request.imagery)) continue;
      active = true;
      if (now - request.started > SLOW_MS) next = true;
    }
    if (next !== slow) { slow = next; report.slow(next); }
    if (active) timer ??= setInterval(measure, 1000);
    else { clearInterval(timer); timer = undefined; }
  }
  function settle(event: TileSourceEvent, item: Imagery, failed: boolean) {
    const request = pending.get(event.tile);
    const active = !!request && request.sourceKey === item.source.getKey() && neededTiles()(event.tile, item);
    forget(event.tile); measure();
    if (!active) return;
    if (!failed) item.errors = 0;
    else if (++item.errors >= ERRORS_BEFORE_SUSPECT) { item.errors = 0; report.suspect(); }
  }
  const keys = imagery.flatMap(item => [
    item.source.on('tileloadstart', event => {
      forget(event.tile);
      // EMPTY/disposed tiles do not emit tileloadend or tileloaderror. Observe their state too.
      const change = listen(event.tile, 'change', measure);
      pending.set(event.tile, { imagery: item, started: Date.now(), sourceKey: item.source.getKey(), change });
      measure();
    }),
    item.source.on('tileloadend', event => settle(event, item, false)),
    item.source.on('tileloaderror', event => settle(event, item, true)),
    item.source.on('change', () => { item.errors = 0; measure(); }),
    item.layer.on('change:visible', () => { item.errors = 0; measure(); }),
  ]);
  keys.push(map.on('postrender', measure));
  return {
    // Tiles that failed while offline are remembered as errors; asking again is what brings them back.
    reload() { for (const tile of pending.keys()) forget(tile); measure(); for (const item of imagery) { item.errors = 0; item.source.refresh(); } },
    dispose() { clearInterval(timer); unByKey(keys); for (const tile of pending.keys()) forget(tile); if (slow) report.slow(false); },
  };
}
