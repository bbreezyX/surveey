#!/usr/bin/env python3
"""Re-site three RT 04 Tanjung Raden points from the 6 Oktober 2026 survey.

Source: "LembarFoto_2026-09-30_to_2026-10-06.xlsx", a Timemark export whose
"Foto" sheet holds the shots "RT 04 Tanjung Raden Kec Danau Teluk 01".."10".

The survey numbers do not follow the atlas numbers, so the points were paired
by proximity instead. TANJUNG RADEN-001..006 and -010 each sit 4-35 m from a
6 Oktober shot (GPS noise, left alone). -007, -008 and -009 -- the 26/05
points south and east of the cluster -- are 165-214 m from every shot, while
shots 08, 09 and 10 on Jl. K.H. Thoyib (north side) have no atlas point. The
user chose to move 007 -> shot 08, 008 -> shot 09, 009 -> shot 10.

TANJUNG RADEN-002's 13 Mei photo is a pose shot beside the pole ("Pesantren
Sebrang"); shot 04 is the same pole, banana tree and green-railed house with
the crew marking its base, 4 m away. The user chose to swap 002 to shot 04.
Likewise 003's 13 Mei photo is a pose in open grass with no landmark; it
takes shot 07 (crew marking beside the blue-tarp shed), 17 m away.

Entries already applied (same coordinate and photo) are skipped, so the
script can be re-run after a new entry is added.

Coordinates are the 6-decimal values off each photo's burned-in stamp (they
match the sheet's Google Maps hyperlinks). Old photos stay in images/.

    python3 scripts/apply_survey_6_oktober.py --dry-run
    python3 scripts/apply_survey_6_oktober.py
"""

from __future__ import annotations

import argparse
import json
import math
from copy import deepcopy
from pathlib import Path

import openpyxl

TANGGAL = "06/10/2026"
FILE_DATE = "2026-10-06"
TR = "KOTA JAMBI-DANAU TELUK-TANJUNG RADEN-"

# "Foto" sheet row -> (Nomor, latitude, longitude) read off the photo stamp.
UPDATES = {
    8: (TR + "002", -1.585429, 103.586436),  # shot 04
    5: (TR + "003", -1.584465, 103.586506),  # shot 07
    4: (TR + "007", -1.584248, 103.586442),  # shot 08
    3: (TR + "008", -1.584118, 103.585904),  # shot 09
    2: (TR + "009", -1.583805, 103.585995),  # shot 10
}
EXPECTED_LABEL = {8: "04", 5: "07", 4: "08", 3: "09", 2: "10"}
MAX_MOVE_M = 400


def photo_name(nomor: str) -> str:
    desa, nnn = nomor.split("-")[-2:]
    return f"{desa.title().replace(' ', '-')}-{nnn}-{FILE_DATE}.jpeg"


def distance_m(lat1, lon1, lat2, lon2) -> float:
    dy = (lat1 - lat2) * 111320
    dx = (lon1 - lon2) * 111320 * math.cos(math.radians(lat1))
    return math.hypot(dx, dy)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--xlsx",
        type=Path,
        default=Path.home() / "Downloads" / "LembarFoto_2026-09-30_to_2026-10-06.xlsx",
    )
    parser.add_argument("--repo", type=Path, default=Path(__file__).resolve().parent.parent)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    points_path = args.repo / "data" / "points.geojson"
    images_dir = args.repo / "images"

    ws = openpyxl.load_workbook(args.xlsx)["Foto"]
    photos = {im.anchor._from.row + 1: im._data() for im in ws._images}
    for row, label in EXPECTED_LABEL.items():
        name = str(ws.cell(row, 5).value or "").strip()
        if name != f"RT 04 Tanjung Raden Kec Danau Teluk {label}":
            raise SystemExit(f"Row {row}: unexpected Nama {name!r}")
        if row not in photos:
            raise SystemExit(f"Row {row}: no photo")

    data = json.loads(points_path.read_text(encoding="utf-8"))
    by_nomor = {f["properties"]["Nomor"]: f for f in data["features"]}
    targets = {u[0] for u in UPDATES.values()}
    untouched_before = {n: deepcopy(f) for n, f in by_nomor.items() if n not in targets}

    writes: list[tuple[Path, bytes]] = []
    for row, (nomor, lat, lon) in sorted(UPDATES.items(), key=lambda kv: kv[1][0]):
        f = by_nomor.get(nomor)
        if f is None:
            raise SystemExit(f"Row {row}: unknown Nomor {nomor}")
        p = f["properties"]
        moved = distance_m(lat, lon, p["Latitude"], p["Longitude"])
        if moved > MAX_MOVE_M:
            raise SystemExit(f"Row {row}: {nomor} would move {moved:.0f} m")
        name = photo_name(nomor)
        dst = images_dir / name
        if (p["Latitude"], p["Longitude"], p["Foto Survey Awal"]) == (lat, lon, name) and dst.is_file():
            print(f"  shot {EXPECTED_LABEL[row]}  {nomor:<42} already applied")
            continue
        if dst.exists():
            raise SystemExit(f"Photo already present: {name}")
        print(
            f"  shot {EXPECTED_LABEL[row]}  {nomor:<42} {p['Latitude']:>10},{p['Longitude']:<11} -> "
            f"{lat},{lon}  {moved:5.0f} m  {name}"
        )
        p["Latitude"] = lat
        p["Longitude"] = lon
        f["geometry"]["coordinates"] = [lon, lat]
        p["Tanggal Dokumentasi"] = TANGGAL
        p["Foto Survey Awal"] = name
        writes.append((dst, photos[row]))

    if args.dry_run:
        print("\ndry-run: nothing written")
        return 0

    for dst, body in writes:
        dst.write_bytes(body)
    points_path.write_text(
        json.dumps(data, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )

    written = json.loads(points_path.read_text(encoding="utf-8"))
    after = {f["properties"]["Nomor"]: f for f in written["features"]}
    if any(after[n] != f for n, f in untouched_before.items()):
        raise SystemExit("A point outside this batch changed")
    for nomor in targets:
        if not (images_dir / after[nomor]["properties"]["Foto Survey Awal"]).is_file():
            raise SystemExit(f"Missing photo for {nomor}")
    print("written")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
