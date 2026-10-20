// What the connection is doing, for the status chip on the map (ConnectionStatus.svelte) and for the
// map's offline basemap. Crews work on 2G/EDGE or with no signal at all, and a map that just sits there
// blank or half-drawn reads as broken; this lets the page say "loading", "weak signal" or "no internet".
//
// navigator.onLine only knows about the radio: on a dead 2G link or captive Wi-Fi it still says true.
// Repeated failures therefore trigger a probe of our own origin, which is free (Google bills tiles, not
// our server) and tells "no internet" apart from "a tile provider refused us", which the Google layer
// handles on its own by renewing its session or falling back to Esri.
// Long enough that a normal 4G load never flashes the notice; short enough to explain a real wait.
export const SLOW_MS = 3000;
const RETRY_MS = 15_000, PROBE_TIMEOUT_MS = 8000;
export async function reachable(): Promise<boolean> {
  const attempt = new AbortController(), timer = setTimeout(() => attempt.abort(), PROBE_TIMEOUT_MS);
  // The service worker never answers /favicon.ico, so this always goes to the network.
  try { await fetch(`/favicon.ico?online=${Date.now()}`, { method: 'HEAD', cache: 'no-store', signal: attempt.signal }); return true; }
  catch { return false; }
  finally { clearTimeout(timer); }
}
// Android Chrome reports the link type; Safari does not, so iPhones rely on the timers alone.
type NetworkInformation = EventTarget & { effectiveType?: string; saveData?: boolean };
const network = () => (navigator as Navigator & { connection?: NetworkInformation }).connection;
const weakType = () => { const info = network(); return !!info && (info.effectiveType === 'slow-2g' || info.effectiveType === '2g'); };

export function createConnection(probe = reachable) {
  let offline = $state(false), dataLoading = $state(false), dataSlow = $state(false), tilesSlow = $state(false), weakLink = $state(false);
  let probing = false, retry: ReturnType<typeof setTimeout> | undefined, slowTimer: ReturnType<typeof setTimeout> | undefined;
  function setOffline(next: boolean) {
    if (next === offline) return;
    offline = next; clearTimeout(retry);
    if (next) schedule();
  }
  function schedule() { clearTimeout(retry); retry = setTimeout(() => { void check(); }, RETRY_MS); }
  async function check() {
    if (probing) return;
    // A hidden tab waits; the visibility listener checks again the moment the reader is back.
    if (offline && document.visibilityState !== 'visible') { schedule(); return; }
    probing = true;
    try { setOffline(!(await probe())); if (offline) schedule(); } finally { probing = false; }
  }
  const wentOffline = () => setOffline(true), cameBack = () => { void check(); };
  const visible = () => { if (offline && document.visibilityState === 'visible') void check(); };
  const linkChanged = () => { weakLink = weakType(); };
  return {
    get offline() { return offline; },
    get dataLoading() { return dataLoading; },
    // Weak signal: a data load or the imagery is taking unusually long, or Android says 2G.
    get slow() { return !offline && (dataSlow || tilesSlow || weakLink); },
    get dataSlow() { return dataSlow; },
    /** Something failed in a way that could be a dead link: find out instead of guessing. */
    suspect() { if (!offline) void check(); },
    /** A load is under way (true) or over (false). Past SLOW_MS it counts as weak signal. */
    loading(active: boolean) {
      clearTimeout(slowTimer);
      if (active) { dataLoading = true; slowTimer = setTimeout(() => { if (dataLoading) dataSlow = true; }, SLOW_MS); }
      else { dataLoading = false; dataSlow = false; }
    },
    set tilesSlow(value: boolean) { tilesSlow = value; },
    start() {
      addEventListener('offline', wentOffline); addEventListener('online', cameBack); document.addEventListener('visibilitychange', visible);
      network()?.addEventListener('change', linkChanged); linkChanged();
      if (navigator.onLine === false) setOffline(true);
      return () => {
        clearTimeout(retry); clearTimeout(slowTimer);
        removeEventListener('offline', wentOffline); removeEventListener('online', cameBack); document.removeEventListener('visibilitychange', visible);
        network()?.removeEventListener('change', linkChanged);
      };
    },
  };
}
export type Connection = ReturnType<typeof createConnection>;
