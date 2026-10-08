"""Susun 500 titik tampil website menjadi file Excel format 2026.

Sumber : data/points.geojson (semua fitur kecuali Status "Cadangan",
         sama seperti yang tampil di website)
Acuan  : sheet "2026" pada file asli (urutan kelompok kecamatan/desa
         + gaya sel, lebar kolom, tinggi baris)
Hasil  : workbook baru satu sheet "2026", kolom G-K terisi.

Jalankan dari root repo:
    python scripts/export_2026_excel.py
    python scripts/export_2026_excel.py --output "path/ke/hasil.xlsx"
"""

import argparse
import json
import re
import sys
from collections import OrderedDict
from copy import copy
from pathlib import Path

import openpyxl
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side

from rekapan_names import REKAPAN_PATH, assign_names

ROOT = Path(__file__).resolve().parent.parent
GEOJSON = ROOT / "data" / "points.geojson"
DEFAULT_SOURCE = (
    Path.home() / "Downloads" / "Data Lokasi PJUTS 2025 dan 2026.xlsx"
)
DEFAULT_OUTPUT = (
    Path.home() / "Downloads" / "Data Lokasi PJUTS 2026 - 500 Titik.xlsx"
)

# Urutan + judul seksi mengikuti file asli (no. 7 Kerinci tidak ada di file
# asli; ditambahkan di sini mengikuti polanya).
SECTIONS = [
    ("KOTA JAMBI", "Kota Jambi"),
    ("TEBO", "Kabupaten Tebo"),
    ("BATANG HARI", "Kabupaten Batang Hari"),
    ("MERANGIN", "Kabupaten Merangin"),
    ("TANJUNG JABUNG TIMUR", "Kabupaten Tanjung Jabung Timur"),
    ("SAROLANGUN", "Kabupaten Sarolangun"),
    ("KERINCI", "Kabupaten Kerinci"),
    ("TANJUNG JABUNG BARAT", "Kabupaten Tanjung Jabung Barat"),
    ("MUARO BUNGO", "Kabupaten Bungo"),
    ("MUARO JAMBI", "Kabupaten Muaro Jambi"),
]

# Nama desa di file asli -> nama desa di data survey (kunci ternormalisasi).
DESA_ALIAS = {
    "KOTA JAMBI": {"kenali alam barajo": "kenali besar"},
    "BATANG HARI": {"tenam": "simpang terusan",
                    "sei. bulu": "sungai buluh"},
    "MERANGIN": {"limbur merangin": "limbur"},
    "TANJUNG JABUNG TIMUR": {"muara sabak timur": "lambur i"},
    "TANJUNG JABUNG BARAT": {"teluk pengkah": "tebing tinggi",
                             "sei.kayu aro": "sungai kayu aro"},
    "MUARO JAMBI": {"marga mulya": "unit 2", "panca bakti": "unit 5"},
    "TEBO": {"betung berdarah barat": "betung bedarah"},
}

# Kelompok survey baru -> sisipkan tepat sesudah kelompok ini (bukan di akhir
# seksi), karena di file asli keduanya digabung dalam satu kelompok.
FOLLOW = {
    "KOTA JAMBI": {"telanaipura": "pematang sulur"},
    "MERANGIN": {"sungai ulas": "muara siau"},
    "TANJUNG JABUNG TIMUR": {"muara sabak ilir": "lambur i"},
    "MUARO JAMBI": {"tempino": "pelempang"},
    "MUARO BUNGO": {"lubuk niur": "tanah tumbuh"},
}

HEADER_ROW_1 = [
    "No.", "Lokasi", None, "Jumlah", "Satuan", "No",
    "Titik Koordinat", "Link Titik Koordinat Sesuai Google Map",
    "Alamat Lengkap", "Nama Penerima/ Pengusul", "NIK Penerima/ Pengusul",
]
HEADER_ROW_2 = [
    None, "Kecamatan", "Desa/Kelurahan",
    None, None, None, None, None, None, None, None,
]

COLUMN_WIDTHS = {
    "A": 5.0, "B": 41.42578125, "C": 24.140625, "D": 10.140625,
    "E": 9.5703125, "F": 9.5703125, "G": 16.140625, "H": 41.85546875,
    "I": 24.5703125, "J": 24.5703125, "K": 13.0,
}

FONT = Font(name="Arial", size=11, color="FF000000")
FONT_BOLD = Font(name="Arial", size=11, bold=True, color="FF000000")
FONT_LINK = Font(name="Arial", size=11, color="FF0563C1", underline="single")
FONT_BOLD_WHITE = Font(name="Arial", size=11, bold=True, color="FFFFFFFF")
HEADER_FILL = PatternFill("solid", fgColor="FFE7E6E6")
# Blok isian titik (No, Titik Koordinat, Link, Alamat, Nama, NIK):
# kepala biru + sel data biru muda agar beda visual dari blok
# pengelompokan (No., Lokasi, Jumlah, Satuan) yang tetap abu-abu.
HEADER_FILL_DETAIL = PatternFill("solid", fgColor="FF2E75B6")
DATA_FILL_DETAIL = PatternFill("solid", fgColor="FFDDEBF7")
# Pita judul seksi kabupaten: biru tua + teks putih agar batas tiap
# kabupaten langsung terlihat saat menggulir.
TITLE_FILL = PatternFill("solid", fgColor="FF1F4E78")
FONT_TITLE = Font(name="Arial", size=11, bold=True, color="FFFFFFFF")
DETAIL_COLS = (6, 7, 8, 9, 10, 11)  # F-K
MEDIUM = Side(style="medium", color="FF000000")
HEADER_BORDER = Border(left=MEDIUM, right=MEDIUM, top=MEDIUM, bottom=MEDIUM)
DATA_BORDER_FIRST = Border(left=MEDIUM, right=MEDIUM, bottom=MEDIUM)
DATA_BORDER = Border(right=MEDIUM, bottom=MEDIUM)


def norm(text):
    return re.sub(r"\s+", " ", (text or "").strip().lower())


def display_case(text):
    """Title case, tapi angka romawi (XXIV, VII) tetap kapital."""

    def fix(word):
        if re.fullmatch(r"[IVXLCDM]+", word.upper()):
            return word.upper()
        return word.capitalize()

    return " ".join(fix(w) for w in norm(text).split(" "))


def strip_desa_prefix(desa):
    # Hanya awalan administratif ("Desa Suka Damai" -> "Suka Damai").
    # "Dusun ..." TIDAK dipangkas: Dusun Bangko / Dusun Dalam /
    # Dusun Kebun adalah nama desanya sendiri.
    return re.sub(
        r"^(desa|kelurahan|kel\.?)\s+", "", norm(desa),
    ).strip()


def format_coord_number(value):
    """Persis formatCoordNumber di custom.js: maks 6 desimal, tanpa nol sisa."""
    num = float(value)
    if num != num or num in (float("inf"), float("-inf")):
        return ""
    text = f"{num:.6f}".rstrip("0").rstrip(".")
    return "0" if text in ("-0", "") else text


def split_nomor(nomor):
    parts = (nomor or "").split("-")
    kab = norm(parts[0]) if parts else ""
    kec = norm(parts[1]) if len(parts) > 1 else ""
    desa = "-".join(parts[2:-1]).strip() if len(parts) > 2 else ""
    return kab, kec, strip_desa_prefix(desa)


# Port cleanKeterangan dari custom.js agar Alamat Lengkap di Excel sama
# dengan yang tampil di website.
SURVEY_NOTE = re.compile(r"\s*\((?=[^)]*(?:foto|dikirim))[\s\S]*$", re.I)
GPS_LOG = re.compile(r"survey pemasangan|alamat gps:|elevasi\s", re.I)
GPS_ADDRESS = re.compile(r"alamat gps:\s*([^;]+)", re.I)
PLUS_CODE = re.compile(r"^[a-z0-9]{4}\+[a-z0-9]{2,3}[\s,]*", re.I)
SPELLING_FIXES = [
    (re.compile(r"\bmadrash\b", re.I), "Madrasah"),
    (re.compile(r"\balternatip\b", re.I), "Alternatif"),
    (re.compile(r"\brmh\b", re.I), "Rumah"),
    (re.compile(r"\bsmp\b", re.I), "SMP"),
    (re.compile(r"\bJl\.(?=\S)"), "Jl. "),
]


def clean_keterangan(value):
    """Sederhanakan Keterangan: buang catatan survey, log GPS (jadwal +
    elevasi), kode plus, dan rapikan ejaan."""
    text = SURVEY_NOTE.sub("", str(value or "")).strip()
    if GPS_LOG.search(text):
        found = GPS_ADDRESS.search(text)
        text = PLUS_CODE.sub("", found.group(1).strip()) if found else ""
    for pattern, replacement in SPELLING_FIXES:
        text = pattern.sub(replacement, text)
    return re.sub(r"\s{2,}", " ", text).strip()


def alamat_lengkap(keterangan, alamat):
    addr = (alamat or "").strip()
    ket = clean_keterangan(keterangan)
    if ket:
        # Keterangan yang isinya sama persis dengan desa/kelurahan
        # ("Desa Talang Tinggi") tidak perlu diulang di depan alamat
        first = addr.split(",")[0]
        core_addr = re.sub(
            r"^(desa|kelurahan|kel\.?)\s+", "", norm(first)).strip()
        core_ket = re.sub(
            r"^(desa|kelurahan|kel\.?)\s+", "", norm(ket)).strip()
        if core_ket and core_ket == core_addr:
            ket = ""
    return f"{ket}, {addr}" if ket else addr


def load_points():
    data = json.loads(GEOJSON.read_text(encoding="utf-8"))
    points = []
    for feature in data["features"]:
        props = feature["properties"]
        if norm(props.get("Status")) == "cadangan":
            continue  # tidak tampil di website
        nomor = (props.get("Nomor") or "").strip()
        kab, kec, desa = split_nomor(nomor)
        if kab == "jambi":  # satu titik prefix JAMBI, alamatnya Kota Jambi
            kab = "kota jambi"
        lat = props.get("Latitude")
        lon = props.get("Longitude")
        if lat in (None, "") or lon in (None, ""):
            x, y = feature["geometry"]["coordinates"]
            lon, lat = x, y
        keterangan = (props.get("Keterangan") or "").strip()
        alamat = (props.get("Alamat") or "").strip()
        alamat_full = alamat_lengkap(keterangan, alamat)
        points.append({
            "nomor": nomor,
            "kab": kab.upper(),
            "kec": display_case(kec),
            "desa": display_case(desa),
            "desa_key": norm(desa),
            "lat": format_coord_number(lat),
            "lon": format_coord_number(lon),
            "alamat": alamat_full,
            "nama": (props.get("Nama Anggota") or "").strip(),
            "ket_raw": keterangan,
        })
    return points


def original_group_order(source_path):
    """Urutan kelompok (kecamatan, desa) per kabupaten di file asli."""
    order = {}
    if not source_path.exists():
        return order
    wb = openpyxl.load_workbook(source_path, read_only=True)
    ws = wb["2026"]
    current = None
    kerinci_kec = {"siulak", "gunung kerinci", "siulak mukai",
                   "air hangat", "gunung tujuh"}
    for row in range(1, ws.max_row + 1):
        a = ws.cell(row, 1).value
        b = ws.cell(row, 2).value
        c0 = ws.cell(row, 3).value
        # Judul seksi: "Kota Jambi : 72 Unit" di kolom B, atau terbelah
        # ("Kabupaten Merangin" | ": 58 Unit") seperti baris 230 file asli.
        is_title = (
            (isinstance(b, str) and "Unit" in b)
            or (isinstance(c0, str)
                and re.match(r":\s*\d+\s*unit", norm(c0)))
        )
        if is_title:
            # cocokkan judul seksi ke kode kabupaten
            nb = norm(b)
            for key, _title in SECTIONS:
                short = norm(key).split(" ")
                if all(w in nb for w in short):
                    current = key
                    order.setdefault(key, [])
                    break
            else:
                if "bungo" in nb:
                    current = "MUARO BUNGO"
                    order.setdefault(current, [])
            continue
        if isinstance(a, int) and isinstance(b, str) and current:
            c = ws.cell(row, 3).value
            if b not in ("Lokasi", "Kecamatan") and c:
                # file asli tidak punya judul seksi Kerinci: kelompoknya
                # menumpang di bawah Sarolangun; kenali dari kecamatannya
                if current == "SAROLANGUN" and norm(b) in kerinci_kec:
                    current = "KERINCI"
                    order.setdefault(current, [])
                desa_key = norm(strip_desa_prefix(str(c)))
                desa_key = DESA_ALIAS.get(current, {}).get(desa_key, desa_key)
                kec_key = norm(b)
                seen = {d for d, _k in order[current]}
                if desa_key not in seen:
                    order[current].append((desa_key, kec_key))
    wb.close()
    return order


def order_groups(points, source_path):
    grouped = OrderedDict()
    for p in points:
        grouped.setdefault((p["kab"], p["desa_key"]), []).append(p)

    by_kab = OrderedDict((key, []) for key, _t in SECTIONS)
    for (kab, desa_key), rows in grouped.items():
        rows.sort(key=lambda r: r["nomor"])
        by_kab.setdefault(kab, []).append((desa_key, rows))

    wanted = original_group_order(source_path)
    ordered = OrderedDict()
    for kab, groups in by_kab.items():
        # satu nama desa bisa ada di dua kecamatan (Talang Tinggi di
        # Siulak dan Siulak Mukai): pecah per kecamatan
        by_kec = OrderedDict()
        for desa_key, rows in groups:
            split = OrderedDict()
            for r in rows:
                split.setdefault(norm(r["kec"]), []).append(r)
            by_kec.setdefault(desa_key, []).extend(
                (kec_key, krows) for kec_key, krows in split.items()
            )
        result = []
        for desa_key, want_kec in wanted.get(kab, []):
            if desa_key in by_kec:
                parts = by_kec.pop(desa_key)
                # yang kecamatannya sama dengan file asli duluan
                parts.sort(key=lambda p: 0 if p[0] == want_kec else 1)
                result.extend((desa_key, rows) for _k, rows in parts)
        # kelompok baru: ikut FOLLOW bila ada, sisanya urut Nomor di akhir
        flat = [rows for parts in by_kec.values() for _k, rows in parts]
        leftovers = sorted(flat, key=lambda rows: rows[0]["nomor"])
        follow = FOLLOW.get(kab, {})
        placed = {k for k, _r in result}
        for desa_key, rows in [(r[0]["desa_key"], r) for r in leftovers]:
            anchor = follow.get(desa_key)
            if anchor in placed:
                idx = next(
                    i for i, (k, _r) in enumerate(result) if k == anchor
                ) + 1
                # sesudah kelompok anchor + pengikut sebelumnya
                while (idx < len(result)
                       and follow.get(result[idx][0]) == anchor):
                    idx += 1
                result.insert(idx, (desa_key, rows))
            else:
                result.append((desa_key, rows))
            placed.add(desa_key)
        ordered[kab] = result
    return ordered


def style_header_row(ws, row):
    for col in range(1, 12):
        cell = ws.cell(row, col)
        if col in DETAIL_COLS:
            cell.font = copy(FONT_BOLD_WHITE)
            cell.fill = copy(HEADER_FILL_DETAIL)
        else:
            cell.font = copy(FONT_BOLD)
            cell.fill = copy(HEADER_FILL)
        cell.border = copy(HEADER_BORDER)
        cell.alignment = Alignment(horizontal="center", vertical="center")


def write_data_cell(ws, row, col, value, first_col=False, wrap=False,
                    center=True, link=False):
    cell = ws.cell(row, col, value=value)
    cell.font = copy(FONT_LINK) if link else copy(FONT)
    if col in DETAIL_COLS:
        cell.fill = copy(DATA_FILL_DETAIL)
    cell.border = copy(DATA_BORDER_FIRST if first_col else DATA_BORDER)
    cell.alignment = Alignment(
        horizontal="center" if center else "left",
        vertical="center", wrap_text=wrap,
    )
    return cell


def estimate_lines(text, width):
    if not text:
        return 1
    per_line = max(int(width * 1.05), 8)
    return max(1, -(-len(str(text)) // per_line))


def build(points, ordered, output_path):
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "2026"
    ws.sheet_view.showGridLines = True
    # Kunci kolom A-F (No, Lokasi, Jumlah, Satuan, No) agar kecamatan/desa
    # tetap terlihat saat menggulir ke kanan (koordinat/link/nama).
    # Baris tidak dikunci: tiap seksi sudah membawa judul + kepalanya
    # sendiri, dan mengunci baris 1-3 justru menempelkan judul "Kota Jambi"
    # di atas seksi lain.
    ws.freeze_panes = "G1"
    for col, width in COLUMN_WIDTHS.items():
        ws.column_dimensions[col].width = width

    row = 1
    total = 0
    for num, (kab, title) in enumerate(SECTIONS, start=1):
        groups = ordered.get(kab, [])
        count = sum(len(rows) for _k, rows in groups)
        total += count
        # judul seksi: pita biru tua selebar A-K
        for col in range(1, 12):
            cell = ws.cell(row, col)
            cell.fill = copy(TITLE_FILL)
            cell.font = copy(FONT_TITLE)
            cell.alignment = Alignment(
                horizontal="center" if col == 1 else "left",
                vertical="center",
            )
        ws.cell(row, 1, value=f"{num}.")
        ws.cell(row, 2, value=f"{title} : {count} Unit")
        ws.row_dimensions[row].height = 18.0
        row += 1
        # kepala kolom
        for col, value in enumerate(HEADER_ROW_1, start=1):
            ws.cell(row, col, value=value)
        style_header_row(ws, row)
        ws.row_dimensions[row].height = 15.75
        row += 1
        for col, value in enumerate(HEADER_ROW_2, start=1):
            ws.cell(row, col, value=value)
        style_header_row(ws, row)
        ws.row_dimensions[row].height = 15.75
        row += 1
        ws.merge_cells(start_row=row - 2, start_column=2,
                       end_row=row - 2, end_column=3)
        for col in (1, 4, 5, 6, 7, 8, 9, 10, 11):
            ws.merge_cells(start_row=row - 2, start_column=col,
                           end_row=row - 1, end_column=col)
        # gaya ulang sesudah merge agar sel tergabung pun menyimpan
        # warnanya (seperti file asli)
        style_header_row(ws, row - 2)
        style_header_row(ws, row - 1)
        # kelompok + titik
        for group_no, (_desa_key, rows) in enumerate(groups, start=1):
            first = rows[0]
            for i, p in enumerate(rows, start=1):
                coord = f"{p['lat']}, {p['lon']}"
                url = f"https://www.google.com/maps?q={p['lat']},{p['lon']}"
                if i == 1:
                    write_data_cell(ws, row, 1, group_no, first_col=True)
                    write_data_cell(ws, row, 2, first["kec"], center=False)
                    write_data_cell(ws, row, 3, first["desa"], center=False)
                    write_data_cell(ws, row, 4, len(rows))
                    write_data_cell(ws, row, 5, "Unit")
                else:
                    for col in range(1, 6):
                        write_data_cell(ws, row, col, None,
                                        first_col=(col == 1))
                write_data_cell(ws, row, 6, i)
                write_data_cell(ws, row, 7, coord, wrap=True)
                link_cell = write_data_cell(
                    ws, row, 8, url, wrap=True, link=True)
                link_cell.hyperlink = url
                write_data_cell(ws, row, 9, p["alamat"], wrap=True)
                write_data_cell(ws, row, 10, p["nama"], wrap=True)
                write_data_cell(ws, row, 11, None, wrap=True)
                lines = max(
                    estimate_lines(coord, COLUMN_WIDTHS["G"]),
                    estimate_lines(url, COLUMN_WIDTHS["H"]),
                    estimate_lines(p["alamat"], COLUMN_WIDTHS["I"]),
                    estimate_lines(p["nama"], COLUMN_WIDTHS["J"]),
                )
                ws.row_dimensions[row].height = max(15.0, 15.0 * min(lines, 4))
                row += 1
        # baris pemisah ramping antar kabupaten (kecuali sesudah seksi akhir)
        if num < len(SECTIONS):
            ws.row_dimensions[row].height = 9.0
            row += 1
    wb.save(output_path)
    return total


def main(argv=None):
    parser = argparse.ArgumentParser(
        description="Susun 500 titik website ke Excel format 2026.")
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE,
                        help="File xlsx asli (acuan urutan + gaya).")
    parser.add_argument("--rekapan", type=Path, default=REKAPAN_PATH,
                        help="File rekapan (sumber nama kolom J).")
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT,
                        help="File xlsx hasil.")
    args = parser.parse_args(argv)

    points = load_points()
    print(f"Titik tampil website: {len(points)}")
    report, leftover = assign_names(points, args.rekapan)
    bad = [r for r in report if not r["ok"]]
    n_h = sum(r["dapat"] for r in report if r["source"] in ("rekapan-H", "rekapan-H-khusus"))
    n_b = sum(r["dapat"] for r in report if r["source"] == "rekapan-B")
    n_blank = sum(r["dapat"] for r in report if r["source"] == "kosong")
    print(f"Nama kolom H rekapan: {n_h} titik, kolom B: {n_b} titik, "
          f"dikosongkan: {n_blank} titik")
    for r in bad:
        print(f'  ! rekapan baris {r["rekapan"]}: dapat {r["dapat"]}, '
              f'minta {r["minta"]} ({r["kab"]} / {r["desa"]})')
    for key, nomors in leftover.items():
        print(f"  ! tanpa aturan: {key} -> {nomors}")
    if bad or leftover:
        raise SystemExit("Pemadanan rekapan belum pas 500/500.")
    ordered = order_groups(points, args.source)
    for kab, _title in SECTIONS:
        groups = ordered.get(kab, [])
        print(f"  {kab}: {sum(len(r) for _k, r in groups)} titik, "
              f"{len(groups)} kelompok")
    total = build(points, ordered, args.output)
    print(f"Total baris titik: {total}")
    print(f"Tersimpan: {args.output}")


if __name__ == "__main__":
    sys.exit(main())
