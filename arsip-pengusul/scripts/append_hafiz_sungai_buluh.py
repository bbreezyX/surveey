#!/usr/bin/env python3
"""Append M. Hafiz's 14 Agustus 2026 Sungai Buluh survey into points.geojson.

Source: four GPS Map Camera photos received over WhatsApp on 5 September 2026
(folder "WhatsApp Unknown 2026-09-05 at 21.54.43"). Each photo carries the
stamp burned in: "Jalan Lintas Sungai Buluh, Muara Bulian, Kabupaten
Batanghari, Jambi 36361", the Lat/Long, and the time on Jumat 14/08/2026.
There is no spreadsheet for this batch; the coordinates below were read from
the stamps (cropped and enlarged to check every digit) and are typed in here
so the pin never disagrees with the picture.

Rekapan A.1 (M. HAFIZ, jalur Ketua DPRD) lists RT 19 Sei. Bulu 4 - the four
Muara Bulian rows the 30 Juli survey did not visit. Desa Sungai Buluh had no
points yet, so these start SUNGAI BULUH-001..004, numbered in the order the
surveyor shot them (16:52, 16:53, 16:54, 17:02).

The WhatsApp photos are 720x1280 with the GPS Map Camera caption overlaid on
the picture itself (not a separate strip), so they are copied as-is.
"""

from __future__ import annotations

import argparse
import json
import re
import shutil
import sys
from copy import deepcopy
from pathlib import Path

FOTO_PREFIX = "D:/011. ESDM/Penerangan Jalan Umum Tenaga Surya 2026/2026/03. Foto"
TANGGAL = "14/08/2026"
NAMA = "M. Hafiz"
JALUR = "Ketua DPRD"
KAB = "Batang Hari"
KEC = "Muara Bulian"
DESA_LABEL = "Desa Sungai Buluh"
DESA_CODE = "SUNGAI BULUH"
KETERANGAN = "RT 19 Sungai Buluh"

# (sequence, source photo filename, waktu, lat, lon) - waktu/lat/lon as stamped.
PHOTOS: list[tuple[int, str, str, float, float]] = [
    (1, "WhatsApp Image 2026-09-05 at 21.54.37.jpeg", "16:52", -1.711169, 103.308481),
    (2, "WhatsApp Image 2026-09-05 at 21.54.37 (1).jpeg", "16:53", -1.711628, 103.311435),
    (3, "WhatsApp Image 2026-09-05 at 21.54.37 (2).jpeg", "16:54", -1.711284, 103.312623),
    (4, "WhatsApp Image 2026-09-05 at 21.54.36.jpeg", "17:02", -1.708921, 103.313859),
]


def sanitize_media_path(value: str) -> str:
    return re.sub(r"[\\/:]", "_", str(value or "")).strip()


def build_features(source_dir: Path, first_fid: int) -> list[dict]:
    features: list[dict] = []
    for seq, filename, waktu, lat, lon in PHOTOS:
        src = source_dir / filename
        if not src.is_file():
            raise SystemExit(f"Missing source photo: {src}")
        nomor = f"{KAB.upper()}-{KEC.upper()}-{DESA_CODE}-{seq:03d}"
        features.append(
            {
                "type": "Feature",
                "properties": {
                    "fid": str(first_fid + len(features)),
                    "Nomor": nomor,
                    "Nama Anggota": NAMA,
                    "Jalur": JALUR,
                    "Alamat": f"{DESA_LABEL}, Kecamatan {KEC}, Kabupaten {KAB}",
                    "Longitude": lon,
                    "Latitude": lat,
                    "Tanggal Dokumentasi": TANGGAL,
                    "Keterangan": KETERANGAN,
                    "Foto Survey Awal": f"{FOTO_PREFIX}/{nomor}.jpg",
                },
                "geometry": {"type": "Point", "coordinates": [lon, lat]},
                "_src": src,
                "_waktu": waktu,
            }
        )
    return features


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--photos",
        type=Path,
        default=Path("/Users/dany/Downloads/WhatsApp Unknown 2026-09-05 at 21.54.43"),
    )
    parser.add_argument("--repo", type=Path, default=Path(__file__).resolve().parent.parent)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    points_path = args.repo / "data" / "points.geojson"
    images_dir = args.repo / "images"
    for path in (args.photos, points_path, images_dir):
        if not path.exists():
            raise SystemExit(f"Missing input: {path}")

    existing = json.loads(points_path.read_text(encoding="utf-8"))
    old_features = existing["features"]
    old_snapshot = deepcopy(old_features)
    old_nomors = {f["properties"]["Nomor"] for f in old_features}
    max_fid = max(int(f["properties"]["fid"]) for f in old_features)

    features = build_features(args.photos, max_fid + 1)

    for f in features:
        nomor = f["properties"]["Nomor"]
        if nomor in old_nomors:
            raise SystemExit(f"Nomor already in atlas: {nomor}")
        dst = images_dir / sanitize_media_path(f["properties"]["Foto Survey Awal"])
        if dst.exists():
            raise SystemExit(f"Photo already present: {dst.name}")

    print(f"existing: {len(old_features)}  append: {len(features)}  total: {len(old_features) + len(features)}")
    for f in features:
        p = f["properties"]
        print(
            f"  {p['Nomor']:<46} {p['Latitude']:>10} {p['Longitude']:>11}  "
            f"{f['_waktu']}  {f['_src'].name}"
        )

    if args.dry_run:
        print("\ndry-run: nothing written")
        return 0

    for f in features:
        dst = images_dir / sanitize_media_path(f["properties"]["Foto Survey Awal"])
        shutil.copy2(f.pop("_src"), dst)
        f.pop("_waktu")

    merged = dict(existing)
    merged["features"] = old_features + features
    points_path.write_text(
        json.dumps(merged, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )

    written = json.loads(points_path.read_text(encoding="utf-8"))
    if written["features"][: len(old_snapshot)] != old_snapshot:
        raise SystemExit("Old features changed after write")
    if len(written["features"]) != len(old_features) + len(features):
        raise SystemExit("Feature count mismatch after write")
    nomors = [f["properties"]["Nomor"] for f in written["features"]]
    if len(set(nomors)) != len(nomors):
        raise SystemExit("Duplicate Nomor after write")
    for f in features:
        if not (images_dir / sanitize_media_path(f["properties"]["Foto Survey Awal"])).is_file():
            raise SystemExit(f"Photo not written for {f['properties']['Nomor']}")

    print(f"\nOK  photos written: {len(features)}  total features: {len(written['features'])}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
