#!/usr/bin/env python3
"""Rebuild docs/titik-berdekatan.csv from data/points.geojson.

The file lists every pair of points that are closer than 50 m to each other
but not on the exact same coordinate. Identical coordinates (GPS that never
refreshed) are tracked in docs/titik-tumpuk.csv and by the `Duplikat` flag,
not here.

Rules, reverse-engineered from the 27 Agustus 2026 snapshot (afc1930) and
kept so a rebuild matches it:

* Distance: haversine, R = 6 371 000 m, rounded to 0.1 m for "Jarak (m)".
  "Pita" is decided on the unrounded distance (<5, 5-10, 10-20, 20-30,
  30-50 m), so 10.07 m prints as 10.0 in the 10-20 m band.
* Point A is the one with the lower fid; Pengusul is A's Nama Anggota; the
  Foto columns are the basename of each "Foto Survey Awal".
* Foto Identik: "ya" when both photo files have the same bytes.
* Status Koordinat: "salah satu menunggu ukur ulang" when either point is
  listed in titik-tumpuk.csv with Tindakan "Ukur ulang" AND still sits on the
  coordinate recorded there (re-surveyed points no longer wait), otherwise
  "kedua koordinat sah".
* Rows are sorted by unrounded distance, then fid A, fid B, and numbered 1..n.

New since the snapshot: points with Status "Belum Ditetapkan" are skipped --
their coordinates are placeholders, not survey fixes. Cadangan points stay in.

Keputusan and Catatan Petugas are carried over for pairs that are still
listed, so officers' notes survive a rebuild.

    python3 scripts/build_titik_berdekatan.py --dry-run
    python3 scripts/build_titik_berdekatan.py
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import math
import re
from pathlib import Path

MAX_M = 50.0
HEADER = [
    "No", "Jarak (m)", "Pita", "Nomor A", "Nomor B", "Kabupaten", "Kecamatan",
    "Desa/Kelurahan", "Lon A", "Lat A", "Lon B", "Lat B", "Tanggal A", "Tanggal B",
    "Pengusul", "Foto A", "Foto B", "Foto Identik", "Status Koordinat", "Keputusan",
    "Catatan Petugas",
]
SAH = "kedua koordinat sah"
UKUR_ULANG = "salah satu menunggu ukur ulang"


def haversine_m(lat1, lon1, lat2, lon2) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * 6371000 * math.asin(math.sqrt(h))


def pita(d: float) -> str:
    if d < 5:
        return "<5 m"
    if d < 10:
        return "5-10 m"
    if d < 20:
        return "10-20 m"
    if d < 30:
        return "20-30 m"
    return "30-50 m"


def photo_digest(images_dir: Path, value: str) -> str | None:
    path = images_dir / re.sub(r"[\\/:]", "_", value.strip())
    return hashlib.md5(path.read_bytes()).hexdigest() if path.is_file() else None


def read_csv(path: Path) -> list[dict[str, str]]:
    with path.open(encoding="utf-8-sig", newline="") as fh:
        return list(csv.DictReader(fh, delimiter=";"))


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo", type=Path, default=Path(__file__).resolve().parent.parent)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    out_path = args.repo / "docs" / "titik-berdekatan.csv"
    images_dir = args.repo / "images"
    data = json.loads((args.repo / "data" / "points.geojson").read_text(encoding="utf-8"))
    points = [
        f["properties"] for f in data["features"]
        if f["properties"].get("Status") != "Belum Ditetapkan"
    ]
    points.sort(key=lambda p: int(p["fid"]))

    waiting = {
        t["Nomor"]: (float(t["Latitude Sekarang"]), float(t["Longitude Sekarang"]))
        for t in read_csv(args.repo / "docs" / "titik-tumpuk.csv")
        if t["Tindakan"] == "Ukur ulang"
    }

    def needs_remeasure(p) -> bool:
        fix = waiting.get(p["Nomor"])
        return fix is not None and fix == (p["Latitude"], p["Longitude"])

    old_rows = read_csv(out_path)
    notes = {(r["Nomor A"], r["Nomor B"]): (r["Keputusan"], r["Catatan Petugas"]) for r in old_rows}

    digests: dict[str, str | None] = {}

    def digest(p):
        if p["Nomor"] not in digests:
            digests[p["Nomor"]] = photo_digest(images_dir, p["Foto Survey Awal"])
        return digests[p["Nomor"]]

    pairs = []
    for i, a in enumerate(points):
        for b in points[i + 1:]:
            if abs(a["Latitude"] - b["Latitude"]) > 0.001:
                continue
            d = haversine_m(a["Latitude"], a["Longitude"], b["Latitude"], b["Longitude"])
            if 0 < d <= MAX_M:
                pairs.append((d, a, b))
    pairs.sort(key=lambda t: (t[0], int(t[1]["fid"]), int(t[2]["fid"])))

    rows = []
    for no, (d, a, b) in enumerate(pairs, 1):
        kab, kec, desa = a["Nomor"].split("-")[:3]
        da, db = digest(a), digest(b)
        keputusan, catatan = notes.get((a["Nomor"], b["Nomor"]), ("", ""))
        rows.append([
            str(no), f"{d:.1f}", pita(d), a["Nomor"], b["Nomor"], kab, kec, desa,
            str(a["Longitude"]), str(a["Latitude"]), str(b["Longitude"]), str(b["Latitude"]),
            a["Tanggal Dokumentasi"], b["Tanggal Dokumentasi"], a["Nama Anggota"],
            a["Foto Survey Awal"].split("/")[-1], b["Foto Survey Awal"].split("/")[-1],
            "ya" if da is not None and da == db else "tidak",
            UKUR_ULANG if needs_remeasure(a) or needs_remeasure(b) else SAH,
            keputusan, catatan,
        ])

    old_keys = {(r["Nomor A"], r["Nomor B"]) for r in old_rows}
    new_keys = {(r[3], r[4]) for r in rows}
    print(f"pairs: {len(old_rows)} -> {len(rows)}  "
          f"(+{len(new_keys - old_keys)} new, -{len(old_keys - new_keys)} dropped)")
    lost_notes = [k for k in old_keys - new_keys if any(notes[k])]
    if lost_notes:
        print("WARNING: dropped pairs carried notes:", lost_notes)

    if args.dry_run:
        print("dry-run: nothing written")
        return 0
    buf = io.StringIO()
    writer = csv.writer(buf, delimiter=";", lineterminator="\n")
    writer.writerow(HEADER)
    writer.writerows(rows)
    out_path.write_text(buf.getvalue(), encoding="utf-8-sig", newline="")
    print("written", out_path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
