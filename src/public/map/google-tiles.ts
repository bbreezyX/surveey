import type OlMap from 'ol/Map';
import TileLayer from 'ol/layer/Tile';
import XYZ from 'ol/source/XYZ';
import type ImageTile from 'ol/ImageTile';
import { transformExtent } from 'ol/proj';
import { buffer, containsExtent, getWidth, type Extent } from 'ol/extent';
import { unByKey } from 'ol/Observable';

// Google's Map Tiles API (2D satellite) replaces the unofficial mt1.google.com endpoint. Every 256 px
// tile is a billed request past the monthly free tier, so the choices below are about asking for as
// few tiles as possible, not only about getting them to draw.
const KEY: string = import.meta.env.VITE_GOOGLE_MAPS_KEY ?? '';
const API = 'https://tile.googleapis.com';
// One token is shared by the public map and the admin (same origin). A stable token keeps tile URLs
// identical across visits, so the browser answers repeat views from its HTTP cache under Google's own
// Cache-Control headers instead of billing them again; a fresh token per visit would defeat that.
const STORE = 'pjuts.google-tiles';
// Renew an hour early so a token never expires halfway through a session in the field.
const MARGIN = 3_600_000;
// The key is restricted by referrer, but the admin's pages send none cross-origin (Django's same-origin
// policy). Every Google request therefore carries just the origin, never the admin path behind it.
const REFERRER: ReferrerPolicy = 'strict-origin';
const ESRI_CREDIT = 'Citra &copy; Esri, Vantor, Earthstar Geographics, and the GIS User Community';

export function storedSession(raw: string | null, key: string, now: number): string | null {
  if (!raw) return null;
  try {
    const stored = JSON.parse(raw) as { key?: string; session?: string; expiry?: number };
    return stored.key === key && typeof stored.session === 'string' && typeof stored.expiry === 'number' && stored.expiry - now > MARGIN ? stored.session : null;
  } catch { return null; }
}

// Google's terms require "Google Maps" next to the providers the viewport names, in full.
export function googleCredit(copyright: string | undefined): string {
  const escaped = (copyright ?? '').trim().replace(/[&<>"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[char]!);
  return escaped ? `Google Maps &middot; ${escaped}` : 'Google Maps';
}

let pending: Promise<string> | null = null;
function session(fresh: boolean): Promise<string> {
  if (!fresh) { let reused: string | null = null; try { reused = storedSession(localStorage.getItem(STORE), KEY, Date.now()); } catch { /* storage blocked */ } if (reused) return Promise.resolve(reused); }
  // The public map and a second map on the same page would otherwise each create a session.
  return pending ??= (async () => {
    try {
      const response = await fetch(`${API}/v1/createSession?key=${encodeURIComponent(KEY)}`, { method: 'POST', referrerPolicy: REFERRER, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mapType: 'satellite', language: 'id-ID', region: 'ID' }) });
      if (!response.ok) throw new Error(`createSession ${response.status}`);
      const body = await response.json() as { session: string; expiry: string };
      try { localStorage.setItem(STORE, JSON.stringify({ key: KEY, session: body.session, expiry: Number(body.expiry) * 1000 })); } catch { /* storage blocked: the token lives for this page only */ }
      return body.session;
    } finally { pending = null; }
  })();
}

export interface SatelliteLayers { google: TileLayer<XYZ>; esri: TileLayer<XYZ>; attach(map: OlMap): () => void }

// onFallback reports that Google is unusable (no key, refused key, spent quota) and Esri has taken
// over, so a layer switcher can show the basemap that is really on screen.
export function satelliteLayers(onFallback?: () => void): SatelliteLayers {
  // No url until a session exists: an XYZ source without one requests nothing. Google's imagery over
  // Jambi stops at z20 (viewport maxZoomRects at Kota Jambi, Kerinci, Muara Bungo and open country,
  // October 2026); its z21 tiles are z20 upscaled, so OpenLayers stretches z20 itself instead of
  // paying for a whole extra zoom level that adds no detail.
  const source = new XYZ({ maxZoom: 20, attributions: googleCredit(undefined), tileLoadFunction: (tile, src) => { const image = (tile as ImageTile).getImage() as HTMLImageElement; image.referrerPolicy = REFERRER; image.src = src; } });
  const google = new TileLayer({ source });
  const esri = new TileLayer({ visible: false, source: new XYZ({ url: 'https://services.arcgisonline.com/arcgis/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', maxZoom: 18, attributions: ESRI_CREDIT }) });
  let token: string | null = null, refreshed = false, misses = 0, starting = false, disposed = false;
  let asked: { zoom: number; extent: Extent } | null = null, creditRequest = 0, credit = () => {};
  const tileUrl = (z: number | string, x: number | string, y: number | string) => `${API}/v1/2dtiles/${z}/${x}/${y}?session=${token}&key=${encodeURIComponent(KEY)}`;
  function use(next: string) { token = next; misses = 0; asked = null; source.setUrl(tileUrl('{z}', '{x}', '{y}')); credit(); }
  function fallback() { if (disposed) return; google.setVisible(false); esri.setVisible(true); onFallback?.(); }
  async function start() {
    if (token || starting || disposed) return;
    if (!KEY) { fallback(); return; }
    starting = true;
    // A TypeError is fetch failing to reach Google at all (no internet), not Google refusing the key:
    // stay on Google and try again when the connection returns instead of switching to Esri for good.
    try { const next = await session(false); if (!disposed) use(next); } catch (problem) { if (!(problem instanceof TypeError)) fallback(); } finally { starting = false; }
  }
  // A run of failed tiles is either imagery that stops short (z21 over open country) or a dead token,
  // key or quota. The world tile always exists, so one uncached probe tells the two apart before
  // anything is renewed or switched.
  async function check() {
    // null: the request never reached Google (offline). That says nothing about the key or quota.
    const alive = await fetch(tileUrl(0, 0, 0), { cache: 'no-store', referrerPolicy: REFERRER }).then(response => response.ok, () => null);
    if (disposed) return;
    if (alive !== false) { misses = 0; return; }
    if (!refreshed) { refreshed = true; try { use(await session(true)); return; } catch (problem) { if (problem instanceof TypeError) { refreshed = false; return; } } }
    fallback();
  }
  source.on('tileloadend', () => { misses = 0; });
  source.on('tileloaderror', () => { if (++misses === 8) void check(); });
  return {
    google, esri,
    attach(map) {
      // The copyright line depends on what is in view. Asking for a buffered extent means panning
      // inside it, or zooming back to the same level, needs no new request.
      async function viewport() {
        if (!token || !google.getVisible()) return;
        const view = map.getView(), size = map.getSize(); if (!size) return;
        const zoom = Math.round(view.getZoom() ?? 0), extent = view.calculateExtent(size);
        if (asked && asked.zoom === zoom && containsExtent(asked.extent, extent)) return;
        const wide = buffer(extent, getWidth(extent) / 2), request = ++creditRequest;
        asked = { zoom, extent: wide };
        const [west, south, east, north] = transformExtent(wide, 'EPSG:3857', 'EPSG:4326');
        const query = new URLSearchParams({ session: token, key: KEY, zoom: String(zoom), north: String(Math.min(north, 85)), south: String(Math.max(south, -85)), east: String(Math.min(east, 180)), west: String(Math.max(west, -180)) });
        try {
          const response = await fetch(`${API}/tile/v1/viewport?${query}`, { referrerPolicy: REFERRER });
          if (!response.ok) throw new Error(`viewport ${response.status}`);
          const body = await response.json() as { copyright?: string };
          if (request === creditRequest && !disposed) source.setAttributions(googleCredit(body.copyright));
        } catch { if (request === creditRequest) asked = null; }
      }
      credit = () => void viewport();
      const keys = [map.on('moveend', credit), google.on('change:visible', () => { if (google.getVisible()) { void start(); credit(); } })];
      // A first visit made offline has no session yet; get one as soon as the connection is back.
      const online = () => { if (google.getVisible()) { void start(); credit(); } };
      addEventListener('online', online);
      if (google.getVisible()) void start();
      return () => { disposed = true; unByKey(keys); removeEventListener('online', online); };
    },
  };
}
