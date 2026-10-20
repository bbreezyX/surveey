#!/usr/bin/env python3
"""Build the Jambi boundary layer and province mask from BIG's June 2026 data.

Requires shapely>=2.1 and pyproj. See docs/boundary-data.md for the download
command. Run with the downloaded GeoJSON path; no survey data is modified.
"""

import argparse
import hashlib
import json
from pathlib import Path

import shapely
from pyproj import Transformer
from shapely.geometry import Point, mapping, shape
from shapely.ops import transform

ROOT = Path(__file__).resolve().parents[1]
SOURCE = "https://geoservices.big.go.id/rbi/rest/services/BATASWILAYAH/BATAS_KABKOTA_AR/MapServer"
EDITION = "2026-06"
# Display tolerance in metres. BIG publishes these boundaries at 1:50,000
# (METADATA "TASWIL50000..."), whose positional accuracy is tens of metres, so
# 10 m stays well inside the source's own uncertainty. Measured on the June 2026
# edition: 36,488 -> 20,476 vertices and regions.json 123 KB -> 78 KB gzipped,
# the largest file on a phone's first load. 2 m bought no real precision, and
# every point's district membership is still checked below against the
# unsimplified geometry.
TOLERANCE_M = 10
EXPECTED = {
    "15.01": "Kerinci", "15.02": "Merangin", "15.03": "Sarolangun",
    "15.04": "Batanghari", "15.05": "Muaro Jambi",
    "15.06": "Tanjung Jabung Barat", "15.07": "Tanjung Jabung Timur",
    "15.08": "Bungo", "15.09": "Tebo", "15.71": "Kota Jambi",
    "15.72": "Kota Sungai Penuh",
}


def require(condition, message):
    if not condition:
        raise ValueError(message)


def validate_coverage(geometries):
    require(all(g.geom_type in ("Polygon", "MultiPolygon") and
                not g.is_empty and g.is_valid for g in geometries),
            "Boundary geometries must be valid, non-empty polygons")
    require(bool(shapely.coverage_is_valid(geometries)),
            "Boundary polygons must form an edge-matched coverage without overlaps")


def memberships(geometries, points):
    return [tuple(i for i, g in enumerate(geometries) if g.covers(p)) for p in points]


def serialize(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("geojson", type=Path)
    args = parser.parse_args()
    raw_bytes = args.geojson.read_bytes()
    raw = json.loads(raw_bytes)
    require(raw.get("type") == "FeatureCollection", "Expected a GeoJSON FeatureCollection")
    features = sorted(raw["features"], key=lambda f: f["properties"]["KDPKAB"])
    require(len(features) == len(EXPECTED), "Expected exactly 11 Jambi kabupaten/kota")
    require({f["properties"]["KDPKAB"]: f["properties"]["NAMOBJ"] for f in features}
            == EXPECTED, "Unexpected or missing Jambi administrative codes/names")
    require(all(f["properties"]["KDPPUM"] == "15" and
                f["properties"]["WADMPR"] == "Jambi" for f in features),
            "Data must be filtered to Jambi")

    originals = [shape(f["geometry"]) for f in features]
    validate_coverage(originals)
    # Simplify shared edges together in metres so neighbouring districts stay
    # aligned. TOLERANCE_M is for display, not a claim about source accuracy.
    project = Transformer.from_crs(4326, 32748, always_xy=True).transform
    unproject = Transformer.from_crs(32748, 4326, always_xy=True).transform
    metric = [transform(project, g) for g in originals]
    simplified = shapely.coverage_simplify(metric, tolerance=TOLERANCE_M)
    geometries = [shapely.set_precision(transform(unproject, g), 0.000001)
                  for g in simplified]
    validate_coverage(geometries)

    points = [Point(f["geometry"]["coordinates"][:2]) for f in
              json.loads((ROOT / "data/points.geojson").read_text())["features"]]
    original_memberships = memberships(originals, points)
    require(memberships(geometries, points) == original_memberships,
            "Display simplification changed a survey point's district membership")
    require(all(len(m) == 1 for m in original_memberships),
            "A survey point is outside Jambi or ambiguously on a district border")

    output = []
    for feature, geometry in zip(features, geometries):
        properties = dict(feature["properties"])
        name = properties["NAMOBJ"]
        # Preserve the application's display/grouping contract, including Kota.
        properties["KABUPATEN_"] = (name if name.startswith("Kota ") else "Kab. " + name).upper()
        output.append({"type": "Feature", "properties": properties,
                       "geometry": mapping(geometry)})
    collection = {"type": "FeatureCollection", "name": "BatasKabupatenJambi",
                  "source": SOURCE, "edition": EDITION, "features": output}
    province = shapely.union_all(geometries)
    require(province.is_valid and not province.is_empty, "Invalid province mask")
    dissolved = {"type": "FeatureCollection", "source": SOURCE, "edition": EDITION,
                 "features": [{"type": "Feature", "properties": {"WADMPR": "Jambi"},
                               "geometry": mapping(province)}]}
    provenance = {
        "publisher": "Badan Informasi Geospasial", "service": SOURCE,
        "service_description": "Geodatabase data batas wilayah administrasi nasional edisi Juni 2026",
        "edition": EDITION, "downloaded_on": "2026-09-07",
        "query": {"where": "KDPPUM = '15'", "outSR": 4326, "returnZ": False},
        "raw_sha256": hashlib.sha256(raw_bytes).hexdigest(),
        "feature_count": len(output), "crs": "EPSG:4326",
        "processing": {"metric_crs": "EPSG:32748", "coverage_simplify_tolerance_m": TOLERANCE_M,
                       "coordinate_grid_degrees": 0.000001,
                       "shapely_version": shapely.__version__},
        "feature_metadata": {f["properties"]["KDPKAB"]: f["properties"]["METADATA"]
                             for f in features},
        "note": "Service edition is not the revision date of every individual boundary.",
    }
    # Validate everything before replacing either geometry file.
    (ROOT / "layers/BatasKabupaten_1.js").write_text(
        "var json_BatasKabupaten_1 = " + serialize(collection) + ";\n")
    (ROOT / "data/dissolved.geojson").write_text(serialize(dissolved) + "\n")
    (ROOT / "data/boundaries-source.json").write_text(
        json.dumps(provenance, ensure_ascii=False, indent=2) + "\n")
    print(f"Imported {len(output)} districts; verified {len(points)} point memberships; "
          f"{sum(shapely.get_num_coordinates(g) for g in geometries)} boundary coordinates")


if __name__ == "__main__":
    main()
