#!/usr/bin/env python3
"""Rebuild docs/foto-audit.csv from the photos the atlas currently uses.

The audit (first recorded 15 September 2026, af6a1f0) lists every point whose
"Foto Survey Awal" cannot evidence its location, as a pull list against the
source folder on the survey PC. Rules, kept from that snapshot:

* TIDAK ADA FIELD   -- the field is empty.
* FILE HILANG       -- the field names a file that is not in images/.
* THUMBNAIL         -- short side under 400 px; the Timemark overlay is
                       illegible.
* RESOLUSI RENDAH   -- short side 400-719 px (originals are ~1200x1600).

All points are audited, Cadangan included. The field resolves to images/ the
way custom.js does: "\\", "/" and ":" become "_". Rows are sorted by Status,
then Nomor; Kabupaten is the first segment of Nomor.

    python3 scripts/build_foto_audit.py --dry-run
    python3 scripts/build_foto_audit.py
"""

from __future__ import annotations

import argparse
import collections
import csv
import io
import json
import re
from pathlib import Path

from PIL import Image

HEADER = ["Nomor", "Kabupaten", "Latitude", "Longitude", "Status", "Dimensi", "File"]
THUMB_MAX = 400
LOWRES_MAX = 720


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo", type=Path, default=Path(__file__).resolve().parent.parent)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    out_path = args.repo / "docs" / "foto-audit.csv"
    images_dir = args.repo / "images"
    data = json.loads((args.repo / "data" / "points.geojson").read_text(encoding="utf-8"))

    rows = []
    for f in data["features"]:
        p = f["properties"]
        value = str(p.get("Foto Survey Awal") or "").strip()
        name = re.sub(r"[\\/:]", "_", value)
        dims = ""
        if not value:
            status = "TIDAK ADA FIELD"
        elif not (images_dir / name).is_file():
            status = "FILE HILANG"
        else:
            with Image.open(images_dir / name) as im:
                w, h = im.size
            short = min(w, h)
            if short >= LOWRES_MAX:
                continue
            status = "THUMBNAIL" if short < THUMB_MAX else "RESOLUSI RENDAH"
            dims = f"{w}x{h}"
        rows.append([
            p["Nomor"], p["Nomor"].split("-")[0], str(p["Latitude"]), str(p["Longitude"]),
            status, dims, name,
        ])
    rows.sort(key=lambda r: (r[4], r[0]))

    old = {r["Nomor"]: r["Status"] for r in csv.DictReader(io.StringIO(out_path.read_text(encoding="utf-8-sig")))}
    new = {r[0]: r[4] for r in rows}
    print(f"points: {len(data['features'])}  flagged: {len(old)} -> {len(new)}")
    print("  by status:", dict(collections.Counter(new.values())))
    print("  cleared:", len(set(old) - set(new)), " newly flagged:", sorted(set(new) - set(old)))
    print("  status changed:", {n: (old[n], new[n]) for n in set(old) & set(new) if old[n] != new[n]})

    if args.dry_run:
        print("dry-run: nothing written")
        return 0
    buf = io.StringIO()
    writer = csv.writer(buf, lineterminator="\r\n")
    writer.writerow(HEADER)
    writer.writerows(rows)
    out_path.write_text(buf.getvalue(), encoding="utf-8", newline="")
    print("written", out_path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
