# Basemaps

The atlas opens with a light street map and offers two satellite alternatives,
radio-switched under **Peta Dasar** in the layer panel (`layers/layers.js`) or
the top selector. See the atlas section below for the street source.

| | Google Satelit | Esri Satelit |
|---|---|---|
| Endpoint | `mt1.google.com/vt?lyrs=s` | `services.arcgisonline.com/.../World_Imagery/MapServer/tile/{z}/{y}/{x}` |
| Key / quota | none | none |
| Usable zoom over Jambi | 21 | 18 |
| Licence | outside Google Maps Platform terms | Esri terms; commercial use expects an ArcGIS licence |

## Why Google is the first satellite option

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

The fully supported alternative is Google's **Map Tiles API** (2D tiles): a
billed API key, a session token per viewer, mandatory Google attribution, and
no caching or pre-fetching of tiles. That is a larger change than a layer swap
and has not been made.

## Attribution

Each source declares its own credit, so the footer attribution swaps with the
basemap. `custom.js` places the legend, scale, and attribution in
`.atlas-map-footer`; `atlas.css` reserves a separate 48px row below the desktop
canvas. The attribution wraps within 260px, including the longer Esri credit.
On mobile the footer stacks the legend and attribution above the list preview.

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

## Atlas layout (September 2026)

The atlas opens with **Peta jalan**, using the standard OpenStreetMap raster
endpoint `https://tile.openstreetmap.org/{z}/{x}/{y}.png` (maximum source zoom 19).
Google and Esri satellite imagery remain available in the layer panel.
Boundary labels and the province mask change contrast with the
selected basemap. The existing satellite zoom limits remain unchanged.

OSM attribution remains visible as a small line on mobile, without restoring the
old tile metadata card or scale ruler. Browser caching and the normal Referer are
preserved; there is no tile prefetch or offline download. Usage policy:
https://operations.osmfoundation.org/policies/tiles/.

`atlas.css` owns the responsive application frame. The underlying list, status
flags, source data, and photo paths remain in the existing atlas components.
The interface uses white surfaces, ESDM blue (`#0072BC`) for actions, navy text,
and pale blue selection states. Map colors remain independent: yellow PJUTS
pins, orange verification outlines, slate placeholder/reserve symbols, and the
existing boundary and province-mask colors.
The map uses the full available height until a point is selected. Desktop
details then open in the bottom dock; closing them restores the map area while
preserving its center and zoom. Mobile uses the existing location card. Counts
exclude reserve points, as in the original list.

Search and the custom region dropdown occupy a separate toolbar above the
map. Basemap selection is available only in the Layer panel. The original region
select remains the source of truth; its custom combobox supports arrow keys,
Home/End, type-ahead, Enter, and Escape. Its menu attaches to the document body
to avoid clipping. The scrollable layer panel
lives outside the map container and opens in place of the list panel. Zoom and
fit controls share one rail on the right.
