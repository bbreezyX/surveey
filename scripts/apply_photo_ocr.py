#!/usr/bin/env python3
"""Write values read off the survey photos' GPS overlay back into points.geojson.

The survey photos in images/ carry a burned-in stamp from the field app
(Timemark and friends) holding the coordinate and the capture time. That stamp
is the source of record for two things the exported attribute table gets wrong:

1. Coordinates. QGIS exports them at 5 decimals; the stamp carries 6. Worse,
   TEBO-MUARA TABIR-EMBACANG GEDANG-005 was exported with its neighbour's
   coordinate -- the stamp puts it 10.3 m away from where the table does.

2. Tanggal Dokumentasi. 23 Kerinci records came through empty. Every one of
   those photos is stamped with a date, and the weekday printed next to it
   matches the 2026 calendar in all 23 cases.

Both tables below were transcribed by reading the photos. They were checked
against the export: all 30 coordinates agree to within rounding except
EMBACANG GEDANG-005, and all 30 photo dates that had a table value agree with
it exactly. That is why the date fill below refuses to overwrite a value that
is already there -- if the two ever disagree, that is a finding, not something
to paper over.

Run after any QGIS re-export, otherwise the export's values come back. Run it
AFTER normalize_attributes.py -- the tables below are keyed on Nomor, and that
script rewrites 86 of them from "JAMBI-" to "KOTA JAMBI-". Order it the other
way and this script stops on an unknown-Nomor error rather than writing
anything:

    ./scripts/normalize_attributes.py
    ./scripts/apply_photo_ocr.py

Points whose stamp could not be read are deliberately absent from both tables.
Six are stored as 210x165 thumbnails whose overlay text is ~3 px tall, and two
(SIULAK MUKAI-TALANG TINGGI-003/-005) use an app version that prints a Plus
Code instead of a coordinate. Those 8 need a field revisit; see
docs/titik-tumpuk.csv.
"""

import io
import json
import os
import sys

# Nomor -> (longitude, latitude), transcribed from the photo's coordinate stamp.
PHOTO_COORDS = {
    "TANJUNG JABUNG TIMUR-KUALA JAMBI-KAMPUNG LAUT-002": (103.806097, -1.032034),
    "TANJUNG JABUNG TIMUR-KUALA JAMBI-KAMPUNG LAUT-003": (103.806097, -1.032034),
    "TANJUNG JABUNG TIMUR-KUALA JAMBI-KAMPUNG LAUT-004": (103.806097, -1.032034),
    "TANJUNG JABUNG TIMUR-KUALA JAMBI-KAMPUNG LAUT-005": (103.806097, -1.032034),
    "TANJUNG JABUNG TIMUR-KUALA JAMBI-KAMPUNG LAUT-006": (103.806097, -1.032034),
    "TANJUNG JABUNG TIMUR-KUALA JAMBI-KAMPUNG LAUT-007": (103.806097, -1.032034),
    "TANJUNG JABUNG TIMUR-KUALA JAMBI-KAMPUNG LAUT-008": (103.806097, -1.032034),
    "TANJUNG JABUNG TIMUR-KUALA JAMBI-KAMPUNG LAUT-009": (103.806097, -1.032034),
    # The one real correction: the export gave -005 its neighbours' coordinate.
    "TEBO-MUARA TABIR-EMBACANG GEDANG-005": (102.519337, -1.650156),
    "TEBO-MUARA TABIR-EMBACANG GEDANG-006": (102.519275, -1.650222),
    "TEBO-MUARA TABIR-EMBACANG GEDANG-007": (102.519275, -1.650222),
    "TEBO-MUARA TABIR-EMBACANG GEDANG-008": (102.519275, -1.650222),
    "TEBO-MUARA TABIR-EMBACANG GEDANG-009": (102.519275, -1.650222),
    "TEBO-MUARA TABIR-EMBACANG GEDANG-010": (102.519275, -1.650222),
    "KOTA JAMBI-TELANAIPURA-PEMATANG SULUR-003": (103.561593, -1.597150),
    "KOTA JAMBI-TELANAIPURA-PEMATANG SULUR-004": (103.561593, -1.597150),
    "KERINCI-SIULAK-DEMONG SAKTI-001": (101.349735, -1.964147),
    "KERINCI-SIULAK-DEMONG SAKTI-002": (101.349918, -1.964415),
    "KERINCI-SIULAK-TELAGO BIRU-001": (101.356217, -1.969179),
    "KERINCI-SIULAK-TELAGO BIRU-002": (101.356217, -1.969179),
    "MUARO JAMBI-MESTONG-PELEMPANG-001": (103.490379, -1.828326),
    "MUARO JAMBI-MESTONG-PELEMPANG-002": (103.490379, -1.828326),
    "SAROLANGUN-BATANG ASAI-BATU EMPANG-005": (102.235430, -2.627897),
    "SAROLANGUN-BATANG ASAI-BATU EMPANG-006": (102.235430, -2.627897),
    "TANJUNG JABUNG TIMUR-KUALA JAMBI-TANJUNG SOLOK-001": (103.796618, -1.027228),
    "TANJUNG JABUNG TIMUR-KUALA JAMBI-TANJUNG SOLOK-002": (103.796618, -1.027228),
    "TANJUNG JABUNG TIMUR-KUALA JAMBI-TANJUNG SOLOK-005": (103.798517, -1.027367),
    "TANJUNG JABUNG TIMUR-KUALA JAMBI-TANJUNG SOLOK-006": (103.798517, -1.027367),
    "TEBO-MUARA TABIR-PINTAS TUO-005": (102.553443, -1.655730),
    "TEBO-MUARA TABIR-PINTAS TUO-006": (102.553443, -1.655730),

    # Sekancing stamps are 6 decimals; the attribute table was rounded to 5
    # so the popup printed 102.18771 next to a photo that says 102.187706.
    # Geometry already held the stamp. These write the properties back.
    "MERANGIN-TIANG PUMPUNG-SEKANCING-001": (102.187706, -2.255436),
    "MERANGIN-TIANG PUMPUNG-SEKANCING-002": (102.187755, -2.255063),
    "MERANGIN-TIANG PUMPUNG-SEKANCING-003": (102.187850, -2.255818),
    "MERANGIN-TIANG PUMPUNG-SEKANCING-004": (102.188539, -2.256166),
    "MERANGIN-TIANG PUMPUNG-SEKANCING-005": (102.189418, -2.256727),
    "MERANGIN-TIANG PUMPUNG-SEKANCING-006": (102.189105, -2.257079),
    "MERANGIN-TIANG PUMPUNG-SEKANCING-007": (102.188745, -2.257435),
    "MERANGIN-TIANG PUMPUNG-SEKANCING-008": (102.189135, -2.258007),
    "MERANGIN-TIANG PUMPUNG-SEKANCING-009": (102.188600, -2.257902),
    "MERANGIN-TIANG PUMPUNG-SEKANCING-010": (102.189298, -2.259457),
    "MERANGIN-TIANG PUMPUNG-SEKANCING-011": (102.187093, -2.257883),
    "MERANGIN-TIANG PUMPUNG-SEKANCING-012": (102.186687, -2.257280),
    "MERANGIN-TIANG PUMPUNG-SEKANCING-013": (102.186595, -2.256975),
    "MERANGIN-TIANG PUMPUNG-SEKANCING-014": (102.186490, -2.256537),
    "MERANGIN-TIANG PUMPUNG-SEKANCING-015": (102.186590, -2.256035),
    "MERANGIN-TIANG PUMPUNG-SEKANCING-016": (102.186560, -2.256217),
    "MERANGIN-TIANG PUMPUNG-SEKANCING-017": (102.186375, -2.254832),
    "MERANGIN-TIANG PUMPUNG-SEKANCING-018": (102.185638, -2.255417),
    "MERANGIN-TIANG PUMPUNG-SEKANCING-019": (102.185288, -2.256433),
    "MERANGIN-TIANG PUMPUNG-SEKANCING-020": (102.185517, -2.256713),
    "MERANGIN-TIANG PUMPUNG-SEKANCING-021": (102.184280, -2.254143),
    "MERANGIN-TIANG PUMPUNG-SEKANCING-022": (102.180588, -2.253273),
    "MERANGIN-TIANG PUMPUNG-SEKANCING-023": (102.180487, -2.252843),
    "MERANGIN-TIANG PUMPUNG-SEKANCING-024": (102.178402, -2.255520),
    "MERANGIN-TIANG PUMPUNG-SEKANCING-025": (102.175510, -2.253490),
    "MERANGIN-TIANG PUMPUNG-SEKANCING-026": (102.184843, -2.254540),
    "MERANGIN-TIANG PUMPUNG-SEKANCING-027": (102.187938, -2.258177),
    "MERANGIN-TIANG PUMPUNG-SEKANCING-028": (102.177820, -2.253356),
    "MERANGIN-TIANG PUMPUNG-SEKANCING-029": (102.185592, -2.256757),
    "MERANGIN-TIANG PUMPUNG-SEKANCING-030": (102.184288, -2.257807),
}

# Nomor -> Tanggal Dokumentasi, transcribed from the photo's date stamp.
PHOTO_DATES = {
    "KERINCI-AIR HANGAT TIMUR-KEMANTAN MUDIK-001": "19/06/2026",
    "KERINCI-AIR HANGAT TIMUR-KEMANTAN MUDIK-002": "19/06/2026",
    "KERINCI-AIR HANGAT TIMUR-KEMANTAN MUDIK-003": "19/06/2026",
    "KERINCI-AIR HANGAT TIMUR-KEMANTAN MUDIK-004": "19/06/2026",
    "KERINCI-AIR HANGAT-HAMPARAN PUGU-001": "13/06/2026",
    "KERINCI-AIR HANGAT-HAMPARAN PUGU-002": "13/06/2026",
    "KERINCI-AIR HANGAT-KOTO DUA LAMA-001": "19/06/2026",
    "KERINCI-AIR HANGAT-KOTO DUA LAMA-002": "13/06/2026",
    "KERINCI-GUNUNG TUJUH-JERNIH JAYA-001": "15/06/2026",
    "KERINCI-GUNUNG TUJUH-JERNIH JAYA-002": "15/06/2026",
    "KERINCI-GUNUNG TUJUH-TELUN BERASAP-001": "15/06/2026",
    "KERINCI-SIULAK MUKAI-KOTO LUAR-001": "19/06/2026",
    "KERINCI-SIULAK MUKAI-KOTO LUAR-002": "19/06/2026",
    "KERINCI-SIULAK MUKAI-TALANG TINGGI-002": "17/06/2026",
    "KERINCI-SIULAK MUKAI-TALANG TINGGI-003": "17/06/2026",
    "KERINCI-SIULAK MUKAI-TALANG TINGGI-004": "17/06/2026",
    "KERINCI-SIULAK MUKAI-TALANG TINGGI-005": "17/06/2026",
    "KERINCI-SIULAK MUKAI-TALANG TINGGI-006": "17/06/2026",
    "KERINCI-SIULAK MUKAI-MUKAI TINGGI-001": "17/06/2026",
    "KERINCI-SIULAK MUKAI-MUKAI TINGGI-002": "17/06/2026",
    "KERINCI-SIULAK MUKAI-MUKAI TINGGI-003": "17/06/2026",
    "KERINCI-SIULAK MUKAI-MUKAI TINGGI-004": "17/06/2026",
    "KERINCI-SIULAK MUKAI-TALANG TINGGI-001": "17/06/2026",
}

REL_PATH = "data/points.geojson"


def main():
    root = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
    path = os.path.join(root, REL_PATH)
    data = json.loads(io.open(path, encoding="utf-8").read())

    by_nomor = {}
    for feature in data["features"]:
        by_nomor[feature["properties"]["Nomor"]] = feature

    unknown = sorted((set(PHOTO_COORDS) | set(PHOTO_DATES)) - set(by_nomor))
    if unknown:
        print("ERROR: Nomor tidak ada di %s:" % REL_PATH)
        for nomor in unknown:
            print("  %s" % nomor)
        return 1

    moved = coords_set = dates_set = 0
    conflicts = []

    for nomor, (lon, lat) in PHOTO_COORDS.items():
        props = by_nomor[nomor]["properties"]
        geom = by_nomor[nomor]["geometry"]
        before = list(geom["coordinates"])
        if abs(before[0] - lon) > 1e-5 or abs(before[1] - lat) > 1e-5:
            print("  pindah  %-52s %s -> %s" % (nomor, before, [lon, lat]))
            moved += 1
        if before != [lon, lat] or props["Longitude"] != lon or props["Latitude"] != lat:
            coords_set += 1
        geom["coordinates"] = [lon, lat]
        props["Longitude"] = lon
        props["Latitude"] = lat

    for nomor, tanggal in PHOTO_DATES.items():
        props = by_nomor[nomor]["properties"]
        current = props.get("Tanggal Dokumentasi")
        if current and current != tanggal:
            conflicts.append((nomor, current, tanggal))
        elif not current:
            props["Tanggal Dokumentasi"] = tanggal
            dates_set += 1

    if conflicts:
        print("\nERROR: tanggal di tabel bertentangan dengan stempel foto:")
        for nomor, current, tanggal in conflicts:
            print("  %-52s tabel=%s foto=%s" % (nomor, current, tanggal))
        print("Selesaikan dulu; tidak ada yang ditulis.")
        return 1

    out = json.dumps(data, separators=(",", ":"), ensure_ascii=False)
    io.open(path, "w", encoding="utf-8", newline="\n").write(out)

    print("\n%-34s %d titik" % ("koordinat diselaraskan:", coords_set))
    print("%-34s %d titik" % ("  di antaranya bergeser >1 m:", moved))
    print("%-34s %d record" % ("Tanggal Dokumentasi diisi:", dates_set))
    return 0


if __name__ == "__main__":
    sys.exit(main())
