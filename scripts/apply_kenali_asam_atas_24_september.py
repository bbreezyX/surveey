#!/usr/bin/env python3
"""Update KENALI ASAM ATAS-001 and -003 from two 24 September 2026 photos.

Source: two Timemark photos sent in chat (Kenali Asam Atas, 24 Sep 2026,
10:50 and 10:51, label "DINAS ESDM PROV JAMBI PUTS 2026"). Both show a cast
anchor-bolt foundation, i.e. installation progress at RT 01 Perum De Permata.

Each stamp sits ~6 m from one atlas point and 70-80 m from the other, so the
pairing is unambiguous: 10:51 -> 001, 10:50 -> 003. Coordinates are the
6-decimal stamp values. The user also asked for 003 to read "Dekat Mushola";
its Keterangan "Musholla De Permata" becomes "Dekat Musholla De Permata".
Old photos stay in images/.

    python3 scripts/apply_kenali_asam_atas_24_september.py --photo1 1.jpg --photo2 2.jpg
"""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

TANGGAL = "24/09/2026"
KA = "KOTA JAMBI-KOTA BARU-KENALI ASAM ATAS-"
MAX_MOVE_M = 10

# photo arg -> (Nomor, latitude, longitude, new Keterangan or None)
UPDATES = {
    "photo1": (KA + "001", -1.647022, 103.605860, None),  # 10:51
    "photo2": (KA + "003", -1.646786, 103.605230, "Dekat Musholla De Permata"),  # 10:50
}


def distance_m(lat1, lon1, lat2, lon2) -> float:
    dy = (lat1 - lat2) * 111320
    dx = (lon1 - lon2) * 111320 * math.cos(math.radians(lat1))
    return math.hypot(dx, dy)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--photo1", type=Path, required=True, help="stamp 10:51 (-> 001)")
    parser.add_argument("--photo2", type=Path, required=True, help="stamp 10:50 (-> 003)")
    parser.add_argument("--repo", type=Path, default=Path(__file__).resolve().parent.parent)
    args = parser.parse_args()

    points_path = args.repo / "data" / "points.geojson"
    data = json.loads(points_path.read_text(encoding="utf-8"))
    by_nomor = {f["properties"]["Nomor"]: f for f in data["features"]}

    for arg, (nomor, lat, lon, keterangan) in UPDATES.items():
        f = by_nomor[nomor]
        p = f["properties"]
        moved = distance_m(lat, lon, p["Latitude"], p["Longitude"])
        if moved > MAX_MOVE_M:
            raise SystemExit(f"{nomor} would move {moved:.0f} m")
        name = f"Kenali-Asam-Atas-{nomor[-3:]}-2026-09-24.jpeg"
        dst = args.repo / "images" / name
        if dst.exists():
            raise SystemExit(f"Photo already present: {name}")
        dst.write_bytes(getattr(args, arg).read_bytes())
        print(f"  {nomor}  {p['Latitude']},{p['Longitude']} -> {lat},{lon}  {moved:.1f} m  {name}")
        p["Latitude"] = lat
        p["Longitude"] = lon
        f["geometry"]["coordinates"] = [lon, lat]
        p["Tanggal Dokumentasi"] = TANGGAL
        p["Foto Survey Awal"] = name
        if keterangan:
            print(f"    Keterangan: {p['Keterangan']!r} -> {keterangan!r}")
            p["Keterangan"] = keterangan

    points_path.write_text(
        json.dumps(data, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )
    print("written")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
