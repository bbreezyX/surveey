"""Padankan 500 titik survey dengan kolom H rekapan (Nama dan No. HP).

Sumber nama  : sheet "REKAPITULASI (2)", kolom H, file
               "REKAPAN PJUTS 2026 terbaru 14 Sept.xlsx" (nama saja,
               nomor HP dibuang; NIK tidak tersedia di mana pun).
Acuan baris  : nomor baris sheet tersebut (kolom DISETUJUI untuk verifikasi).

Aturan di bawah dibaca berurutan; titik yang sudah dapat nama dilewati
aturan berikutnya. Spesifikasi nama:
  "H:<baris>" = nama kolom H baris itu (nomor HP dibuang);
  "B:<baris>" = nama pengusul kolom B (dibawa turun);
  "SPECIAL:..." = pecahan kolom H multi-nama (lihat SPECIAL_H);
  None = kolom J dikosongkan (tidak boleh memakai nama website).
"""

import re
from pathlib import Path

REKAPAN_PATH = (
    Path.home() / "Downloads" / "REKAPAN PJUTS 2026 terbaru 14 Sept.xlsx"
)
REKAPAN_SHEET = "REKAPITULASI (2)"

# Kolom H yang memuat >1 nama -> dipecah eksplisit di sini.
# 19: 'H Akhmaoli (...) samsul (...)' ; 53: 'Rusdianto, SKM (...) Solihin (...)'
# 31: 'RT. 01. Jahir (...) RT. 06 Paino (...)' (per RT)
SPECIAL_H = {
    19: ["H Akhmaoli", "samsul"],
    31: {"1": "Jahir", "6": "Paino"},
    53: ["Rusdianto, SKM", "Solihin"],
}

# Tiap aturan: baris rekapan, kelompok survey (kab, desa), penyeleksi
# (rt / keyword / survey_nama / noket / tanpa penyeleksi = semua),
# take = batasi jumlah titik (urutan Nomor), name = nama kolom H
# (None = fallback ke nama survey; "H:<n>" = baca kolom H baris n).
RULES = [
    # ---- KOTA JAMBI ----
    dict(rekapan=[66], kab="KOTA JAMBI", desa=["BAGAN PETE"], name="B:66"),
    dict(rekapan=[38], kab="KOTA JAMBI", desa=["EKA JAYA"], rt=[7], name="H:38"),
    dict(rekapan=[42], kab="KOTA JAMBI", desa=["EKA JAYA"], rt=[14], name="H:42"),
    dict(rekapan=[43], kab="KOTA JAMBI", desa=["EKA JAYA"], rt=[29], name="H:43"),
    dict(rekapan=[45], kab="KOTA JAMBI", desa=["EKA JAYA"], rt=[34], name="H:45"),
    dict(rekapan=[39], kab="KOTA JAMBI", desa=["KENALI ASAM", "KENALI ASAM ATAS"],
         rt=[17], name="H:39"),
    dict(rekapan=[44], kab="KOTA JAMBI", desa=["KENALI ASAM ATAS"],
         rt=[1], keyword=["musholla"], name="H:44"),
    dict(rekapan=[92], kab="KOTA JAMBI", desa=["KENALI ASAM ATAS"],
         rt=[27], name="H:92"),
    dict(rekapan=[40, 101], kab="KOTA JAMBI", desa=["KASANG"], rt=[3], name="H:40"),
    dict(rekapan=[102], kab="KOTA JAMBI", desa=["KASANG"], rt=[5], name="H:102"),
    dict(rekapan=[41], kab="KOTA JAMBI", desa=["KENALI BESAR"], rt=[19], name="H:41"),
    dict(rekapan=[89], kab="KOTA JAMBI", desa=["KENALI BESAR"],
         keyword=["permata"], name="H:89"),
    dict(rekapan=[129], kab="KOTA JAMBI", desa=["KENALI BESAR"],
         noket=True, name="H:129"),
    dict(rekapan=[78], kab="KOTA JAMBI", desa=["PEMATANG SULUR"], rt=[17], name="H:78"),
    dict(rekapan=[79], kab="KOTA JAMBI", desa=["PEMATANG SULUR"], rt=[20], name="B:79"),
    dict(rekapan=[127], kab="KOTA JAMBI", desa=["TELANAIPURA"], name="H:127"),
    dict(rekapan=[80], kab="KOTA JAMBI", desa=["BULURAN KENALI"], rt=[15], name="H:80"),
    dict(rekapan=[81], kab="KOTA JAMBI", desa=["BULURAN KENALI"], rt=[10], name="H:81"),
    dict(rekapan=[82], kab="KOTA JAMBI", desa=["KENALI ASAM BAWAH"],
         survey_nama=["ir. daulat sitorus"], name="H:82"),
    dict(rekapan=[91], kab="KOTA JAMBI", desa=["KENALI ASAM BAWAH"],
         rt=[12], name="H:91"),
    dict(rekapan=[83], kab="KOTA JAMBI", desa=["BAKUNG JAYA"], name="H:83"),
    dict(rekapan=[84], kab="KOTA JAMBI", desa=["SIMPANG III SIPIN"], name="H:84"),
    dict(rekapan=[88], kab="KOTA JAMBI", desa=["TANJUNG SARI"], name="H:88"),
    dict(rekapan=[90], kab="KOTA JAMBI", desa=["SUNGAI ASAM"], name="H:90"),
    # survey tidak punya RT 10: titik RT 12 kedua menempati jatah baris 93
    dict(rekapan=[94], kab="KOTA JAMBI", desa=["TANJUNG PINANG"],
         rt=[12], take=1, name="H:94"),
    dict(rekapan=[93], kab="KOTA JAMBI", desa=["TANJUNG PINANG"],
         rt=[12], take=1, name="H:93"),
    dict(rekapan=[95], kab="KOTA JAMBI", desa=["TANJUNG PINANG"],
         rt=[13], name="H:95"),
    dict(rekapan=[96], kab="KOTA JAMBI", desa=["KASANG JAYA"], rt=[1], name="H:96"),
    dict(rekapan=[97], kab="KOTA JAMBI", desa=["KASANG JAYA"], rt=[2], take=1, name="H:97"),
    dict(rekapan=[99], kab="KOTA JAMBI", desa=["KASANG JAYA"], rt=[2], take=1, name="H:99"),
    dict(rekapan=[100], kab="KOTA JAMBI", desa=["KASANG JAYA"], rt=[2], take=1, name="H:100"),
    dict(rekapan=[98], kab="KOTA JAMBI", desa=["KASANG JAYA"], rt=[3], name="H:98"),
    dict(rekapan=[103], kab="KOTA JAMBI", desa=["SIJENJANG"], name="H:103"),
    dict(rekapan=[106], kab="KOTA JAMBI", desa=["TANJUNG RADEN"], name="H:106"),
    dict(rekapan=[128], kab="KOTA JAMBI", desa=["RAWA SARI"], name="H:128"),
    # ---- TEBO ----
    dict(rekapan=[34], kab="TEBO", desa=["PINTAS TUO"], name="H:34"),
    dict(rekapan=[35], kab="TEBO", desa=["EMBACANG GEDANG"], name="H:35"),
    dict(rekapan=[36], kab="TEBO", desa=["MANGUN JAYO"], name="H:36"),
    dict(rekapan=[37], kab="TEBO", desa=["TERITI"], name="H:37"),
    dict(rekapan=[49], kab="TEBO", desa=["BEDARO RAMPAK"], name="H:49"),
    dict(rekapan=[50], kab="TEBO", desa=["SEPAKAT BERSATU"], name="B:50"),
    dict(rekapan=[58], kab="TEBO", desa=["BETUNG BEDARAH"], name="H:58"),
    dict(rekapan=[59], kab="TEBO", desa=["RANTAU API"], name="H:59"),
    dict(rekapan=[60], kab="TEBO", desa=["AUR CINO"], name="H:60"),
    dict(rekapan=[61], kab="TEBO", desa=["TELUK KAYU PUTIH"], name="H:61"),
    # ---- BATANG HARI ----
    dict(rekapan=[6], kab="BATANG HARI", desa=["DURIAN LUNCUK"], name="H:6"),
    dict(rekapan=[7], kab="BATANG HARI", desa=["JANGGA BARU"], name="H:7"),
    dict(rekapan=[8], kab="BATANG HARI", desa=["OLAK BESAR"], name="H:8"),
    dict(rekapan=[9], kab="BATANG HARI", desa=["KARMEO"], name="H:9"),
    dict(rekapan=[10], kab="BATANG HARI", desa=["SIMPANG AUR GADING"], name="H:10"),
    dict(rekapan=[11], kab="BATANG HARI", desa=["SIMPANG TERUSAN"], name="H:11"),
    dict(rekapan=[12], kab="BATANG HARI", desa=["SUNGAI BULUH"], name="H:12"),
    dict(rekapan=[13], kab="BATANG HARI", desa=["MALAPARI"], name="H:13"),
    dict(rekapan=[14], kab="BATANG HARI", desa=["MUARA BULIAN"],
         keyword=["perumnas"], name="H:14"),
    dict(rekapan=[15], kab="BATANG HARI", desa=["MUARA BULIAN"],
         keyword=["pondok"], name="H:15"),
    # rekapan menulis RT 15 di Rengas Condong; survey menaruhnya di Teratai:
    # cocokkan via nomor RT
    dict(rekapan=[16], kab="BATANG HARI", desa=["TERATAI"], rt=[15], name="H:16"),
    dict(rekapan=[17], kab="BATANG HARI", desa=["RENGAS CONDONG"], rt=[14], name="H:17"),
    dict(rekapan=[20], kab="BATANG HARI", desa=["RENGAS CONDONG"], rt=[21], name="H:20"),
    dict(rekapan=[18], kab="BATANG HARI", desa=["TERATAI"],
         keyword=["mayang"], name="H:18"),
    dict(rekapan=[19], kab="BATANG HARI", desa=["TERATAI"], rt=[6], take=1,
         name="SPECIAL:19:0"),
    dict(rekapan=[19], kab="BATANG HARI", desa=["TERATAI"], rt=[6], take=1,
         name="SPECIAL:19:1"),
    dict(rekapan=[85], kab="BATANG HARI", desa=["TURE"],
         survey_nama=["sapuan ansori, s.e."], name="H:85"),
    dict(rekapan=[21], kab="BATANG HARI", desa=["TURE"],
         survey_nama=["m. hafiz"], name="H:21"),
    dict(rekapan=[86], kab="BATANG HARI", desa=["TELUK KETAPANG"], name="B:86"),
    dict(rekapan=[87], kab="BATANG HARI", desa=["PULAU BETUNG"], name="B:87"),
    # ---- MERANGIN ----
    dict(rekapan=[27], kab="MERANGIN", desa=["SALAM BUKU"], name="H:27"),
    dict(rekapan=[28], kab="MERANGIN", desa=["PEMATANG KANDIS"], name="H:28"),
    dict(rekapan=[29], kab="MERANGIN", desa=["DUSUN BANGKO"], name="H:29"),
    dict(rekapan=[53], kab="MERANGIN", desa=["PAMENANG"], take=2, name="SPECIAL:53:0"),
    dict(rekapan=[53], kab="MERANGIN", desa=["PAMENANG"], take=2, name="SPECIAL:53:1"),
    dict(rekapan=[54], kab="MERANGIN", desa=["KEROYA"], name="H:54"),
    dict(rekapan=[55], kab="MERANGIN", desa=["TANJUNG GEDANG"], name="H:55"),
    dict(rekapan=[56], kab="MERANGIN", desa=["LIMBUR"], name="H:56"),
    dict(rekapan=[57], kab="MERANGIN", desa=["PAPIT"], name="H:57"),
    dict(rekapan=[124], kab="MERANGIN", desa=["MUARA SIAU"],
         survey_nama=["gm geopark merangin"], name=None),
    dict(rekapan=[125], kab="MERANGIN", desa=["MUARA SIAU", "SUNGAI ULAS"],
         survey_nama=["agus zainuddin"], name="B:125"),
    dict(rekapan=[122], kab="MERANGIN", desa=["TALANG PARUH"], name=None),
    dict(rekapan=[123], kab="MERANGIN", desa=["TUO"], name=None),
    dict(rekapan=[126], kab="MERANGIN", desa=["SEKANCING"], name="B:126"),
    # ---- TANJAB TIMUR ----
    dict(rekapan=[30], kab="TANJUNG JABUNG TIMUR", desa=["LAMBUR I"], name="H:30"),
    dict(rekapan=[31], kab="TANJUNG JABUNG TIMUR", desa=["MUARA SABAK ILIR"],
         rt=[1], name="SPECIAL:31:1"),
    dict(rekapan=[31], kab="TANJUNG JABUNG TIMUR", desa=["MUARA SABAK ILIR"],
         rt=[6], name="SPECIAL:31:6"),
    dict(rekapan=[107, 108, 109, 110, 111, 112], kab="TANJUNG JABUNG TIMUR",
         desa=["MANUNGGAL MAKMUR", "MAJELIS HIDAYAH", "TELUK MAJELIS",
               "KUALA LAGAN", "KAMPUNG LAUT", "TANJUNG SOLOK"], name=None),
    # ---- SAROLANGUN ----
    dict(rekapan=[22], kab="SAROLANGUN", desa=["PAYO LEBAR"], name="H:22"),
    dict(rekapan=[23], kab="SAROLANGUN", desa=["SILIWANGI"], name="H:23"),
    dict(rekapan=[121], kab="SAROLANGUN", desa=["BATU EMPANG"], name="B:121"),
    # ---- KERINCI ----
    dict(rekapan=[72], kab="KERINCI", desa=["KOTO BERINGIN"], name="H:72"),
    dict(rekapan=[73], kab="KERINCI", desa=["DEMONG SAKTI"], name="H:73"),
    dict(rekapan=[74], kab="KERINCI", desa=["PASAR SENEN"], name="H:74"),
    dict(rekapan=[75], kab="KERINCI", desa=["KOTO ARO"], name="H:75"),
    dict(rekapan=[76], kab="KERINCI", desa=["SIULAK DERAS MUDIK"], name="H:76"),
    dict(rekapan=[113], kab="KERINCI", desa=["TALANG TINGGI"], name=None),
    dict(rekapan=[114], kab="KERINCI", desa=["MUKAI TINGGI"], name=None),
    dict(rekapan=[115], kab="KERINCI", desa=["KOTO LUAR"], name=None),
    dict(rekapan=[116], kab="KERINCI", desa=["KEMANTAN MUDIK"], name=None),
    dict(rekapan=[117], kab="KERINCI", desa=["KOTO DUA LAMA"], name=None),
    dict(rekapan=[118], kab="KERINCI", desa=["HAMPARAN PUGU"], name=None),
    dict(rekapan=[119], kab="KERINCI", desa=["TELUN BERASAP"], name=None),
    dict(rekapan=[120], kab="KERINCI", desa=["JERNIH JAYA"], name=None),
    dict(rekapan=[70], kab="KERINCI", desa=["BANDAR SEDAP"], name="H:70"),
    dict(rekapan=[71], kab="KERINCI", desa=["DUSUN DALAM"], name="H:71"),
    dict(rekapan=[69], kab="KERINCI", desa=["SIULAK GEDANG"], name="H:69"),
    dict(rekapan=[68], kab="KERINCI", desa=["TELAGO BIRU"], name="H:68"),
    # ---- TANJAB BARAT ----
    dict(rekapan=[24], kab="TANJUNG JABUNG BARAT", desa=["KEMUNING"], name="H:24"),
    dict(rekapan=[25], kab="TANJUNG JABUNG BARAT", desa=["SUNGAI LANDAK"],
         take=5, name="H:25"),
    dict(rekapan=[26], kab="TANJUNG JABUNG BARAT", desa=["SUNGAI LANDAK"],
         take=5, name="H:26"),
    dict(rekapan=[63], kab="TANJUNG JABUNG BARAT", desa=["DUSUN KEBUN"], name="H:63"),
    dict(rekapan=[64], kab="TANJUNG JABUNG BARAT", desa=["SUNGAI KAYU ARO"],
         name="H:64"),
    dict(rekapan=[65], kab="TANJUNG JABUNG BARAT", desa=["TEBING TINGGI"], name="H:65"),
    # ---- BUNGO ----
    dict(rekapan=[51], kab="MUARO BUNGO", desa=["LUBUK LANDAI"], name="H:51"),
    dict(rekapan=[52], kab="MUARO BUNGO", desa=["TANAH TUMBUH", "LUBUK NIUR"],
         name="H:52"),
    dict(rekapan=[62], kab="MUARO BUNGO", desa=["TANAH BEKALI"], name="H:62"),
    # ---- MUARO JAMBI ----
    dict(rekapan=[67], kab="MUARO JAMBI", desa=["PEMATANG GAJAH"], name="H:67"),
    dict(rekapan=[77], kab="MUARO JAMBI", desa=["PELEMPANG", "TEMPINO"], name="H:77"),
    dict(rekapan=[46], kab="MUARO JAMBI", desa=["UNIT 2"], name="H:46"),
    dict(rekapan=[47], kab="MUARO JAMBI", desa=["UNIT 5"], name="H:47"),
    dict(rekapan=[48], kab="MUARO JAMBI", desa=["SUKA DAMAI"], name="H:48"),
]

RT_RE = re.compile(r"\bRT\.?\s*0*(\d+)", re.IGNORECASE)
PHONE_RE = re.compile(r"\(?0\d[\d\s]*\)?")


def norm(text):
    return re.sub(r"\s+", " ", (text or "").strip().lower())


def extract_rt(keterangan):
    found = RT_RE.search(keterangan or "")
    return int(found.group(1)) if found else None


def extract_name(cell):
    """Nama dari kolom H: buang nomor HP. Kembalikan None bila tak ada nama."""
    if cell is None:
        return None
    text = str(cell).strip()
    if not text:
        return None
    if norm(text) in ("ba tidak ada", "ba ada blum scan"):
        return None
    text = PHONE_RE.sub("", text)
    text = re.sub(r"\s{2,}", " ", text).strip(" ,;")
    return text or None


def load_rekapan(path=REKAPAN_PATH):
    import openpyxl

    wb = openpyxl.load_workbook(path, read_only=True)
    ws = wb[REKAPAN_SHEET]
    data = {}
    carry_b = None
    for row in range(6, ws.max_row + 1):
        a = ws.cell(row, 1).value
        if isinstance(a, str):
            continue  # judul seksi / jumlah
        lokasi = ws.cell(row, 3).value
        if lokasi is None or str(lokasi).strip() == "":
            continue
        b = ws.cell(row, 2).value
        if b is not None and str(b).strip() != "":
            carry_b = str(b).strip()
        units = ws.cell(row, 5).value
        data[row] = {
            "units": units if isinstance(units, int) else 0,
            "h": ws.cell(row, 8).value,
            "b": carry_b,
        }
    wb.close()
    return data


def resolve_name(spec, rekapan):
    if spec is None:
        return "", "kosong"
    if spec.startswith("H:"):
        return extract_name(rekapan[int(spec[2:])]["h"]), "rekapan-H"
    if spec.startswith("B:"):
        return rekapan[int(spec[2:])]["b"], "rekapan-B"
    kind, row, idx = spec.split(":")
    assert kind == "SPECIAL"
    entry = SPECIAL_H[int(row)]
    name = entry[int(idx)] if isinstance(entry, list) else entry[idx]
    return name, "rekapan-H-khusus"


def assign_names(points, rekapan_path=REKAPAN_PATH):
    """Isi p['nama'] tiap titik. Kembalikan laporan verifikasi per aturan."""
    rekapan = load_rekapan(rekapan_path)
    by_group = {}
    for pos, point in enumerate(points):
        key = (point["kab"], point["desa_key"].upper())
        by_group.setdefault(key, []).append((pos, point))
    for key in by_group:
        by_group[key].sort(key=lambda item: item[1]["nomor"])

    report = []
    for rule in RULES:
        name, source = resolve_name(rule["name"], rekapan)
        cands = []
        for desa in rule["desa"]:
            cands.extend(by_group.get((rule["kab"], desa), []))
        matched = []
        for pos, point in cands:
            if point.get("_rekapan_done"):
                continue
            if "rt" in rule or "keyword" in rule or "survey_nama" in rule \
                    or rule.get("noket"):
                hit = False
                if "rt" in rule and extract_rt(point.get("ket_raw")) in rule["rt"]:
                    hit = True
                ket_norm = norm(point.get("ket_raw"))
                if "keyword" in rule and any(
                        k in ket_norm for k in rule["keyword"]):
                    hit = True
                if "survey_nama" in rule and norm(point["nama"]) in rule["survey_nama"]:
                    hit = True
                if rule.get("noket") and not (point.get("ket_raw") or "").strip():
                    hit = True
                if not hit:
                    continue
            matched.append((pos, point))
        if "take" in rule:
            matched = matched[:rule["take"]]
        for _pos, point in matched:
            point["nama"] = name or ""
            point["_rekapan_done"] = rule["rekapan"]
        want = sum(rekapan[r]["units"] for r in rule["rekapan"])
        report.append({
            "rekapan": rule["rekapan"],
            "kab": rule["kab"],
            "desa": rule["desa"],
            "name": name or "(kosong)",
            "source": source,
            "dapat": len(matched),
            "minta": want,
            "ok": True,  # dihitung gabungan per baris di bawah
        })

    # verifikasi gabungan: tiap baris rekapan harus genap dengan DISETUJUI
    # (aturan yang berbagi baris, mis. 19a+19b, dihitung bersama)
    from collections import defaultdict

    got = defaultdict(int)
    for entry in report:
        got[tuple(sorted(entry["rekapan"]))] += entry["dapat"]
    bad_sets = set()
    for key, dapat in got.items():
        if dapat != sum(rekapan[r]["units"] for r in key):
            bad_sets.add(key)
    for entry in report:
        entry["ok"] = tuple(sorted(entry["rekapan"])) not in bad_sets

    unassigned = [p for p in points if not p.get("_rekapan_done")]
    leftover = {}
    for point in unassigned:
        leftover.setdefault(
            (point["kab"], point["desa_key"].upper()), []).append(point["nomor"])
    return report, leftover
