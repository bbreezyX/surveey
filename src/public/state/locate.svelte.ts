import type { Fix } from './nearby';
export type LocateStatus = 'off' | 'seeking' | 'on' | 'denied' | 'error';
const OFF_KEY = 'puts.locateOff';
// The first request is always an explicit tap: prompting every visitor of a public map on load mostly
// earns a reflexive "block", which the browser remembers and which then locks out the field crews too.
// Once a phone has granted access, later visits start straight away without asking again.
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
      // Older Safari has no Permissions API; there the first tap stays the only way in.
      const permission = await navigator.permissions?.query({ name: 'geolocation' }).catch(() => null);
      if (permission?.state === 'granted' && status === 'off' && !disposed) start();
    },
    dispose() { disposed = true; stop(); },
  };
}
export type Locator = ReturnType<typeof createLocator>;
