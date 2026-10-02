#!/usr/bin/env python3
"""Apply the 1 Oktober 2026 Kota Jambi re-survey to existing points.

Source: "KOTA JAMBI 1 OKT 2026 KASANG KASANG JAYA_SEJENJANG_edit.xlsx", a
Timemark "Laporan Foto Kerja" export. Its "Foto" sheet holds all 60 raw shots
(15 locations); the "FINAL" sheet holds the 17 rows the survey team picked,
one photo each. Only FINAL is used here -- that is the team's own selection.

This batch adds nothing. Every FINAL row re-visits a point already in the atlas,
so it rewrites coordinates, photo and Tanggal Dokumentasi in place. The
coordinates are the 6-decimal values read off each photo's burned-in stamp;
the sheet's "Koordinat" cells are the same values truncated to 5 decimals and
agree with the stamps in all 17 rows.

Judgment calls:

* Only active points are touched. Three FINAL rows land on Cadangan points
  (RT 05 Kasang Jaya -> KASANG JAYA-003, RT 15 Kasang Jaya -> KASANG JAYA-002,
  RT 10 Tanjung Pinang -> TANJUNG PINANG-001). They are skipped, so the counted
  total stays at 500.

* RT 13 Tanjung Pinang's stamp has no name. It sits 6-13 m from Cadangan
  points 004/005/006 and 33 m from TANJUNG PINANG-007, the only active RT 13
  point, so it goes to 007.

* Four rows are relocations, not GPS noise (the scene in the photo changed
  too): KASANG-004 124 m, KASANG JAYA-007 101 m, TANJUNG PINANG-002 65 m,
  TANJUNG PINANG-007 33 m. The newest field visit wins.

* KASANG JAYA-007 (RT 01) was flagged Duplikat because it shared 005's
  (RT 02) coordinate; its old photo is even stamped "rt. 02 kasang jaya 01".
  It now has its own stamp 101 m away, so the flag and its Catatan go.

* The FINAL row "RT 18 Kenali Asam Bawah Kec. Kota Baru" (row 17) is
  mislabelled: the user confirmed it is RT 29 Simpang III Sipin. Its stamp
  reads Simpang III Sipin with an empty Nama, 2 m from SIMPANG III SIPIN-001
  (RT 029), so it updates that point. KENALI ASAM BAWAH-001 (RT 018, 4.4 km
  away) is NOT touched -- an earlier pass moved it on the label and was
  reverted.

* Row 3 (RT 03 Kasang yi 02) is the only PNG and the only photo missing from
  the "Foto" sheet; its Waktu cell (12:29:02) is copied from row 2 -- the
  stamp says 12:33. It is re-encoded to JPEG like the rest. Its anchor sits in
  row 2 with a row offset, which is why row 2 carries two images.

Old photos are left in images/, as earlier re-sitings did.

    python scripts/apply_survey_1_oktober.py --dry-run
    python scripts/apply_survey_1_oktober.py
"""

from __future__ import annotations

import argparse
import io
import json
import math
import re
from copy import deepcopy
from pathlib import Path

import openpyxl
from PIL import Image

TANGGAL = "01/10/2026"
FILE_DATE = "2026-10-01"
JT = "KOTA JAMBI-JAMBI TIMUR-"
KB = "KOTA JAMBI-KOTA BARU-"

# FINAL sheet row -> (Nomor, latitude, longitude) read off the photo stamp.
UPDATES = {
    2: (JT + "KASANG-001", -1.586442, 103.620331),
    3: (JT + "KASANG-002", -1.586241, 103.620316),
    4: (JT + "KASANG-003", -1.585915, 103.621319),
    5: (JT + "KASANG-004", -1.588137, 103.625192),
    6: (JT + "SIJENJANG-001", -1.579976, 103.637972),
    7: (JT + "KASANG JAYA-001", -1.586871, 103.629902),
    10: (JT + "KASANG JAYA-007", -1.588395, 103.631451),
    11: (JT + "KASANG JAYA-005", -1.587938, 103.630755),
    13: (JT + "TANJUNG PINANG-002", -1.591832, 103.630612),
    14: (JT + "TANJUNG PINANG-007", -1.590592, 103.630720),
    15: (JT + "SUNGAI ASAM-002", -1.597254, 103.619227),
    16: (JT + "SUNGAI ASAM-001", -1.595466, 103.618498),
    # Labelled "RT 18 Kenali Asam Bawah" in FINAL; it is RT 29 (see docstring).
    17: (KB + "SIMPANG III SIPIN-001", -1.633304, 103.586942),
    18: (KB + "KENALI BESAR-003", -1.618051, 103.554602),
}
# FINAL rows deliberately skipped: they land on Cadangan points.
SKIPPED_CADANGAN = {
    8: JT + "KASANG JAYA-003",
    9: JT + "KASANG JAYA-002",
    12: JT + "TANJUNG PINANG-001",
}
CLEAR_DUPLIKAT = {JT + "KASANG JAYA-007"}
EXPECTED_COUNTED = 500
# Sanity bound on how far a FINAL row may move its point.
MAX_MOVE_M = 130


def sanitize_media_path(value: str) -> str:
    return re.sub(r"[\\/:]", "_", str(value or "")).strip()


def photo_name(nomor: str) -> str:
    # KOTA JAMBI-JAMBI TIMUR-KASANG JAYA-007 -> Kasang-Jaya-007-2026-10-01.jpeg,
    # the naming the September re-surveys already use.
    desa, nnn = nomor.split("-")[-2:]
    return f"{desa.title().replace(' ', '-').replace('Iii', 'III')}-{nnn}-{FILE_DATE}.jpeg"


def distance_m(lat1, lon1, lat2, lon2) -> float:
    dy = (lat1 - lat2) * 111320
    dx = (lon1 - lon2) * 111320 * math.cos(math.radians(lat1))
    return math.hypot(dx, dy)


def final_photos(xlsx: Path) -> dict[int, bytes]:
    ws = openpyxl.load_workbook(xlsx)["FINAL"]
    photos: dict[int, bytes] = {}
    for im in ws._images:
        start = im.anchor._from
        row = start.row + 1 + (1 if start.rowOff else 0)
        if row in photos:
            raise SystemExit(f"Two photos resolve to FINAL row {row}")
        photos[row] = im._data()
    if sorted(photos) != list(range(2, 19)):
        raise SystemExit(f"Unexpected FINAL photo rows: {sorted(photos)}")
    return photos


def as_jpeg(data: bytes) -> bytes:
    img = Image.open(io.BytesIO(data))
    if img.format == "JPEG":
        return data
    out = io.BytesIO()
    img.convert("RGB").save(out, "JPEG", quality=90)
    return out.getvalue()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--xlsx",
        type=Path,
        default=Path(
            r"C:\Users\distributorkomputer\Downloads\KOTA JAMBI 1 OKT 2026 KASANG KASANG JAYA_SEJENJANG_edit.xlsx"
        ),
    )
    parser.add_argument("--repo", type=Path, default=Path(__file__).resolve().parent.parent)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    points_path = args.repo / "data" / "points.geojson"
    images_dir = args.repo / "images"
    photos = final_photos(args.xlsx)

    data = json.loads(points_path.read_text(encoding="utf-8"))
    by_nomor = {f["properties"]["Nomor"]: f for f in data["features"]}
    untouched_before = {
        n: deepcopy(f) for n, f in by_nomor.items() if n not in {u[0] for u in UPDATES.values()}
    }

    for row, nomor in SKIPPED_CADANGAN.items():
        if by_nomor[nomor]["properties"].get("Status") != "Cadangan":
            raise SystemExit(f"Row {row}: {nomor} is no longer Cadangan; revisit the skip")

    writes: list[tuple[Path, bytes]] = []
    for row, (nomor, lat, lon) in sorted(UPDATES.items()):
        f = by_nomor.get(nomor)
        if f is None:
            raise SystemExit(f"Row {row}: unknown Nomor {nomor}")
        p = f["properties"]
        if p.get("Status") == "Cadangan":
            raise SystemExit(f"Row {row}: {nomor} is Cadangan")
        moved = distance_m(lat, lon, p["Latitude"], p["Longitude"])
        if moved > MAX_MOVE_M:
            raise SystemExit(f"Row {row}: {nomor} would move {moved:.0f} m")
        name = photo_name(nomor)
        dst = images_dir / name
        if dst.exists():
            raise SystemExit(f"Photo already present: {name}")
        print(
            f"  r{row:<2} {nomor:<44} {p['Latitude']:>10},{p['Longitude']:<11} -> "
            f"{lat},{lon}  {moved:6.0f} m  {name}"
        )

        p["Latitude"] = lat
        p["Longitude"] = lon
        f["geometry"]["coordinates"] = [lon, lat]
        p["Tanggal Dokumentasi"] = TANGGAL
        p["Foto Survey Awal"] = name
        if nomor in CLEAR_DUPLIKAT:
            p.pop("Duplikat", None)
            p.pop("Catatan", None)
        writes.append((dst, as_jpeg(photos[row])))

    counted = sum(1 for f in data["features"] if f["properties"].get("Status") != "Cadangan")
    if counted != EXPECTED_COUNTED:
        raise SystemExit(f"Counted total {counted}, expected {EXPECTED_COUNTED}")
    print(f"updated: {len(UPDATES)}  skipped cadangan: {len(SKIPPED_CADANGAN)}  counted: {counted}")

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
    if len(after) != len(written["features"]):
        raise SystemExit("Duplicate Nomor after write")
    if any(after[n] != f for n, f in untouched_before.items()):
        raise SystemExit("A point outside this batch changed")
    # Only this batch: six older points already lack a photo (see KNOWN_MISSING
    # in append_update_27_agustus.py and friends).
    for nomor, _, _ in UPDATES.values():
        if not (images_dir / after[nomor]["properties"]["Foto Survey Awal"]).is_file():
            raise SystemExit(f"Missing photo for {nomor}")
    print("written")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
