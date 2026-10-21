# Hasil uji autodeploy Surveey, 21 Oktober 2026

## Lingkup dan identitas

- Satu push nyata ke `bbreezyX/surveey@master`, commit
  `cf24fa8c23a06107ccdac9a0fb5e5b8c70b2bbf3`.
- [GitHub Actions run 39632355636](https://github.com/bbreezyX/surveey/actions/runs/39632355636).
- Tidak mengubah fungsi produk; commit pemicu menambahkan catatan uji pada
  dokumentasi. Tidak menjalankan migrasi database atau menghapus data.

## VPS: berhasil

Workflow dipicu event `push`. Dua attempt awal berhenti pada pertukaran token
OIDC 403 sebelum upload. Tailscale menampilkan subject aktual:
`repo:bbreezyX@98301235/surveey@1204822236:ref:refs/heads/master`.
Credential semula hanya menggunakan nama tanpa ID. Pencocokan subject
diperbaiki sesuai identitas aktual; scope `auth_keys`, tag `surveey-ci`,
branch master, event push, dan claim workflow tetap dibatasi seperti semula.

Attempt ke-3 berhasil; job berjalan 16:14:31–16:15:19 UTC (23:14:31–23:15:19
WIB), selama 48 detik. Tahap build, koneksi Tailscale, SSH terbatas, instalasi
wheel offline, dan perpindahan rilis semuanya selesai.

Rilis aktif:
`/srv/surveey/releases/cf24fa8c23a0-39632355636-3`.
Catatan aktivasi mencatat commit yang sama pada 16:15:13 UTC. Rilis sebelumnya
tetap tersimpan di `/srv/surveey/releases/before-autodeploy`.

Pemeriksaan HTTP setelah deploy, seluruhnya GET anonim tanpa login/CRUD:

| Pemeriksaan | Hasil |
|---|---|
| `https://survey.esdm.cloud/` | 200 |
| `/admin/` | 200, halaman login |
| `/admin/api/session` | 401, akses anonim tetap ditolak |
| `/data/points.geojson` | 200, 547 feature |
| JS dan CSS publik | 200 |
| JS login dan CSS admin | 200 |
| Satu foto publik dari GeoJSON | 200, image/jpeg |

## Niskala: tidak direstart atau diubah

Snapshot sebelum dan sesudah menunjukkan kesamaan seluruh properti yang
dicatat untuk Niskala dan Caddy bersama: ActiveState/SubState, MainPID,
ExecMainStartTimestamp, serta NRestarts.

- Niskala MainPID: 1006; NRestarts: 0.
- Caddy bersama MainPID: 993; NRestarts: 0.
- Hash `/etc/caddy/Caddyfile` dan unit Niskala tidak berubah.
- Cloudflare tunnel Surveey juga mempertahankan PID 1164.

Hanya tiga backend dan edge khusus Surveey yang dijalankan kembali. Layanan
Surveey setelah deploy aktif; pengukuran sesudah uji menunjukkan sekitar
442 MB pemakaian slice dalam batas 738.197.504 byte yang sudah ditetapkan.

## Railway: belum lolos uji pembaruan

GitHub membentuk check suite `railway-app` untuk commit uji. Namun, pada
pemeriksaan akhir, ketiga aplikasi masih memakai commit `6aa0691`, bukan
`cf24fa8`; belum ada deployment baru untuk commit uji di daftar Railway.
Status resmi Railway melaporkan build dijeda pada semua region akibat
insiden dashboard/API. Karena itu hasil ini tidak dinyatakan sukses.

Status live yang dilaporkan API:

| Service | Deployment lama | Status |
|---|---|---|
| surveypjuts | 7f2c0518-db19-43a5-b65c-06c3956bff80 | Online, SUCCESS, 1 replica |
| survey-admin | b33fdd68-02fc-448f-a455-c239555a8cb3 | Online, SUCCESS, 1 replica |
| survey-public-data | d24d9be0-0951-4077-9598-d9b5c0aeb729 | Online, SUCCESS, 1 replica |

PostgreSQL tetap Online menurut API. Database dan bucket media tetap Railway.
Tidak mengubah service, variabel, replica, domain, atau staged patch Railway.
Ada staged patch lama yang mengulang branch master ke master pada map;
konfigurasi live juga sudah master, sehingga patch tersebut tidak diterapkan.

URL langsung `surveypjuts-production.up.railway.app` merespons 404
`Application not found` sebelum dan sesudah tes. Probe origin lama dengan
hostname produksi juga 404. Penyebab routing belum dipastikan; tidak
menyimpulkan bahwa status Online membuktikan backup dapat diakses lewat HTTP.
Produksi `survey.esdm.cloud` tetap menuju VPS dan lolos pemeriksaan baca.

## Batas pengujian dan tindak lanjut

Belum menguji login akun, upload, CRUD, rollback nyata, atau migrasi skema.
Tidak menjalankan test suite/lint/typecheck lokal; yang dijalankan adalah
workflow build/deploy VPS dan pemeriksaan baca yang diminta.

Railway perlu diperiksa kembali setelah layanan build pulih untuk memastikan
commit uji diproses dan akses HTTP backup berfungsi. Tidak membuat jadwal
monitor atau menjalankan redeploy manual karena itu tidak membuktikan pemicu
push yang diminta.

Dokumen hasil ini dan pembaruan subject di `autodeploy-vps.md` mula-mula disimpan
lokal. Selanjutnya pengguna meminta seluruh dokumentasi operasional dipush agar
bisa dilanjutkan dari Mac; publikasi memakai `[skip actions]` tanpa menjalankan
pengujian kedua. Bukti mentah tetap di `.local/vps-copy/` pada checkout Windows,
tidak ikut clone Git di Mac:
`autodeploy-test-before.json`, `autodeploy-test-after.json`,
`autodeploy-test-assets.json`, dan `surveey-ci-oidc-subject-fixed.jpg`.

Rujukan: [Status Railway](https://status.railway.com/).
