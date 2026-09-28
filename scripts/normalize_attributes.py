#!/usr/bin/env python3
"""Normalise the attribute text QGIS exports into points.geojson.

Four things the export gets wrong, none of which touch geometry:

1. All 98 Kota Jambi records say "Kabupaten Jambi". There is no Kabupaten
   Jambi. The same 98 also open with "Desa X", but Kota Jambi has no desa --
   they are all kelurahan, and the export already writes "Kel." correctly for
   the 18 Tanjung Jabung Timur records, so the convention exists and just was
   not applied here.

2. Fifteen records carry a doubled "Desa Desa ..." in Alamat.

3. Kota Jambi is spelled two ways in Nomor -- "JAMBI-" (87) and "KOTA JAMBI-"
   (11).

4. Nama Anggota mixes four conventions for academic titles, and uses bare
   "Gubernur" / "Bupati" for what are offices rather than people. See
   NAMA_FIXES.

The 15 mixed-case "Muaro Jambi-" records are deliberately left alone. Upper
casing them would be a case-only rename of 15 files, and this repo has
core.ignorecase=true, so git would not record it -- the deploy target is Linux,
where the old filename would survive and the new reference would 404. The app
sorts with Intl.Collator sensitivity "base" and lower cases before searching,
so the mixed case costs nothing on screen. Not worth 15 broken photos in
production.

The photo filename is always identical to Nomor (verified across all 471
records), so renaming a Nomor means renaming its file in images/ and its
"Foto Survey Awal" path in lockstep. This script does all three together --
splitting them is how images/ ended up with orphaned files last time.

On top of that, NOMOR_FIXES holds per-record place-name corrections that the
data itself settles -- see the comments on each block for what settles it.
Where a correction changes the desa segment and Alamat still carries the old
desa, Alamat follows along; where Alamat already disagreed it is left alone,
because then the two are telling different stories and that is a finding.

Records whose corrected Nomor is already taken are skipped and reported rather
than overwriting another survey point. The KENALI ASAM ATAS-002 pair was the
case: two points 1.27 km apart shared one id. It was settled by hand on
2026-09-28 from the Timemark stamps, which showed the pair had also swapped
photos: "JAMBI-...ATAS-002" (Musholla De Permata, stamp 11:59) became ATAS-003
and took the full-size photo, the RT 17 point kept ATAS-002 and the 12:30
thumbnail. SKIP_RENAME still guards it should a raw re-export bring the old id
back.

Run after any QGIS re-export:

    ./scripts/normalize_attributes.py
"""

import hashlib
import io
import json
import os
import re
import sys

# Renaming this one would overwrite a different survey point. See docstring.
SKIP_RENAME = {"JAMBI-KOTA BARU-KENALI ASAM ATAS-002"}

_KOTA_BARU = "KOTA JAMBI-KOTA BARU-"
_PAMENANG = "MERANGIN-PAMENANG-"

# Per-record corrections, keyed on the Nomor as it stands after the Kota Jambi
# prefix fix above. Each block says what makes the correction safe to automate.
NOMOR_FIXES = {}

# There is no kelurahan called plain "Kenali Asam" -- only Atas and Bawah. The
# ten records carrying the bare name split cleanly by distance to the labelled
# anchors: -003..-008 sit 253-492 m from KENALI ASAM BAWAH-001 and ~2 km from
# any Atas point, while -002 and -009..-011 sit 60-736 m from an Atas point and
# 1.9-2.7 km from Bawah. A 4-10x gap in every case, no borderline ones.
#
# -002 could not keep its number: KENALI ASAM ATAS-002 and -003 are taken by
# the pair above, so it became ATAS-004 (stamp 12:24, 60 m from ATAS-002).
for _n in ("003", "004", "005", "006", "007", "008"):
    NOMOR_FIXES[_KOTA_BARU + "KENALI ASAM-" + _n] = _KOTA_BARU + "KENALI ASAM BAWAH-" + _n
for _n in ("009", "010", "011"):
    NOMOR_FIXES[_KOTA_BARU + "KENALI ASAM-" + _n] = _KOTA_BARU + "KENALI ASAM ATAS-" + _n
NOMOR_FIXES[_KOTA_BARU + "KENALI ASAM-002"] = _KOTA_BARU + "KENALI ASAM ATAS-004"

# "PEMENANG" is a typo for the kelurahan Pamenang. All seven records already
# carry "Desa Pamenang" in Alamat, so the export contradicts itself and Alamat
# is the side backed by the kecamatan name.
for _n in ("001", "002", "003", "004", "005", "006", "007"):
    NOMOR_FIXES[_PAMENANG + "PEMENANG-" + _n] = _PAMENANG + "PAMENANG-" + _n

# Desa Tanjung Gedang is in Pamenang Barat, not Pamenang. Both records say
# "Kecamatan Pamenang Barat" in Alamat, and this is the only kecamatan
# disagreement left in the file.
for _n in ("001", "002"):
    NOMOR_FIXES[_PAMENANG + "TANJUNG GEDANG-" + _n] = (
        "MERANGIN-PAMENANG BARAT-TANJUNG GEDANG-" + _n)

# The lone Sungai Gedang pin (fid 357, -2.52513, 102.72566) is a Siliwangi
# point that kept the neighbouring desa in Nomor. Siliwangi already holds
# 001-009, so this lands as 010.
NOMOR_FIXES["SAROLANGUN-SINGKUT-SUNGAI GEDANG-001"] = (
    "SAROLANGUN-SINGKUT-SILIWANGI-010")

# Nama Anggota. The export writes academic titles four different ways -- "SE",
# "SH", "S.Kom" with dots but "ME" without -- so they are spelled per PUEBI
# here. Casing is left to toDisplayName in custom.js; these are stored values.
NAMA_FIXES = {
    "Arwiyanto, SE": "Arwiyanto, S.E.",
    "Sapuan Anshori, SE": "Sapuan Anshori, S.E.",
    "PUTRA ABSOR HASIBUAN, SH": "Putra Absor Hasibuan, S.H.",
    "Mazlan, S.Kom, ME": "Mazlan, S.Kom., M.E.",
    "Dr. FAIZAL RIZA, ST, MM": "Dr. Faizal Riza, S.T., M.M.",

    # Offices, not people. All 30 "Bupati" records are in Kerinci, so the
    # office is unambiguous today -- but the bare label would silently merge
    # with any other regent's records in the sidebar, which groups by proposer.
    # "Gubernur" spans four kabupaten, which is what one governor looks like.
    "Gubernur": "Gubernur Jambi",
    "Bupati": "Bupati Kerinci",

    # The export shortened this proposer to "Ridwan". All 30 rows are the
    # Singkut allocation -- Payo Lebar 20, Siliwangi 10 -- and the source
    # sheet names him Samsul Riduan, S.T.
    "Ridwan": "Samsul Riduan, S.T.",

    "Ririn Novianty": "Ririn Novianty, S.E.",
    "Muthsaharudin": "Muthsaharudin, S.E.",

    # Export wrote "Yudhi Nasdem"; an earlier pass stored "Yudhi (NasDem)".
    # The source sheet is Yudi Hariyanto, EY -- six Tanjab Timur rows.
    "Yudhi Nasdem": "Yudi Hariyanto, EY",
    "Yudhi (NasDem)": "Yudi Hariyanto, EY",
    "Yudhi": "Yudi Hariyanto, EY",

    "Yuli Yuliarti": "Hj. Yuli Yuliarti, S.E., M.M.",

    "Fauzi Ansori": "Dr. Ir. H. Ahmad Fauzi Ansori, M.T.",

    # Export spelled the surname Jahfar. The source sheet is Jafar, S.H.
    "Ahmad Jahfar": "Ahmad Jafar, S.H.",
    "Ahmad Jafar": "Ahmad Jafar, S.H.",
}

PHOTO_DIR = "images"
DATA_PATH = "data/points.geojson"


def photo_filename(path):
    """images/ stores each photo under its source path with [\\/:] as _."""
    out = []
    for ch in str(path or "").strip():
        out.append("_" if ch in "\\/:" else ch)
    return "".join(out)


def md5(path):
    return hashlib.md5(io.open(path, "rb").read()).hexdigest()


def fix_alamat(alamat):
    """Kota Jambi is not a kabupaten, and its subdivisions are kelurahan."""
    if not alamat:
        return alamat, False
    before = alamat
    if alamat.startswith("Desa Desa "):
        alamat = alamat[len("Desa "):]
    if alamat.endswith("Kabupaten Jambi"):
        alamat = alamat[: -len("Kabupaten Jambi")] + "Kota Jambi"
        if alamat.startswith("Desa "):
            alamat = "Kel. " + alamat[len("Desa "):]
    return alamat, alamat != before


def fix_nomor(nomor):
    """Spell Kota Jambi out, then apply per-record corrections."""
    fixed = "KOTA " + nomor if nomor.startswith("JAMBI-") else nomor
    return NOMOR_FIXES.get(fixed, fixed)


def desa_segment(nomor):
    return "-".join(nomor.split("-")[2:-1])


def follow_desa(alamat, old_desa, new_desa):
    """Carry a desa rename into Alamat, but only where the two agreed before."""
    if old_desa == new_desa:
        return alamat, False
    match = re.match(r"(Desa |Kel\. )(.+?)(,.*)$", alamat or "")
    if not match or match.group(2).upper() != old_desa.upper():
        return alamat, False
    return match.group(1) + new_desa.title() + match.group(3), True


def rename_photo(root, old_name, new_name, report):
    """Rename inside images/, tolerating a byte-identical file already there."""
    old_path = os.path.join(root, PHOTO_DIR, old_name)
    new_path = os.path.join(root, PHOTO_DIR, new_name)
    if not os.path.exists(old_path):
        report["foto_hilang"].append(old_name)
        return
    if os.path.exists(new_path):
        if md5(old_path) != md5(new_path):
            report["foto_bentrok"].append((old_name, new_name))
            return
        os.remove(old_path)          # target is the same image; drop the orphan
        report["foto_yatim_termakan"].append((old_name, new_name))
        return
    os.rename(old_path, new_path)
    report["foto_rename"].append((old_name, new_name))


def main():
    root = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
    path = os.path.join(root, DATA_PATH)
    data = json.loads(io.open(path, encoding="utf-8").read())
    features = data["features"]
    taken = {f["properties"]["Nomor"] for f in features}

    report = {"alamat": 0, "alamat_ikut": 0, "nama": 0, "nomor": [], "dilewati": [],
              "foto_rename": [], "foto_yatim_termakan": [], "foto_bentrok": [],
              "foto_hilang": []}

    for feature in features:
        props = feature["properties"]

        props["Alamat"], changed = fix_alamat(props.get("Alamat"))
        if changed:
            report["alamat"] += 1

        nama = NAMA_FIXES.get(props.get("Nama Anggota"))
        if nama:
            props["Nama Anggota"] = nama
            report["nama"] += 1

        nomor = props["Nomor"]
        baru = fix_nomor(nomor)
        if baru == nomor:
            continue
        if nomor in SKIP_RENAME or (baru in taken and baru != nomor):
            report["dilewati"].append((nomor, baru))
            continue

        old_photo = photo_filename(props["Foto Survey Awal"])
        props["Alamat"], followed = follow_desa(
            props["Alamat"], desa_segment(nomor), desa_segment(baru))
        if followed:
            report["alamat_ikut"] += 1
        props["Nomor"] = baru
        props["Foto Survey Awal"] = props["Foto Survey Awal"].replace(nomor, baru)
        taken.discard(nomor)
        taken.add(baru)
        report["nomor"].append((nomor, baru))
        rename_photo(root, old_photo, photo_filename(props["Foto Survey Awal"]), report)

    if report["foto_bentrok"]:
        print("ERROR: file foto tujuan sudah ada dengan isi berbeda:")
        for old, new in report["foto_bentrok"]:
            print("  %s -> %s" % (old, new))
        print("Tidak ada yang ditulis ke %s." % DATA_PATH)
        return 1

    out = json.dumps(data, separators=(",", ":"), ensure_ascii=False)
    io.open(path, "w", encoding="utf-8", newline="\n").write(out)

    print("%-38s %d" % ("Alamat dibetulkan:", report["alamat"]))
    print("%-38s %d" % ("Alamat ikut rename desa:", report["alamat_ikut"]))
    print("%-38s %d" % ("Nama Anggota dibakukan:", report["nama"]))
    print("%-38s %d" % ("Nomor dinormalisasi:", len(report["nomor"])))
    koreksi = [(lama, baru) for lama, baru in report["nomor"]
               if baru != ("KOTA " + lama if lama.startswith("JAMBI-") else lama)]
    if koreksi:
        print("%-38s %d" % ("  di antaranya koreksi nama tempat:", len(koreksi)))
        for lama, baru in koreksi:
            print("      %s" % lama)
            print("        -> %s" % baru)
    print("%-38s %d" % ("  file foto ikut di-rename:", len(report["foto_rename"])))
    print("%-38s %d" % ("  file yatim termakan (isi identik):",
                        len(report["foto_yatim_termakan"])))
    for old, new in report["foto_yatim_termakan"]:
        print("      %s" % new.split("Foto_")[-1])
    if report["foto_hilang"]:
        print("%-38s %d" % ("  PERINGATAN file foto tak ada:", len(report["foto_hilang"])))
        for name in report["foto_hilang"]:
            print("      %s" % name.split("Foto_")[-1])
    if report["dilewati"]:
        print("%-38s %d" % ("Dilewati (bentrok Nomor):", len(report["dilewati"])))
        for old, new in report["dilewati"]:
            print("      %s" % old)
    return 0


if __name__ == "__main__":
    sys.exit(main())
