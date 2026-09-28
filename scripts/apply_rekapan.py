#!/usr/bin/env python3
"""Write each point's "Lokasi Rekapan" -- the LOKASI TITIK line of the
allocation sheet it was granted under -- into points.geojson.

Source: REKAPAN PJUTS 2026 terbaru 31 agustus.xlsx, sheet REKAPITULASI
(110 lines, 500 units). Field crews find a point by that line, so the map
shows it verbatim as the point's title, abbreviations included ("Sei.",
"Simp.", "Ma. Bulian"): a tidier spelling would be one they cannot find.

A point is matched on pengusul + desa (the Nomor's third segment). Where one
pengusul holds several lines inside a single desa, the survey's RT in
Keterangan picks the line; Sungai Landak has no Keterangan, and its two
clusters were told apart by the "RT 12" / "RT 07" name on the photo stamps.

Places where the sheet and the survey tell different stories are kept as the
sheet says and listed in MISMATCHES; the survey's own words stay in
Keterangan, which the map shows under the title.

Cadangan points take the line of the desa they sit in. The Bupati Kerinci
reserves at Tebing Tinggi and Senimpik have no line and keep their survey
title. Run after normalize_attributes.py; it stops on a line that matches no
point, or a point that matches two lines.

    ./scripts/apply_rekapan.py
"""

import io
import json
import re
import sys

DATA_PATH = "data/points.geojson"
FIELD = "Lokasi Rekapan"

HAFIZ = "M. Hafiz"
SAMSUL = "Samsul Riduan, S.T."
FAIZAL = "Dr. Faizal Riza, S.T., M.M."
FAUZI = "Dr. Ir. H. Ahmad Fauzi Ansori, M.T."
YUDI = "Yudi Hariyanto, EY"
MAZLAN = "Mazlan, S.Kom., M.E."
ANSORI = "ANSORI, S.Fil.i"
YULI = "Hj. Yuli Yuliarti, S.E., M.M."
RIRIN = "Ririn Novianty, S.E."
EKA = "Hj. EKA MADJID MUAZ, S.E., M.H"
HAMBALI = "Hambali"
SYAFARUDDIN = "Syafaruddin"
MUSTAHARUDDIN = "Mustaharuddin, S.E."
JAHFAR = "Ahmad Jahfar, S.H."
ARWIYANTO = "Arwiyanto, S.E."
DAULAT = "Ir. Daulat Sitorus"
SAPUAN = "Sapuan Ansori, S.E."
PUTRA = "Putra Absor Hasibuan, S.H."
BUPATI_TANJAB = "Bupati Tanjab Timur"
BUPATI_KERINCI = "Bupati Kerinci"
GEOPARK = "GM Geopark Merangin"

# (pengusul, desa, rule, LOKASI TITIK). rule narrows within the desa: a
# regex on Keterangan, or a set of Nomor serials. None takes the whole desa.
REKAPAN = [
    # A. KETUA / MASYARAKAT
    (HAFIZ, "DURIAN LUNCUK", None, "Durian Luncuk, Kec. Batin XXIV"),
    (HAFIZ, "JANGGA BARU", None, "Jangga Baru, Kec. Batin XXIV"),
    (HAFIZ, "OLAK BESAR", None, "Olak Besar, Kec. Batin XXIV"),
    (HAFIZ, "KARMEO", None, "Karmeo, Kec. Batin XXIV"),
    (HAFIZ, "SIMPANG AUR GADING", None, "Desa Simp. Aur Gading, Kec. Batin XXIV"),
    (HAFIZ, "SIMPANG TERUSAN", None, "Pesantren Al-Muhajirin Desa Tenam, Kec. Muara Bulian"),
    (HAFIZ, "SUNGAI BULUH", None, "RT 10 Desa Sei. Bulu, Kec. Muara Bulian"),
    (HAFIZ, "MALAPARI", None, "Desa Malapari, Kec. Muara Bulian"),
    (HAFIZ, "MUARA BULIAN", r"perumnas", "RT 16 Kel. Ma. Bulian (Perumnas)"),
    (HAFIZ, "MUARA BULIAN", r"pondok", "Perumahan Pondok Indah RT 36, Kec. Muara Bulian"),
    (HAFIZ, "TERATAI", r"^rt 15\b", "RT 15 RW 07 Kel. Rengas Condong, Kec. Muara Bulian"),
    (HAFIZ, "RENGAS CONDONG", r"^rt 14\b", "RT 14 RW 03 Kel. Rengas Condong, Kec. Muara Bulian"),
    (HAFIZ, "TERATAI", r"mayang mangurai", "RT 11 Kel. Teratai (Mayang Mangurai), Kec. Muara Bulian"),
    (HAFIZ, "TERATAI", r"^rt 06\b", "RT 06 RW 02 Kel. Teratai, Kec. Muara Bulian"),
    (HAFIZ, "RENGAS CONDONG", r"^rt 21\b", "RT 21 Rengas Condong, Kec. Muara Bulian"),
    (HAFIZ, "TURE", None, "Desa Ture, Kec. Pemayung"),
    (SAMSUL, "PAYO LEBAR", None, "Desa Payo Lebar, Kec. Singkut"),
    (SAMSUL, "SILIWANGI", None, "Desa Siliwangi, Kec. Singkut"),
    (FAIZAL, "KEMUNING", None, "RT 02 Desa Kemuning, Kec. Bram Hitam"),
    (FAIZAL, "SUNGAI LANDAK", {"006", "007", "008", "009", "010"},
     "Parit 5 RT 07 Desa Sungai Landak, Kec. Senyerang"),
    (FAIZAL, "SUNGAI LANDAK", {"001", "002", "003", "004", "005"},
     "Parit 1 RT 12 Desa Sungai Landak, Kec. Senyerang"),
    (FAUZI, "SALAM BUKU", None, "Desa Salam Buku, Kec. Batang Basumai"),
    (FAUZI, "PEMATANG KANDIS", None, "Kel. Pematang Kandis, Kec. Bangko"),
    (FAUZI, "DUSUN BANGKO", None, "Kel. Dusun Bangko, Kec. Bangko"),
    (YUDI, "LAMBUR I", None, "Desa Lambur I, Kec. Muara Sabak Timur"),
    (YUDI, "MUARA SABAK ILIR", None, "RT 01, RT 06, RW 03, Kel. Muara, Kec. Sabak Timur"),
    # B. KOMISI III / MASYARAKAT
    (MAZLAN, "PINTAS TUO", None, "RT 10 Dusun V Lingkar Nago Desa Pintas Tuo, Kec. Muara Tabir"),
    (MAZLAN, "EMBACANG GEDANG", None, "RT 02 Desa Embacang Gedang, Kec. Muara Tabir"),
    (ANSORI, "MANGUN JAYO", None, "Desa Mangun Jayo, Kec. Tebo Tengah"),
    (ANSORI, "TERITI", None, "Desa Teriti, Kec. Sumay"),
    (YULI, "EKA JAYA", r"^rt 07\b", "RT 07, Kel. Eka Jaya"),
    (YULI, "KENALI ASAM ATAS", r"^rt 17\b", "RT 17, Kel. Kenali Asam, Kec. Kota Baru"),
    (YULI, "KASANG", None, "RT 03, Kel. Kasang, Kec. Jambi Timur"),
    (YULI, "KENALI BESAR", None, "RT 19, Kel. Kenali Besar, Kec. Alam Barajo"),
    (YULI, "EKA JAYA", r"^rt 14\b", "RT 14 Eka Jaya"),
    (YULI, "EKA JAYA", r"^rt 29\b", "RT 29 Eka Jaya"),
    (YULI, "KENALI ASAM ATAS", r"^rt 01\b|permata", "RT 01 Kenali Asam Atas (Perum De Permata)"),
    (YULI, "EKA JAYA", r"^rt 34\b", "RT 34, Kel. Eka Jaya"),
    (RIRIN, "UNIT 2", None, "Sungai Bahar Unit 2 (Desa Marga Mulya)"),
    (RIRIN, "UNIT 5", None, "Sungai Bahar Unit 5 (Desa Panca Bakti)"),
    (RIRIN, "DESA SUKA DAMAI", None, "Desa Suka Damai (Mestong)"),
    (EKA, "BEDARO RAMPAK", None, "Desa Bedaro Rampak, Kec. Tebo Tengah"),
    (EKA, "SEPAKAT BERSATU", None, "Desa Sepakat Bersatu"),
    (HAMBALI, "LUBUK LANDAI", None, "Desa Lubuk Landai, Kec. Sepenggal Lintas"),
    (HAMBALI, "TANAH TUMBUH", None, "Kec. Tanah Tumbuh"),
    (HAMBALI, "LUBUK NIUR", None, "Kec. Tanah Tumbuh"),
    (SYAFARUDDIN, "PAMENANG", None, "Kel. Pamenang"),
    (SYAFARUDDIN, "KEROYA", None, "Desa Keroya"),
    (SYAFARUDDIN, "TANJUNG GEDANG", None, "Desa Tanjung Gedang"),
    (SYAFARUDDIN, "LIMBUR", None, "Limbur Merangin"),
    (SYAFARUDDIN, "PAPIT", None, "Desa Papit"),
    (MUSTAHARUDDIN, "BETUNG BEDARAH", None, "Desa Betung Berdarah Barat, Kec. Tebo Ilir"),
    (MUSTAHARUDDIN, "RANTAU API", None, "Desa Rantau Api, Kec. Tengah Ilir"),
    (MUSTAHARUDDIN, "AUR CINO", None, "Desa Aur Cino, Kec. VII Koto"),
    (MUSTAHARUDDIN, "TELUK KAYU PUTIH", None, "Desa Teluk Kayu Putih, Kec. VII Koto"),
    (MUSTAHARUDDIN, "TANAH BEKALI", None, "Desa Tanah Bekali, Kec. Tanah Sepenggal"),
    (JAHFAR, "DUSUN KEBUN", None, "Kel. Dusun Kebun, Kec. Batang Asam"),
    (JAHFAR, "SUNGAI KAYU ARO", None, "Parit 6 RT 10 Desa Sei. Kayu Aro, Kec. Senyerang"),
    (JAHFAR, "TEBING TINGGI", None,
     "Jalan 500 Teluk Pulai RT 27 Teluk Pengkah, Kec. Tebing Tinggi"),
    (JAHFAR, "BAGAN PETE", None, "RT 07 Bagan Pete"),
    (JAHFAR, "PEMATANG GAJAH", None, "Perumahan Arza 2 Pematang Gajah RT 17"),
    (ARWIYANTO, "TELAGO BIRU", None, "Desa Telago Biru"),
    (ARWIYANTO, "SIULAK GEDANG", None, "Desa Siulak Gedang"),
    (ARWIYANTO, "BANDAR SEDAP", None, "Desa Bandar Sedap"),
    (ARWIYANTO, "DUSUN DALAM", None, "Desa Dusun Dalam"),
    (ARWIYANTO, "KOTO BERINGIN", None, "Desa Koto Beringin"),
    (ARWIYANTO, "DEMONG SAKTI", None, "Desa Demong Sakti"),
    (ARWIYANTO, "PASAR SENEN", None, "Desa Pasar Senen"),
    (ARWIYANTO, "KOTO ARO", None, "Desa Koto Aro"),
    (ARWIYANTO, "SIULAK DERAS MUDIK", None, "Siulak Deras Mudik"),
    (DAULAT, "PELEMPANG", None, "Distrik Center HKBP Jambi, Desa Pelempang, Kec. Mestong"),
    (DAULAT, "TEMPINO", None, "Distrik Center HKBP Jambi, Desa Pelempang, Kec. Mestong"),
    (DAULAT, "PEMATANG SULUR", r"^rt 17\b", "RT 017 Pematang Sulur, Kec. Telanaipura"),
    (DAULAT, "PEMATANG SULUR", r"^rt 20\b", "RT 020 Pematang Sulur, Kec. Telanaipura"),
    (DAULAT, "BULURAN KENALI", r"^rt 15\b", "RT 015 Buluran Kenali, Kec. Telanaipura"),
    (DAULAT, "BULURAN KENALI", r"^rt 10\b", "RT 010 Buluran Kenali, Kec. Telanaipura"),
    (DAULAT, "KENALI ASAM BAWAH", None, "RT 018 Kenali Asam Bawah, Kec. Kota Baru"),
    (DAULAT, "BAKUNG JAYA", None, "RT 001 Bakung Jaya, Kec. Paal Merah"),
    (DAULAT, "SIMPANG III SIPIN", None, "RT 029 Simpang III Sipin, Kec. Kota Baru"),
    (SAPUAN, "TURE", None, "Desa Ture, Kec. Pemayung"),
    (SAPUAN, "TELUK KETAPANG", None, "RT 001 dan RT 004 Desa Teluk Ketapang, Kec. Pemayung"),
    (SAPUAN, "PULAU BETUNG", None, "RT 008, RT 002, RT 006 Desa Pulau Betung, Kec. Pemayung"),
    (PUTRA, "TANJUNG SARI", None, "RT 23 Tanjung Sari, Kec. Jambi Timur"),
    (PUTRA, "KENALI BESAR", None,
     "RT 07 Perumahan Permata Kenali, Kel. Kenali Besar, Kec. Alam Barajo"),
    (PUTRA, "SUNGAI ASAM", None, "RT 14, Kel. Sungai Asam, Kec. Pasar Jambi"),
    (PUTRA, "KENALI ASAM BAWAH", None, "RT 12 Kenali Asam Bawah, Kec. Kota Baru"),
    (PUTRA, "KENALI ASAM ATAS", r"^rt 12\b", "RT 12 Kenali Asam Bawah, Kec. Kota Baru"),
    (PUTRA, "KENALI ASAM ATAS", r"^rt 27\b", "RT 27, Kel. Kenali Asam, Kec. Kota Baru"),
    (PUTRA, "TANJUNG PINANG", r"^rt 10\b", "RT 10 Tanjung Pinang, Kec. Jambi Timur"),
    (PUTRA, "TANJUNG PINANG", r"^rt 12\b", "RT 12 Tanjung Pinang, Kec. Jambi Timur"),
    (PUTRA, "TANJUNG PINANG", r"^rt 13\b", "RT 13 Tanjung Pinang, Kec. Jambi Timur"),
    (PUTRA, "KASANG JAYA", r"^rt 01\b", "RT 01 Kasang Jaya, Kec. Jambi Timur"),
    (PUTRA, "KASANG JAYA", r"^rt 02\b", "RT 02 Kasang Jaya, Kec. Jambi Timur"),
    (PUTRA, "KASANG JAYA", r"^rt 03\b", "RT 03 Kasang Jaya, Kec. Jambi Timur"),
    (PUTRA, "KASANG JAYA", r"^rt 05\b", "RT 05 Kasang Jaya, Kec. Jambi Timur"),
    (PUTRA, "KASANG JAYA", r"^rt 15\b", "RT 15 Kasang Jaya, Kec. Jambi Timur"),
    (PUTRA, "KASANG", r"^rt 03\b", "RT 03 Kasang, Kec. Jambi Timur"),
    (PUTRA, "KASANG", r"^rt 05\b", "RT 05 Kasang, Kec. Jambi Timur"),
    (PUTRA, "SIJENJANG", None, "RT 06 Sijenjang, Kec. Jambi Timur"),
    # C. GUBERNUR / MASYARAKAT
    ("Ning Hasyim", "TANJUNG RADEN", None, "RT 04 Tanjung Raden, Kec. Danau Teluk"),
    (BUPATI_TANJAB, "MANUNGGAL MAKMUR", None, "Desa Manunggal Makmur"),
    (BUPATI_TANJAB, "MAJELIS HIDAYAH", None, "Desa Majelis Hidayah"),
    (BUPATI_TANJAB, "TELUK MAJELIS", None, "Desa Teluk Majelis"),
    (BUPATI_TANJAB, "KUALA LAGAN", None, "Desa Kuala Lagan"),
    (BUPATI_TANJAB, "KAMPUNG LAUT", None, "Kel. Kampung Laut"),
    (BUPATI_TANJAB, "TANJUNG SOLOK", None, "Kel. Tanjung Solok"),
    (BUPATI_KERINCI, "TALANG TINGGI", None, "Desa Talang Tinggi, Kec. Siulak Mukai"),
    (BUPATI_KERINCI, "MUKAI TINGGI", None, "Desa Mukai Tinggi, Kec. Siulak Mukai"),
    (BUPATI_KERINCI, "KOTO LUAR", None, "Desa Koto Luar, Kec. Siulak Mukai"),
    (BUPATI_KERINCI, "KEMANTAN MUDIK", None, "Desa Kemantan Mudik, Kec. Air Hangat"),
    (BUPATI_KERINCI, "KOTO DUA LAMA", None, "Desa Koto Dua Lama, Kec. Air Hangat"),
    (BUPATI_KERINCI, "HAMPARAN PUGU", None, "Desa Hamparan Pugu, Kec. Air Hangat"),
    (BUPATI_KERINCI, "TELUN BERASAP", None, "Desa Telun Barasap, Kec. Gunung Tujuh"),
    (BUPATI_KERINCI, "JERNIH JAYA", None, "Desa Jernih Jaya, Kec. Gunung Tujuh"),
    ("Gubernur Jambi", "BATU EMPANG", None, "Dusun Seladi Desa Batu Empang, Kec. Batang Asai"),
    (GEOPARK, "TALANG PARUH", None, "Desa Talang Paruh, Kec. Lembah Masurai"),
    (GEOPARK, "TUO", None, "Desa Tuo, Kec. Lembah Masurai"),
    (GEOPARK, "MUARA SIAU", None, "Muara Siau, Kec. Muara Siau"),
    ("Agus Zainuddin", "MUARA SIAU", None, "Desa Muara Siau, Kec. Muara Siau"),
    ("Agus Zainuddin", "SUNGAI ULAS", None, "Desa Muara Siau, Kec. Muara Siau"),
    ("Roni Paslah, SE, MM", "SEKANCING", None,
     "Desa Sekancing, Kec. Tiang Pumpung (RT 001 s.d. RT 006)"),
    ("RT 09 Telanaipura", "TELANAIPURA", None, "RT 09, Kel. Pematang Sulur, Kec. Telanaipura"),
    ("Ketua RT 21", "RAWA SARI", None, "RT 21, Kel. Rawasari, Kec. Alam Barajo"),
    ("Amin ADC", "KENALI BESAR", None,
     "Perumahan Javana City Light Part 3 Blok Q, Kel. Kenali Besar, Kec. Alam Barajo"),
]

# Where the sheet names a place the survey did not find. Kept as the sheet
# says -- it is what the crew searches for -- and reported on every run.
MISMATCHES = [
    "Sungai Buluh: sheet RT 10, survey RT 19",
    "Teratai RT 15 (survey) sits under the sheet's RT 15 RW 07 Kel. Rengas Condong",
    "Unit 2: sheet Desa Marga Mulya, survey Desa Suka Maju",
    "Perumnas Muara Bulian: sheet RT 16; Pondok Berlian Indah: sheet Pondok Indah RT 36",
    "Pematang Gajah: sheet Arza 2 RT 17, survey Azra 2 RT 07",
    "Kemuning: sheet Kec. Bram Hitam, survey Kec. Bram Itam",
    "Tebing Tinggi (Tanjab Barat): sheet Teluk Pengkah, survey Dusun Teluk Bengkah",
]


def desa_of(nomor):
    parts = nomor.split("-")
    return "-".join(parts[2:-1]).upper()


def serial_of(nomor):
    return nomor.split("-")[-1]


def rule_matches(rule, props):
    if rule is None:
        return True
    if isinstance(rule, set):
        return serial_of(props["Nomor"]) in rule
    keterangan = re.sub(r"\s+", " ", (props.get("Keterangan") or "").strip().lower())
    keterangan = re.sub(r"^rt[\s.]*(\d+)", lambda m: "rt %02d" % int(m.group(1)), keterangan)
    return re.search(rule, keterangan) is not None


def main():
    with io.open(DATA_PATH, encoding="utf-8") as handle:
        data = json.load(handle)

    used = set()
    unmatched = []
    for feature in data["features"]:
        props = feature["properties"]
        desa = desa_of(props["Nomor"])
        hits = [i for i, (pengusul, rdesa, rule, _) in enumerate(REKAPAN)
                if pengusul == props.get("Nama Anggota") and rdesa == desa
                and rule_matches(rule, props)]
        if len(hits) > 1:
            print("ERROR: %s cocok ke %d baris rekapan" % (props["Nomor"], len(hits)))
            return 1
        if hits:
            props[FIELD] = REKAPAN[hits[0]][3]
            used.add(hits[0])
        else:
            props.pop(FIELD, None)
            unmatched.append(props["Nomor"])

    unused = [REKAPAN[i] for i in range(len(REKAPAN)) if i not in used]
    if unused:
        print("ERROR: baris rekapan tanpa titik:")
        for row in unused:
            print("  %s | %s | %s" % (row[0], row[1], row[3]))
        return 1

    out = json.dumps(data, separators=(",", ":"), ensure_ascii=False)
    io.open(DATA_PATH, "w", encoding="utf-8", newline="\n").write(out)

    print("Titik diberi Lokasi Rekapan: %d" % (len(data["features"]) - len(unmatched)))
    print("Titik tanpa baris rekapan:   %d" % len(unmatched))
    for nomor in unmatched:
        print("  %s" % nomor)
    print("Beda rekapan vs survei (rekapan dipakai):")
    for line in MISMATCHES:
        print("  %s" % line)
    return 0


if __name__ == "__main__":
    sys.exit(main())
