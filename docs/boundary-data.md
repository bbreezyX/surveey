# Batas kabupaten/kota Jambi

The map uses the **Badan Informasi Geospasial (BIG), June 2026 service edition**:

- [Service and edition metadata](https://geoservices.big.go.id/rbi/rest/services/BATASWILAYAH/BATAS_KABKOTA_AR/MapServer)
- [Polygon layer and fields](https://geoservices.big.go.id/rbi/rest/services/BATASWILAYAH/BATAS_KABKOTA_AR/MapServer/0)
- Filter: `KDPPUM = '15'` (Jambi); 9 kabupaten and 2 kota.
- Downloaded on 7 September 2026. Provenance and the original download SHA-256
  are recorded in `data/boundaries-source.json`.

The service edition does **not** mean every district boundary was revised in
2026. The source's `METADATA` identifiers are preserved per feature: Tanjung
Jabung Barat and Tanjung Jabung Timur contain `20260612`, Tebo contains
`20230907`, and the other eight contain `20221227`.

`layers/BatasKabupaten_1.js` replaces the old `BatasKabupaten2011_1.js` export.
It remains synchronously loaded before point grouping is initialized. The
`KABUPATEN_` display field retains the existing `KAB.` / `KOTA` names used by
the labels and sidebar. The source's names and administrative codes are also
preserved. `data/dissolved.geojson` is the union of the same polygons, used by
both Area Cakupan and Fokus Provinsi. Google satellite tiles are independent.

For web display, shared boundaries are simplified together with a 10 m tolerance
in UTM 48S (`EPSG:32748`), then returned to `EPSG:4326` on a 0.000001-degree
coordinate grid. This keeps adjacent boundaries aligned and limits payload
size: the source is a 1:50,000 product (`TASWIL50000…`), so 10 m stays inside
its own positional uncertainty, and `/data/regions.json` dropped from about
123 KB to 78 KB gzipped (the boundaries were the largest file on a phone's
first load). The earlier 2 m derivative bought no real precision. This is a display derivative, not a cadastral or legal boundary survey.
The import checks polygon validity, coverage topology, all 11 expected codes,
and unchanged point membership against the unsimplified BIG geometry.

## Rebuild this snapshot

Use Python with `shapely>=2.1` and `pyproj` installed (prefer a temporary venv).
The live service can change editions: check its metadata before downloading
again and update the importer/provenance if intentionally using a newer edition.

```sh
curl --fail --show-error --max-time 120 --get \
  'https://geoservices.big.go.id/rbi/rest/services/BATASWILAYAH/BATAS_KABKOTA_AR/MapServer/0/query' \
  --data-urlencode "where=KDPPUM = '15'" \
  --data-urlencode 'outFields=OBJECTID,NAMOBJ,KDPKAB,KDPPUM,WADMKK,WADMPR,METADATA' \
  --data-urlencode 'returnGeometry=true' \
  --data-urlencode 'returnZ=false' \
  --data-urlencode 'outSR=4326' \
  --data-urlencode 'f=geojson' \
  -o /tmp/big-jambi-june-2026.geojson

python scripts/import_big_boundaries.py /tmp/big-jambi-june-2026.geojson
```

The runtime serves the generated files locally. It does not depend on BIG's
service availability or require a Google Maps API key to show these boundaries.
