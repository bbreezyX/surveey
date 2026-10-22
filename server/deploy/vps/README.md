# Sumber operasional Surveey VPS

Sejak **22 Oktober 2026, 17.22 WIB**, database dan media aktif berada di VPS.
Baca [runbook migrasi data](../../../docs/vps-data-migration-2026-10-22.md).
Railway dipertahankan sebagai snapshot sumber dengan writer dibatasi.

Mulai dari [handoff Railway–VPS](../../../docs/railway-vps-handoff.md) dan
[panduan Mac](../../../docs/mac-operations.md). File di direktori ini disimpan
agar referensi implementasi ikut checkout pada perangkat lain. Menerbitkan
sumbernya tidak menjalankan skrip atau menerapkan ulang konfigurasi server.

## Jalur deploy aktif

| File | Kegunaan |
|---|---|
| `package-ci-release.py` | Kemasan allowlist kode/aset/wheel serta metadata commit/branch dari konteks push GitHub |
| `ssh-release-gate.py` | Forced command untuk akun CI, menolak shell/perintah lain |
| `receive-release.py` | Penerima root-owned yang menginstal dan mengganti rilis Surveey |
| `migrate-local-data.py` | Operasi satu kali prepare/cutover data; input credential privat di stdin, bukan hook deploy |
| `prepare-autodeploy.py` | Pendaftaran awal akun/key/receiver; bukan langkah setiap deploy |

Workflow aktif adalah [deploy-vps.yml](../../../.github/workflows/deploy-vps.yml).
Receiver yang terpasang ada di `/usr/local/libexec/surveey-release.py`. Push
kode tidak memperbarui receiver root-owned secara otomatis; perubahan pada
receiver/gate perlu pemasangan administratif tersendiri dalam lingkup yang
disetujui. Env, TLS, database, media dan konfigurasi edge berada di luar paket
rilis. Jangan memakai akun CI sebagai akun administrasi Mac.

Manifest format 1 kini dapat mencatat `branch: master`. Receiver kompatibel
tetap menerima manifest lama tanpa field branch; receiver lama yang memakai
perbandingan manifest persis harus diperbarui sebelum paket baru dikirim.
Riwayat penerapan dan pengisian metadata rilis aktif pada 22 Oktober 2026
ada di [metadata branch dan commit](../../../docs/autodeploy-vps.md#metadata-branch-dan-commit-rilis).

## Referensi persiapan awal

| File | Peran awal / batas |
|---|---|
| `prepare-runtime.py` | Runtime privat Python/PG pada Ubuntu amd64; bukan setup macOS |
| `install-copy.py` | Unit dan cluster awal; menolak mode hybrid yang sudah dikonfigurasi |
| `configure-railway-data.py` | Env/unit mode data Railway; input JSON selected credential lewat stdin |
| `configure-tailnet-access.py` | Listener privat awal; menolak penggantian setelah origin publik tercatat |
| `configure-public-origin.py` | Origin publik/connector Surveey; memerlukan staging privat dan binary Linux |
| `export-database-via-bucket.py` | Rencana worker dump read-only terpisah; belum dijalankan |
| `Caddyfile` | Template loopback persiapan awal |
| `Caddyfile.tailnet` | Template akses privat sebelum import origin produksi |
| `Caddyfile.production` | Konfigurasi origin loopback yang diimpor edge Surveey |

Skrip awal bukan satu installer idempotent untuk server yang sudah aktif.
Beberapa membuat credential, cluster, unit, certificate atau melakukan restart
Surveey. Jangan menjalankannya ulang untuk pindah perangkat atau mengganti env.
Ikuti marker, prasyarat, versi platform dan scope pada source sebelum operasi
administratif yang memang diminta. Tidak ada skrip di sini yang perlu dijalankan
untuk sekadar meng-clone repo di Mac.

Staging privat yang pernah diperlukan meliputi token tunnel, metadata DNS,
selected application credentials, serta binary `cloudflared-linux-amd64`.
Berkas tersebut tidak termasuk repo. Template tidak berisi private key/token.
Jangan menyalin template Caddy loopback/tailnet langsung ke edge produksi karena
listener/import origin publik yang telah ditambahkan dapat hilang.

Pada mode aktif, PostgreSQL dan media berada di VPS. Jangan menjalankan exporter,
restore, atau installer cluster sebagai bagian deploy aplikasi biasa. Pengembalian
Railway memerlukan pemindahan data VPS terbaru; lihat [runbook data](../../../docs/vps-data-migration-2026-10-22.md).
