import type { Fix } from './nearby';
export type LocateStatus = 'off' | 'seeking' | 'on' | 'denied' | 'error';
const OFF_KEY = 'puts.locateOff';
// GPS is requested as soon as the map opens, so field crews see their nearest unit without a tap. The
// trade-off is accepted knowingly: casual visitors of a public map often answer a load-time prompt with
// "block", and the browser remembers that until it is reset in site settings.
export function createLocator() {
  let status = $state<LocateStatus>('off'), fix = $state.raw<Fix | null>(null), watch: number | null = null, disposed = false;
  function remember(off: boolean) { try { if (off) localStorage.setItem(OFF_KEY, '1'); else localStorage.removeItem(OFF_KEY); } catch { /* Storage disabled: auto-start just keeps happening. */ } }
  function stop() { if (watch !== null) navigator.geolocation.clearWatch(watch); watch = null; }
  function start() {
    stop(); fix = null; remember(false);
    if (!('geolocation' in navigator)) { status = 'error'; return; }
    status = 'seeking';
    watch = navigator.geolocation.watchPosition(
      position => { fix = { lat: position.coords.latitude, lon: position.coords.longitude, accuracy: position.coords.accuracy }; status = 'on'; },
      // A timeout after a good fix only means the phone is waiting for a better one; keep showing the last.
      problem => { if (problem.code === problem.PERMISSION_DENIED) { stop(); status = 'denied'; } else if (!fix) status = 'error'; },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 },
    );
  }
  return {
    get status() { return status; }, get fix() { return fix; },
    start,
    // Someone who switched it off keeps it off on the next visit, even though permission stands.
    toggle() { if (status === 'off') start(); else { stop(); status = 'off'; fix = null; remember(true); } },
    async resume() {
      try { if (localStorage.getItem(OFF_KEY)) return; } catch { /* Storage disabled: treat as not switched off. */ }
      // A site already blocked would only greet every visit with the "izin ditolak" line, so it keeps the
      // card instead. Older Safari has no Permissions API and simply gets the prompt.
      const permission = await navigator.permissions?.query({ name: 'geolocation' }).catch(() => null);
      if (permission?.state !== 'denied' && status === 'off' && !disposed) start();
    },
    dispose() { disposed = true; stop(); },
  };
}
export type Locator = ReturnType<typeof createLocator>;
