# Pengujian Surveey setelah migrasi database/media VPS

Dilakukan atas permintaan eksplisit pengguna pada 22 Oktober 2026. Pengujian
isolasi publik berlangsung **17.35.09–17.39.03 WIB**; pengujian admin setelah
login dilanjutkan dengan isolasi **17.51.17–17.55.31 WIB**. Tidak ada restart/perubahan
konfigurasi Niskala, perubahan kata sandi, edit/publikasi titik, upload media
uji, atau penghapusan data Railway.

## Hasil yang terbukti

| Cakupan | Hasil |
|---|---|
| Web publik, daftar wilayah, pemilihan titik dan popup foto | Terbuka pada browser produksi |
| `/` | 200 |
| `/data/points.geojson` | 200, 547 feature, seluruh JSON cocok dengan publikasi aktif database lokal |
| Foto publik | 541/541 respons 200, MIME JPEG dan SHA-256 cocok dengan database lokal |
| Media filesystem | 1.190/1.190 file cocok SHA-256; tidak ada file hilang/berbeda |
| Foto tanpa cache | 200; tidak ada pada cache public/broker sebelum permintaan; SHA-256 cocok |
| Revalidasi foto | 304 dengan `If-None-Match` yang benar |
| `/admin` | 308 menuju `/admin/` |
| Halaman login dan kedua aset login | 200; pemeriksaan private/no-store lolos |
| API sesi/bootstrap admin anonim | 401 |
| Foto original admin tanpa autentikasi | 401 |
| Path filesystem original melalui URL publik | 404 |
| Foto yang tidak dipublikasikan | 404 |
| Komponen admin dengan user/mount namespace/cgroup layanan sebenarnya | ORM memakai database lokal; seluruh 1.190 file dibaca melalui `delivery.storage` dan checksum cocok |
| Login admin | Pengguna berhasil masuk melalui login produksi biasa sebagai `danny`, peran Pemilik |
| Dashboard setelah login | Dimuat ulang saat backend hanya boleh mengakses loopback; 547 titik, pencarian dan detail Bagan Pete/Pelempang terbuka |
| Foto privat melalui sesi browser | Foto detail tampil; satu foto lain yang tidak ada dalam publikasi aktif juga terbuka dan dapat diunduh |
| Checksum unduhan admin | Dua foto tampilan dan satu berkas asli cocok SHA-256 dengan metadata database VPS |
| Halaman admin lain | Draf, riwayat 14 penerbitan, audit dengan peristiwa login berhasil, serta satu akun aktif `danny` termuat |

Publikasi yang diuji: `27b48626-c3fc-4c7a-a62c-789df0288eb2`. Respons foto publik
yang diuji berjumlah 75.350.776 byte; request terlama pada batch ini 1,4769 detik.
Ini hasil batch verifikasi, bukan uji beban atau jaminan latensi.

## Bukti tanpa ketergantungan Railway pada jalur data

Ketiga proses backend aktif menggunakan `SURVEY_DEPLOYMENT=vps`,
`SURVEY_DATA_SOURCE=vps`, database `surveey` pada `127.0.0.1:15433` dengan TLS,
dan tidak memiliki variabel kredensial S3. Role admin tetap `survey_admin_app`;
public delivery/broker tetap `survey_public_app`. Socket database aktif pada
worker yang diperiksa hanya menuju loopback PostgreSQL lokal.

Untuk menguji kondisi tanpa akses Railway, diterapkan sementara kebijakan
`IPAddressDeny=any` dan `IPAddressAllow=localhost` pada **hanya** tiga unit:

- `surveey-admin.service`
- `surveey-public.service`
- `surveey-broker.service`

Program filter ingress/egress terpasang pada kernel, diperiksa dengan `bpftool`.
Probe yang benar-benar dijalankan dalam masing-masing cgroup berhasil membuka
TCP PostgreSQL lokal, sementara TCP HTTPS eksternal diblokir. Akses eksternal
dari luar ketiga cgroup tersedia sebelum pembatasan. Dengan pembatasan aktif,
web publik, GeoJSON, seluruh 541 foto publik, foto tanpa cache, pemeriksaan
otorisasi, dan pembacaan media oleh komponen admin tetap lolos.

Semua kebijakan jaringan sementara dikembalikan ke nilai awal yang kosong.
Halaman login/redirect/aset diperiksa lagi setelah pemulihan dan tetap lolos.
Tidak ada perubahan firewall global, slice Niskala, tunnel, atau Caddy bersama.

Peta di browser tetap menggunakan penyedia citra/batas yang sudah ada. Hasil ini
membuktikan jalur database/media Surveey tidak membutuhkan Railway; ini bukan
klaim bahwa seluruh layanan peta dapat berjalan tanpa internet.

## Pengujian admin setelah login

Kredensial file uji lokal ditolak. Pemeriksaan read-only terhadap sumber Railway
dan VPS membuktikan nama akun, hash kata sandi, serta status aktif akun identik;
kredensial lokal tersebut sudah tidak cocok dengan akun produksi sebelum
migrasi.

Pengguna sempat menyetujui reset melalui terminal, kemudian menyatakan telah
mengingat kata sandi. Reset dibatalkan sebelum perubahan. Fingerprint hash
kata sandi VPS dibandingkan dengan nilai sebelum proses reset dan tetap sama;
helper reset dinonaktifkan dan kedua jendela terminal task ditutup. Kata sandi
Railway tidak diubah.

Pengguna menyelesaikan login produksi biasa pada browser. Dashboard kemudian
dimuat ulang ketika ketiga backend dibatasi ke loopback. Sesi `danny`/Pemilik,
547 titik, pencarian Bagan Pete dan Pelempang, detail kedua titik, riwayat
penerbitan, audit, dan daftar akun berhasil ditampilkan. Tidak ada pembuatan
sesi uji, pemalsuan sesi, atau bypass autentikasi.

Melalui sesi tersebut, foto detail Bagan Pete berhasil dirender dan diunduh:
foto tampilan 36.372 byte dan berkas asli 37.395 byte, keduanya cocok SHA-256
dengan metadata PostgreSQL VPS. Foto privat Pelempang yang tidak tercantum
dalam publikasi aktif juga berhasil dibuka pada endpoint admin (720×960),
diunduh sebanyak 120.095 byte, dan cocok SHA-256 dengan database VPS.

Percobaan tambahan mengunduh berkas asli foto privat kedua dari tab kosong
tidak dilanjutkan karena alat browser tidak dapat menetapkan origin untuk
otorisasi unduhan. Tidak ada upaya melewati kontrol browser. Cakupan unduhan
asli yang berhasil diuji adalah satu berkas Bagan Pete; seluruh 595 berkas
asli sebelumnya sudah diperiksa melalui storage layanan admin.

Isolasi kedua memakai filter kernel dan probe cgroup yang sama seperti
pengujian publik. Semua pembatasan dipulihkan pada 17.55.31 WIB; ketiga layanan
backend tetap memiliki PID yang sama dan `NRestarts=0`. Tidak dilakukan
penyimpanan draf, publikasi, unggah/cabut foto, atau perubahan akun. Pengujian
ini memeriksa pembacaan data dan media; operasi tulis produksi tidak diuji.

## Pelestarian Niskala dan data

PID, waktu aktif, jumlah restart, state, cgroup serta kebijakan jaringan Niskala
dan Caddy bersama tidak berubah pada perbandingan sebelum/sesudah. Hash kedua
konfigurasi yang dicatat juga cocok. Data Railway hanya dibaca untuk membandingkan
kredensial; tidak ada penghapusan atau perubahan data/objek Railway.

Artefak privat tersedia di VPS pada `/srv/surveey/private/verification-20261022/`
dan pada checkout operator di `.local/vps-copy/verification-artifacts/`:
`report.json`, `baseline.json`, `admin-component.json`,
`credential-comparison.json`, `authenticated-isolation.json`,
`authenticated-browser.json`, serta screenshot `public-popup.png` dan
`admin-authenticated-photo.png`.
