import type { Fix } from './nearby';
export type LocateStatus = 'off' | 'seeking' | 'on' | 'denied' | 'error';
// GPS is requested only when someone taps "Terdekat". Asking on page load put a permission prompt in
// front of every visitor before they knew why, and casual visitors answer that with "block", which the
// browser remembers until it is reset in site settings. A tap gives the prompt its context.
export function createLocator() {
  let status = $state<LocateStatus>('off'), fix = $state.raw<Fix | null>(null), watch: number | null = null;
  function stop() { if (watch !== null) navigator.geolocation.clearWatch(watch); watch = null; }
  function start() {
    stop(); fix = null;
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
    toggle() { if (status === 'off') start(); else { stop(); status = 'off'; fix = null; } },
    dispose() { stop(); },
  };
}
export type Locator = ReturnType<typeof createLocator>;
