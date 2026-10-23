# Operasional Surveey: Railway, VPS, dan Mac

**Pembaruan 22 Oktober 2026, 17.22 WIB:** aplikasi, PostgreSQL dan media produksi
kini berada di VPS. Data Railway tetap disimpan sebagai snapshot migrasi dengan
writer dibatasi. Baca [hasil migrasi dan pemulihan data](vps-data-migration-2026-10-22.md)
sebelum memakai prosedur hybrid atau mengalihkan kembali ke Railway.

Mulai dari dokumen ini ketika melanjutkan pekerjaan dari perangkat lain.
Dokumentasi ini mencatat konfigurasi dan bukti yang sudah diperoleh; kondisi
provider, alamat, certificate, versi rilis, dan akses perangkat dapat berubah.
Publikasi dokumen ini tidak menjalankan tes atau mengubah infrastruktur.

## Peta sistem

```text
Pengunjung -> Cloudflare survey.esdm.cloud -> Tunnel -> VPS Niskala
                                                    /srv/surveey
                                                    |-- frontend publik
                                                    |-- admin Django
                                                    |-- public delivery
                                                    `-- media broker
                                                           |
                                       PostgreSQL + media lokal VPS

Railway PostgreSQL + bucket: snapshot migrasi dipertahankan, writer dibatasi

GitHub bbreezyX/surveey, master
  |-- GitHub Actions -> Tailscale -> SSH khusus -> rilis aplikasi di VPS
  `-- (Railway: source repo masih terpasang, autodeploy mati sejak 23 Okt)

Niskala: /srv/niskala-udara, layanan dan Caddy terpisah dari Surveey
```

Railway menyimpan data pada saat migrasi. Edit, publikasi, upload dan sesi baru
memakai PostgreSQL/media VPS. Railway tidak mengikuti perubahan baru secara
otomatis. Jangan membuka kembali writer sumber atau memakai cluster kosong
persiapan sebagai produksi. Migrasi skema tetap merupakan operasi terpisah.

## Pilih panduan sesuai pekerjaan

| Pekerjaan | Dokumen |
|---|---|
| Lokasi data aktif, bukti migrasi, cadangan, dan pemulihan setelah 22 Oktober | [Database dan media VPS](vps-data-migration-2026-10-22.md) |
| Melanjutkan dari Mac, clone repo, menyiapkan SSH | [Panduan Mac](mac-operations.md) |
| Memahami folder, port, service, data, TLS dan DNS | [Arsitektur VPS dan Railway](vps-copy.md) |
| Push kode, GitHub Actions, OIDC, rilis dan rollback kode | [Autodeploy VPS](autodeploy-vps.md) |
| Menilai hasil pengujian yang sudah pernah dilakukan | [Hasil uji 21 Oktober 2026](autodeploy-test-2026-10-21.md) |
| Mengembalikan domain/aplikasi produksi ke Railway | [Kembali ke Railway](return-to-railway.md) |
| Dockerfile, role, variable dan private networking Railway | [Deployment Railway](railway-deployment.md) |
| Menemukan sumber skrip operasional dan template lama | [Sumber operasional VPS](../server/deploy/vps/README.md) |

## Bukti terakhir yang dicatat

Pada pengujian **21 Oktober 2026 pukul 23.15 WIB**, satu push commit
`cf24fa8c23a06107ccdac9a0fb5e5b8c70b2bbf3` memicu
[workflow VPS yang berhasil](https://github.com/bbreezyX/surveey/actions/runs/39632355636).
Dua attempt awal berhenti pada OIDC; attempt ke-3 berhasil setelah subject
disesuaikan dengan ID pemilik dan repository dalam token GitHub.

Halaman publik/login admin, aset, GeoJSON 547 titik, dan satu foto publik
merespons 200; API sesi anonim tetap 401. Proses dan konfigurasi Niskala serta
Caddy bersama tidak berubah pada perbandingan sebelum/sesudah pengujian.

Pada waktu yang sama, check suite Railway masih queued dan ketiga aplikasi
Railway masih melaporkan commit lama `6aa0691`. Provider melaporkan build
dijeda. URL langsung Railway merespons `404 Application not found`, sehingga
kesiapan HTTP cadangan belum terbukti. Ini catatan hasil uji saat itu, bukan
pernyataan kondisi live terbaru. Jangan mengalihkan DNS kembali hanya karena
status API menampilkan Online; ikuti panduan kembali ke Railway.

## Batas kerja yang dipertahankan

- Surveey hanya menggunakan `/srv/surveey` dan unit berawalan `surveey-`.
  Pertahankan `/srv/niskala-udara`, `niskala-udara.service`, Caddy bersama pada
  80/443, key administrator, dan akses CI Niskala.
- OpenSSH berjalan melalui Tailscale. Tailscale SSH tetap nonaktif. Akun Mac
  untuk administrasi memakai key perangkat sendiri; akun `surveey-deploy`
  beserta forced command hanya dipakai GitHub Actions.
- Jangan menghapus database, volume, bucket, objek media, snapshot, atau rilis
  sebelumnya sebagai bagian deploy/pindah perangkat.
- Tes/verifikasi hanya dilakukan bila diminta untuk pekerjaan yang sedang
  berjalan. Hasil uji lama tidak otomatis berlaku untuk rilis atau perangkat baru.

## Yang tersedia setelah clone dan yang tetap privat

Git memuat workflow, source aplikasi, runbook, catatan hasil uji, serta sumber
skrip/template operasional. Git tidak memuat `.env*`, `.local`, private SSH
key, kredensial database/S3, token tunnel, TLS private key, atau dump produksi.

Kredensial aplikasi berada di `/srv/surveey/private` dan variable Railway;
credential CI berada di GitHub Secrets/Variables. Tidak perlu menyalin env
produksi ke Mac untuk push kode atau menjalankan autodeploy yang sudah ada.

Pada persiapan awal belum ada dump PostgreSQL yang berhasil dibuat. Migrasi
22 Oktober kemudian menghasilkan dump final dan arsip 1.190 media; lokasi dan
hasil perbandingannya dicatat di [runbook data VPS](vps-data-migration-2026-10-22.md).
Backup migrasi tersebut tidak otomatis menjadi backup perubahan berikutnya.
