#!/usr/bin/env python3
"""Place Arwiyanto's two Siulak Gedang units from the 11 Juni 2026 Timemark photos.

Source: three Timemark photos sent over WhatsApp on 7 September 2026. They
are from the original 11 Juni Kerinci survey (same day as the rest of the
Siulak rows) but only surfaced now; until then SIULAK GEDANG-001..002 sat
as "Belum Ditetapkan" placeholders at a guessed spot in the desa.

Overlay text (OCR from the burned-in stamp):

* gedang1  11:00  Jl. Siulak Kecil, RT.04, Siulak Gedang  1.970596 S, 101.354242 E
* gedang2  11:04  Jl. Siulak Kecil, RT.04, Siulak Gedang  1.969492 S, 101.354186 E
* gedang3  11:07  Siulak Gedang                           1.969194 S, 101.354392 E

Siulak Gedang's allocation is 2 units. Photos 1 and 2 take the two counted
rows in visit order (the placeholder coordinates, Status and Catatan go);
photo 3 is the extra pin the crew recorded and joins as 003 Cadangan, the
same way KOTO ARO and SIULAK DERAS MUDIK carry their spare pins.

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
TANGGAL = "11/06/2026"
NAMA = "Arwiyanto, S.E."
JALUR = "Komisi III"
ALAMAT = "Desa Siulak Gedang, Kecamatan Siulak, Kabupaten Kerinci"
NOMOR_PREFIX = "KERINCI-SIULAK-SIULAK GEDANG"

# (sequence, source photo filename, waktu, lat, lon, keterangan, cadangan)
PHOTOS: list[tuple[int, str, str, float, float, str | None, bool]] = [
    (1, "WhatsApp Image 2026-09-07 at 10.03.43 (2).jpeg", "11:00", -1.970596, 101.354242, "Jl. Siulak Kecil RT 04", False),
    (2, "WhatsApp Image 2026-09-07 at 10.03.43 (1).jpeg", "11:04", -1.969492, 101.354186, "Jl. Siulak Kecil RT 04", False),
    (3, "WhatsApp Image 2026-09-07 at 10.03.43.jpeg", "11:07", -1.969194, 101.354392, None, True),
]


def sanitize_media_path(value: str) -> str:
    return re.sub(r"[\\/:]", "_", str(value or "")).strip()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--photos",
        type=Path,
        default=Path.home() / "Downloads" / "WhatsApp Unknown 2026-09-07 at 10.07.20",
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
    features = existing["features"]
    snapshot = deepcopy(features)
    by_nomor = {f["properties"]["Nomor"]: f for f in features}
    max_fid = max(int(f["properties"]["fid"]) for f in features)

    plan: list[tuple[dict, Path, str, bool]] = []
    for seq, filename, waktu, lat, lon, keterangan, cadangan in PHOTOS:
        src = args.photos / filename
        if not src.is_file():
            raise SystemExit(f"Missing source photo: {src}")
        nomor = f"{NOMOR_PREFIX}-{seq:03d}"
        foto = f"{FOTO_PREFIX}/{nomor}.jpg"
        dst = images_dir / sanitize_media_path(foto)
        if dst.exists():
            raise SystemExit(f"Photo already present: {dst.name}")

        target = by_nomor.get(nomor)
        if cadangan:
            if target is not None:
                raise SystemExit(f"Nomor already in atlas: {nomor}")
            max_fid += 1
            target = {
                "type": "Feature",
                "properties": {
                    "fid": str(max_fid),
                    "Nomor": nomor,
                    "Nama Anggota": NAMA,
                    "Jalur": JALUR,
                    "Alamat": ALAMAT,
                    "Longitude": lon,
                    "Latitude": lat,
                    "Tanggal Dokumentasi": TANGGAL,
                    "Keterangan": keterangan,
                    "Foto Survey Awal": foto,
                    "Status": "Cadangan",
                },
                "geometry": {"type": "Point", "coordinates": [lon, lat]},
            }
            features.append(target)
            plan.append((target, src, waktu, True))
            continue

        if target is None:
            raise SystemExit(f"Placeholder row missing: {nomor}")
        p = target["properties"]
        if str(p.get("Status") or "").strip().lower() != "belum ditetapkan":
            raise SystemExit(f"{nomor} is not Belum Ditetapkan (Status={p.get('Status')!r})")
        if p.get("Nama Anggota") != NAMA:
            raise SystemExit(f"{nomor} belongs to {p.get('Nama Anggota')!r}")
        p["Longitude"] = lon
        p["Latitude"] = lat
        p["Tanggal Dokumentasi"] = TANGGAL
        p["Keterangan"] = keterangan
        p["Foto Survey Awal"] = foto
        p.pop("Status", None)
        p.pop("Catatan", None)
        target["geometry"] = {"type": "Point", "coordinates": [lon, lat]}
        plan.append((target, src, waktu, False))

    for target, src, waktu, added in plan:
        p = target["properties"]
        print(
            f"  {'ADD' if added else 'SET'} {p['Nomor']:<34} {p['Latitude']:>10} {p['Longitude']:>11}  "
            f"{waktu}  {p.get('Status') or 'SK':<8} {src.name}"
        )

    if args.dry_run:
        print("\ndry-run: nothing written")
        return 0

    for target, src, _waktu, _added in plan:
        shutil.copy2(src, images_dir / sanitize_media_path(target["properties"]["Foto Survey Awal"]))

    points_path.write_text(
        json.dumps(existing, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )

    written = json.loads(points_path.read_text(encoding="utf-8"))
    if len(written["features"]) != len(snapshot) + 1:
        raise SystemExit("Feature count mismatch after write")
    touched = {t["properties"]["Nomor"] for t, *_ in plan}
    for old, new in zip(snapshot, written["features"]):
        if old["properties"]["Nomor"] not in touched and old != new:
            raise SystemExit(f"Untouched row changed: {old['properties']['Nomor']}")
    nomors = [f["properties"]["Nomor"] for f in written["features"]]
    if len(set(nomors)) != len(nomors):
        raise SystemExit("Duplicate Nomor after write")
    for target, *_ in plan:
        if not (images_dir / sanitize_media_path(target["properties"]["Foto Survey Awal"])).is_file():
            raise SystemExit(f"Photo not written for {target['properties']['Nomor']}")
    belum = sum(
        1 for f in written["features"]
        if str(f["properties"].get("Status") or "").strip().lower() == "belum ditetapkan"
    )
    counted = sum(
        1 for f in written["features"]
        if str(f["properties"].get("Status") or "").strip().lower() != "cadangan"
    )
    print(f"\nOK  total: {len(written['features'])}  counted: {counted}  belum ditetapkan: {belum}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
