# Peta Sebaran PUTS 2026 — Provinsi Jambi

Peta web satu halaman berisi titik survei **Penerangan Umum Tenaga Surya (PUTS)**
tahun 2026 untuk Dinas ESDM Provinsi Jambi. Setiap titik membawa foto survei awal,
koordinat GPS, pengusul, dan baris "Lokasi Rekapan" dari lembar alokasi, sehingga
tim lapangan bisa mencari lokasi dan langsung membuka rute di Google Maps.

Antarmuka publik memakai **Svelte 5, TypeScript, Vite, dan OpenLayers 10.7.0**.
Hasil build berupa situs statis di `dist/public/`, dilayani Caddy. Data survei tetap
berasal dari snapshot GeoJSON yang diterbitkan backend Django/PostgreSQL. Admin
produksi tersedia di **https://survey.esdm.cloud/admin/**; peta publik di
**https://survey.esdm.cloud/**. Foto asli disimpan di bucket privat, dan peta
hanya menerima foto turunan yang sudah diterbitkan.

## Mulai cepat

Prasyarat: **Node.js 24** dan npm. Python 3 hanya diperlukan untuk alat data lama.

```bash
npm ci
npm run dev
```

Buka `http://127.0.0.1:8123/`. Vite memakai port tetap dan melaporkan jika port itu
sudah dipakai. Peta development mengambil GeoJSON terbitan dan foto melalui
produksi, sehingga mengikuti perubahan yang diterbitkan admin. Build preview dan
halaman legacy tetap memakai snapshot lokal.

```bash
npm run check
npm run build
npm test
npx playwright install chromium webkit firefox
npm run test:e2e
```

Tes browser menggunakan hasil build di port 8124 serta fixture lifecycle di port
8127. Untuk menguji header produksi, jalankan Caddy dengan `PUBLIC_ROOT` mengarah
ke `dist/public`, lalu set `PUBLIC_TEST_URL` ke URL Caddy sebelum menjalankan tes.
Lihat [catatan validasi](docs/superpowers/validation/2026-10-08-public-map-modernization.md).

Alur lama tetap tersedia lewat `npm run dev:legacy`, lalu buka
`http://127.0.0.1:8123/legacy.html`. Hentikan Vite terlebih dahulu karena kedua
server memakai port 8123. Peluncur CommonJS tetap mencari Python yang tersedia.

## Fitur

- Daftar titik di sidebar (desktop) / bottom sheet (mobile), dikelompokkan per
  kabupaten lalu kecamatan. Kabupaten ditentukan lewat *point-in-polygon* terhadap
  batas wilayah BIG saat runtime, bukan dari atribut.
- Pencarian teks dan pencarian pasangan koordinat (dengan toleransi).
- Filter status, popup detail berfoto, dan tautan rute Google Maps.
- Dua peta dasar satelit: Google (default, hingga z21) dan Esri (cadangan, dibatasi
  z18). Alasannya ada di [docs/basemaps.md](docs/basemaps.md).
- **Editor flag lokal pada halaman legacy**: di `localhost`/`127.0.0.1`, popup menampilkan tombol untuk
  menandai titik sebagai `cadangan` atau `duplikat`. Tombol ini memanggil
  `POST /api/flag` di dev server yang menulis langsung ke `data/points.geojson`.
  Endpoint ini tidak ada dalam antarmuka publik baru maupun hasil build produksi.

## Struktur proyek

```
src/shared/survey/       Tipe, status, koordinat, pencarian, dan aturan tampilan
src/public/data/         Validasi GeoJSON, pemuatan, dan penentuan wilayah
src/public/state/        State Svelte dan gesture bottom sheet
src/public/map/          Adapter OpenLayers, simbol, label, hover, dan kontrol
src/public/components/   Sidebar, daftar, popup, layer, dan petunjuk mobile
src/public/styles/       CSS antarmuka; urutan cascade lama dipertahankan
scripts/build-public-assets.mjs  Allowlist aset publik dan konversi batas
vite.public.config.mts  Build publik tunggal; tanpa source map produksi
tests/                  Tes aturan data, artefak, browser, dan lifecycle
data/points.geojson     Data titik survei — sumber kebenaran tahap statis
images/                 Foto survei asli; tidak diubah dalam migrasi ini
legacy.html, custom.*   Antarmuka lama untuk alat lokal dan rollback
layers/, styles/, resources/  Ekspor QGIS lama, tidak diterbitkan sebagai JS
```

Svelte mengelola antarmuka dan state; adapter OpenLayers mengelola peta serta
pembersihan listener/overlay. Kode baru memakai import eksplisit, tanpa map global
atau ketergantungan pada urutan script legacy.

## Model data

Setiap fitur di `data/points.geojson` adalah satu unit PJUTS. Properti utama:

| Properti | Isi |
|---|---|
| `Nomor` | ID unik, format `KABUPATEN-KECAMATAN-DESA-NNN` |
| `Nama Anggota` | Pengusul |
| `Lokasi Rekapan` | Baris dari lembar alokasi, ditampilkan apa adanya sebagai judul. Jangan merapikan singkatannya — tim lapangan mencari dengan teks persis ini. |
| `Jalur`, `Alamat` | Keterangan lokasi |
| `Longitude`, `Latitude` | Koordinat yang ditampilkan di popup (maks. 6 desimal) |
| `Tanggal Dokumentasi` | `DD/MM/YYYY` |
| `Foto Survey Awal` | Path Windows asli foto, mis. `D:/011. ESDM/.../X.jpg` |
| `Status` | Kosong, `Cadangan`, atau `Belum Ditetapkan` |
| `Duplikat` | `true` jika pin GPS dipakai bersama unit lain |

**Aturan hitung:**

| Kondisi | Dihitung? | Tampilan |
|---|---|---|
| Tanpa status | Ya | Titik SK biasa |
| `Status: "Belum Ditetapkan"` | Ya | Unit sudah dialokasikan, lokasi pin masih perkiraan |
| `Duplikat: true` | Ya | Label "Perlu verifikasi" — perlu cek lapangan |
| `Status: "Cadangan"` | **Tidak** | Layer terpisah, tersembunyi secara default |

Total resmi = semua titik yang bukan Cadangan (saat ini 500).

**Foto:** nama berkas di `images/` = nilai `Foto Survey Awal` dengan setiap `/`, `\`
dan `:` diganti `_`. Mengganti foto berarti mengganti path *dan* berkasnya.

**Format berkas:** `points.geojson` ditulis sebagai JSON ringkas satu baris
(`separators=(",", ":")`, `ensure_ascii=False`). Skrip yang menulisnya wajib
mempertahankan format ini agar diff tetap kecil.

Stempel GPS/waktu yang tercetak di foto survei (Timemark, GPS Map Camera) adalah
sumber kebenaran untuk koordinat dan tanggal; ekspor QGIS sering memotong atau
salah menempatkannya.

## Memperbarui data sumber lokal (legacy)

Batch survei baru datang sebagai ekspor qgis2web, xlsx "Lembar Foto" dari Timemark,
atau foto WhatsApp. Polanya:

1. Buat skrip sekali pakai di `scripts/` dengan nama `append_*.py`, `place_*.py`,
   atau `apply_*.py`. Lihat `scripts/append_hafiz_teratai_rt06.py` atau
   `scripts/apply_survey_1_oktober.py` sebagai contoh.
2. Docstring skrip mencatat berkas sumber dan setiap keputusan penilaian.
3. Skrip menggabungkan data ke `points.geojson`, menyalin foto ke `images/` dengan
   nama yang sudah disanitasi, dan melakukan `assert`: jumlah titik, tidak ada
   `Nomor` ganda, foto ada.
4. Jalankan dengan `python scripts/<nama>.py`, lalu cek hasilnya di `npm run dev`.

Koreksi kecil (koordinat atau foto satu titik) cukup diedit langsung; pesan commit
mencantumkan koordinat baru dan buktinya.

Dependensi Python tidak di-pin; pasang sesuai kebutuhan skrip:

```bash
pip install openpyxl Pillow "shapely>=2.1" pyproj
```

- `openpyxl` — impor/ekspor xlsx
- `Pillow` — ikon (`build-icons.py`) dan foto
- `shapely` + `pyproj` — `import_big_boundaries.py`

Batas wilayah berasal dari layanan BIG edisi Juni 2026; cara membangun ulang ada di
[docs/boundary-data.md](docs/boundary-data.md).

## Build lokal dan deploy

Dockerfile memakai tahap Node untuk `npm ci` dan `npm run build`, kemudian tahap
Caddy yang **hanya menyalin `dist/public/`**. Skrip build menyalin branding yang
disebutkan eksplisit, gambar survei dengan tipe yang diizinkan, tiga GeoJSON, dan
ikon/manifest. Admin, environment, dokumentasi, kode server, alat lokal, dan source
map tidak masuk artefak publik.

- Bundle JavaScript/CSS memakai nama hash dan cache `immutable`. Branding dengan
  nama tetap memakai cache satu minggu; data direvalidasi (`no-cache`).
- URL preload data dan URL fetch tetap sama agar tidak mengunduh dua kali.
- CSP tetap membatasi skrip ke origin sendiri dan tile ke Google/Esri.
- Mengubah foto/data memerlukan build baru dalam tahap statis ini. Publikasi tanpa
  deploy kode memerlukan backend administrasi yang dijelaskan dalam desain berikut.
- Migrasi ini belum dipush atau dideploy. Docker daemon lokal tidak tersedia saat
  validasi; runtime Caddy dan hasil build diuji langsung di Windows.

Untuk rollback produksi, gunakan kembali rilis statis sebelumnya. `legacy.html`
hanya tersedia di checkout lokal; halaman itu tidak masuk artefak produksi baru.

## Dokumentasi lanjutan

- [CLAUDE.md](CLAUDE.md) — ringkasan arsitektur dan konvensi (bahasa Inggris)
- [docs/basemaps.md](docs/basemaps.md) — kenapa Google default dan Esri cadangan
- [docs/boundary-data.md](docs/boundary-data.md) — sumber dan pembangunan ulang batas wilayah
- [docs/favicon-design.md](docs/favicon-design.md) — desain ikon
- `docs/superpowers/specs/` — riwayat spesifikasi desain UI

## Konvensi

- Teks antarmuka berbahasa Indonesia; label status dipusatkan di `STATUS_LABEL`
  dalam `src/shared/survey/status.ts`.
- Komentar kode berbahasa Inggris dan menjelaskan *alasan* sebuah keputusan secara
  panjang. Jangan dipangkas — komentar itu mencatat hasil pengukuran.
- Subjek commit berupa kalimat perintah biasa yang menjelaskan perubahan yang
  terlihat pengguna, tanpa prefix conventional-commit. Body menjelaskan alasannya.
- Jalankan pemeriksaan TypeScript/Svelte, Vitest, build, dan tes browser sebelum
  merilis perubahan. Pemeriksaan engine WebKit tidak menggantikan uji perangkat iPhone.

## Administrasi data

Admin tersedia sebagai build terpisah dengan login kata sandi untuk akun yang disetujui. Mendukung titik, koordinat, foto/pengamatan, draf, penerbitan, riwayat/pemulihan, arsip, akses akun dan ekspor. Panduan: [docs/admin-operations.md](docs/admin-operations.md). Setelah memasang virtual environment dan dependensi backend, jalankan `npm run build:admin`, `npm run admin:connect`, kemudian `npm run admin:local`. Admin lokal memakai PostgreSQL dan bucket produksi melalui tunnel SSH privat, dengan akun, draf dan publikasi yang sama; tidak ada database SQLite lokal atau migrasi otomatis saat startup. Kredensial tetap di `.local/` yang diabaikan Git. Tes backend memakai database terisolasi lewat `npm run admin:local -- test survey delivery --noinput`. Admin produksi dan peta publik sudah aktif di domain yang sama; akses lokal adalah `http://127.0.0.1:8130/admin/`. Hasil pemeriksaan dan batas verifikasi tercatat di [validasi domain admin](docs/superpowers/validation/2026-10-09-same-domain-admin.md).
