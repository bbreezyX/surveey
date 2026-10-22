# Database dan media Surveey di VPS

Pada **22 Oktober 2026 pukul 17.22.28 WIB**, sumber data Surveey dialihkan dari
Railway ke VPS yang sudah menjalankan aplikasinya. Rilis kode aktif tetap
`9261072e720b11bf6faea71ea6bdeacd1a09d264`.

## Sumber produksi sekarang

| Komponen | Lokasi |
|---|---|
| PostgreSQL 18.6 | `/srv/surveey/postgres-production`, unit `surveey-postgres.service` |
| Database | `surveey`, TCP loopback `127.0.0.1:15433`, TLS wajib |
| Media asli dan derivative | `/srv/surveey/media`, pemilik `surveey`, direktori 0700 dan file 0600 |
| Mode aplikasi | `SURVEY_DEPLOYMENT=vps`, `SURVEY_DATA_SOURCE=vps` |
| Penanda konfigurasi | `/srv/surveey/FULL_VPS_CONFIGURED.json` |
| Konfigurasi privat aplikasi | `/srv/surveey/private/{admin,public,broker}.env` |
| Penerima rilis | `/usr/local/libexec/surveey-release.py`, menerima mode data lokal maupun hybrid yang dikonfigurasi eksplisit |

Admin menggunakan role `survey_admin_app`; public delivery dan broker memakai
`survey_public_app`. Akun operator terpisah. Admin dapat menulis media lokal,
broker hanya dapat membacanya, dan proses public delivery tetap tidak mendapat
akses filesystem media langsung. Public delivery meminta derivative lewat
broker privat yang sudah ada. Kunci Django/sesi, origin, TLS, Cloudflare Tunnel,
port web dan resource slice Surveey dipertahankan.

Cluster awal `/srv/surveey/postgres` tetap disimpan dan tidak dipakai. Salinan
media sebelumnya disimpan di `/srv/surveey/media-before-20261022T101220Z`.
Database `surveey_preserved_attempt3` menyimpan hasil restore percobaan yang
tidak pernah dibuka untuk aplikasi produksi; jangan memakainya sebagai sumber
produksi atau menghapusnya sebagai bagian deploy biasa.

## Bukti pemindahan data

Identitas migrasi: `20261022T101220Z`. Jeda penulisan final mulai sekitar
17.22.03 WIB; operasi aktivasi selesai 17.22.28 WIB. Ada percobaan sebelumnya
yang berhenti dan memulihkan koneksi lama sebelum aplikasi tujuan dibuka.

Sebelum penulisan lokal dibuka, perbandingan sumber dan tujuan menghasilkan:

- **21 tabel**: jumlah baris dan SHA-256 dari seluruh isi setiap tabel cocok.
- **12 sequence**: `last_value` dan `is_called` cocok.
- Izin efektif kedua role aplikasi pada seluruh tabel dan sequence cocok.
- **1.190 objek**, total **145.343.971 byte**, tersedia pada inventaris bucket
  dan salinan lokal. Seluruh 1.190 referensi file database cocok SHA-256-nya.
- Dua inventaris bucket selama penyalinan cocok, termasuk key, ukuran, ETag
  dan waktu modifikasi.
- Data mencakup 550 titik, 595 foto, 550 observasi, 167 draft, 721 revisi,
  444 audit, 14 publikasi, 23 sesi, serta 20 catatan migrasi Django.

Perbandingan timestamp dinormalisasi ke UTC. Percobaan awal menunjukkan
format zona waktu yang berbeda antara Railway (`Etc/UTC`) dan cluster baru
(`Asia/Shanghai`), sementara nilai waktunya sama. Cluster produksi kini memakai
UTC. Sertifikat database baru memakai RSA/SHA-256 agar koneksi TLS libpq dapat
dibuka; sertifikat Ed25519 persiapan tetap disimpan pada direktori cluster.

Perintah aktivasi mengembalikan kelima unit Surveey sebagai active/running.
PID Niskala (`1006`) dan Caddy bersama (`993`), waktu aktifnya, serta hash
konfigurasi yang dicatat sebelum/sesudah operasi tidak berubah. CPU quota,
memory limit dan IO weight slice Surveey tidak diperbesar.

Ini bukti integritas pemindahan dan hasil operasi layanan. Tidak dilakukan
browser check, login/edit/upload uji, smoke test, build validasi, atau uji beban.

Pengujian lanjutan kemudian diminta pengguna. Pada 22 Oktober pukul
17.35–17.39 WIB, web publik, seluruh foto publik dan komponen admin lolos dengan
akses internet ketiga backend diblokir sementara. Login browser admin masih
menunggu pemulihan kredensial pengguna. Lihat [hasil pengujian dan batasnya](superpowers/validation/2026-10-22-vps-data-independence.md).

## Data Railway yang dipertahankan

Project `survey`, environment `production`, PostgreSQL, volume dan bucket
`survey-private-media` tetap disimpan. Tidak ada penghapusan tabel, database,
volume, objek media atau service Railway dalam migrasi ini.

Untuk mencegah dua sumber penulisan, kedua role aplikasi pada database Railway
dibatasi `NOLOGIN`; default database sumber dibuat read-only dan sesi lama
diakhiri setelah writer admin selesai berhenti. Log deployment admin
`1239c18a-b3a8-456b-929e-f9ce9d9d3d3f` mencatat kedua worker dan master berhenti
pada 17.18.44 WIB, diikuti broker dan runtime pada 17.18.45 WIB. Restart policy
aplikasi tersebut `ON_FAILURE`, dan runtime keluar dengan kode 0.

Railway sekarang merupakan **salinan pada waktu migrasi**, bukan replika yang
terus mengikuti perubahan VPS. Jangan mengaktifkan kembali login writer sumber
atau mengalihkan aplikasi ke salinan lama tanpa memindahkan perubahan VPS yang
lebih baru terlebih dahulu. Bucket sumber tetap utuh; aplikasi VPS aktif sudah
tidak memakai kredensial S3 Railway pada env-nya.

## Cadangan dan catatan privat

Direktori root-only di VPS:

```text
/srv/surveey/private/data-migrations/20261022T101220Z/
  before-pause.dump
  final.dump
  media.tar
  media-inventory.json
  source-integrity.json
  target-integrity.json
  configuration/
  source-environments.private.json
  state.json
```

Dump final format custom berukuran **1.671.398 byte** dan SHA-256:

```text
84b4c0a0291b7b9565bc8633134b935c6508e161a25320981e76cb5b8d2150fd
```

Salinan privat di perangkat operator Windows berada di direktori Git-ignored
`.local/vps-copy/migration-backups/20261022T101220Z/`. Paket tersebut berisi dump
final, arsip media, inventaris, perbandingan integritas dan catatan migrasi;
tidak berisi env atau private key. Direktori dibatasi dengan ACL akun operator.
Snapshot ini adalah cadangan pada saat migrasi, bukan layanan backup berkala
untuk perubahan produksi berikutnya.

Transfer paket Windows selesai dengan ukuran **149.534.720 byte**; checksum dump
dan arsip media di dalamnya cocok dengan catatan VPS. SHA-256 paket:

```text
2aaae664d2da383b5fbe1d2662a479e7035d1b85fda479f91a3edc542b8c5813
```

## Pemulihan dan deploy berikutnya

Deploy aplikasi biasa tidak menjalankan migrasi/restore data dan tidak boleh
menjalankan installer awal. Unit admin/public/broker sekarang bergantung pada
PostgreSQL lokal; drop-in runtime rilis tetap dipertahankan. Receiver root-owned
telah diperbarui terpisah dari rilis aplikasi. Perubahan source operasional dan
dokumentasi lokal belum berarti sudah di-commit atau di-push.

Setelah aplikasi lokal dibuka untuk penulisan, pemulihan harus mempertahankan
semua perubahan VPS terbaru. Bila aplikasi mengalami masalah, perbaiki layanan
dengan database lokal tetap sebagai sumber data. Kembali ke Railway memerlukan
jeda penulisan baru, dump VPS terbaru, salinan media terbaru, restore ke target
Railway yang disepakati, dan pengalihan terkoordinasi. Mengganti DNS atau
membuka kembali role Railway saja dapat menghilangkan akses ke perubahan baru.

Pertahankan seluruh arsip dan data sumber sampai pengguna meminta kebijakan
retensi atau pembersihan secara eksplisit.
