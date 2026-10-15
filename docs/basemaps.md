# Basemaps

The map carries two satellite basemaps, radio-switched under **Peta Dasar** in
the layer panel (`layers/layers.js`). Google is on at load; Esri is the
fallback.

| | Google Satelit (default) | Esri Satelit |
|---|---|---|
| Endpoint | `mt1.google.com/vt?lyrs=s` | `services.arcgisonline.com/.../World_Imagery/MapServer/tile/{z}/{y}/{x}` |
| Key / quota | none | none |
| Usable zoom over Jambi | 21 | 18 |
| Licence | outside Google Maps Platform terms | Esri terms; commercial use expects an ArcGIS licence |

## Why Google still leads

Zoom, and nothing else. Probed on 15 September 2026 at Jambi city
(`103.6131, -1.6101`), Kerinci (`101.3870, -2.0600`) and open country between
them: every Esri tile at z19 and above returned the same 2521-byte "Map data
not yet available" placeholder, md5 `f27d9de7f80c13501f470595e327aa6d`. The
same probe over Jakarta reaches z19, so this is a coverage gap in Sumatra, not
a service-wide ceiling. Two zoom levels decide whether an installer sees the
pole or only the block it stands on.

The Esri source is therefore capped at `maxZoom: 18`. OpenLayers stretches z18
past that instead of requesting the placeholder — a soft image reads as the
edge of the data, a grid of "not yet available" tiles reads as a broken map.

Re-run the probe before changing the default; Esri backfills imagery.

```sh
curl -sS -o /tmp/t.jpg \
  "https://services.arcgisonline.com/arcgis/rest/services/World_Imagery/MapServer/tile/19/264489/413041" \
  && wc -c < /tmp/t.jpg   # 2521 = placeholder, larger = real imagery
```

## Why Esri is there at all

`mt1.google.com` is an internal Google Maps endpoint. It takes no API key, is
covered by no agreement, and carries no SLA — it works until it does not. Esri
World Imagery is the licensed route to substantially the same commercial
imagery, so a single radio click keeps the page showing a map on the day the
Google endpoint starts refusing us.

## Map Tiles API (October 2026)

The Google layer now uses Google's **Map Tiles API** (2D satellite) through
`src/public/map/google-tiles.ts`, shared by the public map and the admin. The
mt1 endpoint and the table above describe the earlier setup.

- Key: `VITE_GOOGLE_MAPS_KEY`, baked in at build time (`.env.local` locally,
  a Railway build variable in production). Restricted to the
  `https://survey.esdm.cloud/*` referrer and the Map Tiles API, with a daily
  quota cap so the free monthly tier cannot be exceeded silently.
- Billing is per 256 px tile. The session token is kept in `localStorage`
  until an hour before it expires, so tile URLs stay identical across visits
  and the browser serves repeat views from its HTTP cache under Google's
  `Cache-Control` headers (`private, max-age=86400, must-revalidate`, with an
  ETag) instead of requesting them again. Nothing is pre-fetched.
- Capped at z20: Google's imagery over Jambi stops there (viewport
  `maxZoomRects`, probed October 2026), and its z21 tiles are upscaled z20.
- Attribution: "Google Maps" plus the viewport `copyright` string, as Google's
  policy requires. The viewport is asked for a buffered extent, so panning
  within it needs no new request.
- Requests carry `Referrer-Policy: strict-origin`, because the admin's pages
  send no referrer cross-origin and the key would otherwise refuse them.
- Fallback: no key, a refused session, or a run of failed tiles that a probe
  of the world tile confirms is not just missing imagery all switch the map to
  Esri, and the layer panel follows.

## Attribution

Each source declares its own credit, so the strip at the bottom right swaps
with the basemap. `custom.js` measures that block into `--map-meta-inset`, the
right edge of the legend band; `.bottom-attribution ul` in `custom.css` caps
the block at 240px and wraps, because the Esri credit is a full sentence and
would otherwise push the legend across the map.

Esri's string is the service's own `copyrightText`, verbatim:

> Citra © Esri, Vantor, Earthstar Geographics, and the GIS User Community

**Vantor** is Maxar Intelligence, renamed in October 2025 — the same imagery
that used to be credited to Maxar Technologies. Re-check `copyrightText` if the
service is ever repointed:

```sh
curl -sS "https://services.arcgisonline.com/arcgis/rest/services/World_Imagery/MapServer?f=pjson" \
  | python3 -c "import json,sys; print(json.load(sys.stdin)['copyrightText'])"
```

## What the imagery date is not

Neither source exposes an acquisition date. A "© 2026" notice is the copyright
year of the notice, not the day the pixels were taken, which can be several
years older. Field condition in 2026 is evidenced by the survey photographs in
the popup, not by the basemap. To date the imagery itself, use Google Earth
Pro's historical timeline or Esri's World Imagery Metadata layer, both outside
this app.
