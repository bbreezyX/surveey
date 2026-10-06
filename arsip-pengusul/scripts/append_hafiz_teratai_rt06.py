#!/usr/bin/env python3
"""Append M. Hafiz's 6 September 2026 RT 06 Teratai survey into points.geojson.

Source: two Timemark photos sent over WhatsApp on 6 September 2026. The
overlay on each picture only prints Kabupaten Batanghari; the share pages
carry the GPS that is the source of record:

* https://h5.timemark.com/s/LHBRLKDHBAKLUY/8  10:30  -1.6907734, 103.2754043
* https://h5.timemark.com/s/2RD6LLWLGHTKGP/8  10:34  -1.6903731, 103.2749294

Nominatim reverse-geocodes both pins to Kel. Teratai, Muara Bulian. They sit
~300 m south of Mayang Mangurai (TERATAI-004..006) and ~70 m from each other.

Rekapan A.1 (M. HAFIZ, jalur Ketua DPRD) still had RT 06 RW 02 Kel. Teratai
2 units unvisited after the 30 Juli Muara Bulian survey and the later Sungai
Buluh batch. Those are the two counted SK points short of 500. TERATAI already
runs 001-006 (RT 15 + Mayang Mangurai; 003 is Cadangan), so these continue as
007 and 008 in visit order.

The WhatsApp files are the Timemark picture with the stamp already burned in,
so they are copied as-is.
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
TANGGAL = "06/09/2026"
NAMA = "M. Hafiz"
JALUR = "Ketua DPRD"
KAB = "Batang Hari"
KEC = "Muara Bulian"
DESA_LABEL = "Kel. Teratai"
DESA_CODE = "TERATAI"
KETERANGAN = "RT 06 Teratai"

# (sequence, source photo filename, waktu, lat, lon, photo code)
PHOTOS: list[tuple[int, str, str, float, float, str]] = [
    (
        7,
        "c__Users_distributorkomputer_AppData_Roaming_Cursor_User_workspaceStorage_296c9e99231d6ed3841940c8de82d5f5_images_WhatsApp_Image_2026-09-06_at_10.43.14-d6bea7a3-d48d-44f7-ad1a-20adda0c2c61.jpg",
        "10:30",
        -1.6907734,
        103.2754043,
        "LHBRLKDHBAKLUY",
    ),
    (
        8,
        "c__Users_distributorkomputer_AppData_Roaming_Cursor_User_workspaceStorage_296c9e99231d6ed3841940c8de82d5f5_images_WhatsApp_Image_2026-09-06_at_10.43.15-dca67687-2a6f-46b3-b416-bef2ed819506.jpg",
        "10:34",
        -1.6903731,
        103.2749294,
        "2RD6LLWLGHTKGP",
    ),
]


def sanitize_media_path(value: str) -> str:
    return re.sub(r"[\\/:]", "_", str(value or "")).strip()


def build_features(source_dir: Path, first_fid: int) -> list[dict]:
    features: list[dict] = []
    for seq, filename, waktu, lat, lon, _code in PHOTOS:
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
        default=Path(
            r"C:\Users\distributorkomputer\.cursor\projects\c-Users-distributorkomputer-Documents-web-dev-PJUTS-2026\assets"
        ),
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

    counted = sum(
        1
        for f in old_features
        if str(f["properties"].get("Status") or "").strip().lower() != "cadangan"
    )
    print(
        f"existing: {len(old_features)}  counted: {counted}  "
        f"append: {len(features)}  total: {len(old_features) + len(features)}"
    )
    for f in features:
        p = f["properties"]
        print(
            f"  {p['Nomor']:<46} {p['Latitude']:>11} {p['Longitude']:>12}  "
            f"{f['_waktu']}  {f['_src'].name[-40:]}"
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

    counted_after = sum(
        1
        for f in written["features"]
        if str(f["properties"].get("Status") or "").strip().lower() != "cadangan"
    )
    print(
        f"\nOK  photos written: {len(features)}  "
        f"total features: {len(written['features'])}  counted: {counted_after}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
