import type XYZ from 'ol/source/XYZ';
import type Tile from 'ol/Tile';
import type { TileSourceEvent } from 'ol/source/Tile';
import { unByKey } from 'ol/Observable';
import { SLOW_MS } from '../state/connection.svelte';
// Watches the satellite tiles for the two things a reader on a weak link notices: tiles that keep
// failing (maybe no internet: the connection store probes to find out) and tiles that take seconds to
// arrive (weak signal: the status chip says so instead of leaving a half-drawn map unexplained).
const ERRORS_BEFORE_SUSPECT = 4;
export function watchTiles(sources: XYZ[], report: { suspect(): void; slow(value: boolean): void }) {
  const pending = new Map<Tile, number>();
  let errors = 0, slow = false, timer: ReturnType<typeof setInterval> | undefined;
  function measure() {
    const now = Date.now(), next = [...pending.values()].some(started => now - started > SLOW_MS);
    if (next !== slow) { slow = next; report.slow(next); }
    if (!pending.size) { clearInterval(timer); timer = undefined; }
  }
  const settle = (event: TileSourceEvent) => { pending.delete(event.tile); measure(); };
  const keys = sources.flatMap(source => [
    source.on('tileloadstart', event => { pending.set(event.tile, Date.now()); timer ??= setInterval(measure, 1000); }),
    source.on('tileloadend', event => { errors = 0; settle(event); }),
    source.on('tileloaderror', event => { settle(event); if (++errors >= ERRORS_BEFORE_SUSPECT) { errors = 0; report.suspect(); } }),
  ]);
  return {
    // Tiles that failed while offline are remembered as errors; asking again is what brings them back.
    reload() { pending.clear(); measure(); for (const source of sources) source.refresh(); },
    dispose() { clearInterval(timer); unByKey(keys); if (slow) report.slow(false); },
  };
}
