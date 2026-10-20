// What the connection is doing, for the status chip on the map (ConnectionStatus.svelte) and for the
// map's offline basemap. Crews work on 2G/EDGE or with no signal at all, and a map that just sits there
// blank or half-drawn reads as broken; this lets the page explain loading, weak connection or offline.
//
// navigator.onLine only knows about the radio: on a dead 2G link or captive Wi-Fi it still says true.
// Repeated failures therefore trigger a probe of our own origin, which is free (Google bills tiles, not
// our server) and tells "no internet" apart from "a tile provider refused us", which the Google layer
// handles on its own by renewing its session or falling back to Esri.
// A resource taking this long only starts a quality check. It cannot establish weak signal alone.
export const SLOW_MS = 3000;
const RETRY_MS = 15_000, QUALITY_RETRY_MS = 5000, PROBE_TIMEOUT_MS = 8000, WEAK_CONFIRMATIONS = 3;
const MIN_TRANSFER_BYTES = 4096, MIN_TRANSFER_MS = 500, SLOW_BYTES_PER_SECOND = 16 * 1024;
export type ConnectionSample = { reachable: boolean; slow: boolean };
export async function reachable(): Promise<ConnectionSample> {
  const attempt = new AbortController(), timer = setTimeout(() => attempt.abort(), PROBE_TIMEOUT_MS);
  const started = performance.now(); let responded = false;
  // The existing ~9 KB icon supplies a bounded transfer sample without downloading tiles or adding
  // a speed-test asset. The worker never handles this URL; no-store bypasses the browser cache too.
  try {
    const response = await fetch(`/favicon.ico?online=${Date.now()}`, { method: 'GET', cache: 'no-store', signal: attempt.signal });
    responded = true; const headersAt = performance.now();
    const body = await response.arrayBuffer(), finished = performance.now(), transferMs = finished - headersAt;
    const lowBandwidth = body.byteLength >= MIN_TRANSFER_BYTES && transferMs >= MIN_TRANSFER_MS && body.byteLength * 1000 / transferMs < SLOW_BYTES_PER_SECOND;
    return { reachable: true, slow: finished - started > SLOW_MS || lowBandwidth };
  }
  catch { return { reachable: responded, slow: responded && attempt.signal.aborted }; }
  finally { clearTimeout(timer); }
}
export function createConnection(probe: () => Promise<boolean | ConnectionSample> = reachable) {
  let offline = $state(false), dataLoading = $state(false), dataSlow = $state(false), tilesSlow = $state(false), weakLink = $state(false);
  let probing = false, stopped = false, slowSamples = 0, qualityRevision = 0;
  let retry: ReturnType<typeof setTimeout> | undefined, slowTimer: ReturnType<typeof setTimeout> | undefined;
  const waiting = () => dataSlow || tilesSlow;
  function resetQuality() { weakLink = false; slowSamples = 0; qualityRevision++; }
  function setOffline(next: boolean) {
    if (next === offline) return;
    offline = next; resetQuality(); clearTimeout(retry);
    if (next) schedule();
  }
  function schedule() {
    clearTimeout(retry);
    if (!stopped && (offline || waiting())) retry = setTimeout(() => { void check(!offline); }, offline ? RETRY_MS : QUALITY_RETRY_MS);
  }
  function waitingChanged() {
    resetQuality(); clearTimeout(retry);
    if (offline) schedule();
    else if (waiting()) void check(true);
  }
  async function check(qualityOnly = false) {
    if (probing || stopped) return;
    // A hidden tab waits; resume the outstanding check when the reader returns.
    if (document.visibilityState !== 'visible') { schedule(); return; }
    probing = true;
    const revision = qualityRevision, started = performance.now();
    try {
      const sample = await probe();
      const alive = typeof sample === 'boolean' ? sample : sample.reachable;
      const sampleSlow = typeof sample === 'boolean' ? performance.now() - started > SLOW_MS : sample.slow;
      if (stopped || qualityOnly && (revision !== qualityRevision || !waiting())) return;
      // A single unsuccessful quality sample is inconclusive. Offline detection still comes from
      // browser events or the existing checks triggered by failed data/tile requests.
      if (!alive && qualityOnly) resetQuality();
      else setOffline(!alive);
      if (alive && waiting() && revision === qualityRevision) {
        // A slow imagery provider must not blame fast Wi-Fi: the independent same-origin sample
        // must confirm poor latency or transfer speed three times. One fast sample clears the warning.
        slowSamples = sampleSlow ? slowSamples + 1 : 0;
        weakLink = slowSamples >= WEAK_CONFIRMATIONS;
      }
    } finally { probing = false; schedule(); }
  }
  const wentOffline = () => setOffline(true), cameBack = () => { void check(); };
  const visible = () => { if ((offline || waiting()) && document.visibilityState === 'visible') void check(!offline); };
  return {
    get offline() { return offline; },
    get dataLoading() { return dataLoading; },
    get slow() { return !offline && weakLink && waiting(); },
    get dataSlow() { return dataSlow; },
    get tilesSlow() { return tilesSlow; },
    /** Something failed in a way that could be a dead link: find out instead of guessing. */
    suspect() { if (!offline) void check(); },
    /** A load is under way (true) or over (false). Past SLOW_MS, explain that it is still pending. */
    loading(active: boolean) {
      clearTimeout(slowTimer);
      dataLoading = active; dataSlow = false;
      waitingChanged();
      if (active) slowTimer = setTimeout(() => { if (dataLoading) { dataSlow = true; waitingChanged(); } }, SLOW_MS);
    },
    set tilesSlow(value: boolean) { if (tilesSlow === value) return; tilesSlow = value; waitingChanged(); },
    start() {
      stopped = false;
      addEventListener('offline', wentOffline); addEventListener('online', cameBack); document.addEventListener('visibilitychange', visible);
      if (navigator.onLine === false) setOffline(true);
      return () => {
        stopped = true; resetQuality();
        clearTimeout(retry); clearTimeout(slowTimer);
        removeEventListener('offline', wentOffline); removeEventListener('online', cameBack); document.removeEventListener('visibilitychange', visible);
      };
    },
  };
}
export type Connection = ReturnType<typeof createConnection>;
