# Sumber operasional Surveey VPS

Mulai dari [handoff Railway–VPS](../../../docs/railway-vps-handoff.md) dan
[panduan Mac](../../../docs/mac-operations.md). File di direktori ini disimpan
agar referensi implementasi ikut checkout pada perangkat lain. Menerbitkan
sumbernya tidak menjalankan skrip atau menerapkan ulang konfigurasi server.

## Jalur deploy aktif

| File | Kegunaan |
|---|---|
| `package-ci-release.py` | Kemasan allowlist kode/aset/wheel dari runner GitHub |
| `ssh-release-gate.py` | Forced command untuk akun CI, menolak shell/perintah lain |
| `receive-release.py` | Penerima root-owned yang menginstal dan mengganti rilis Surveey |
| `prepare-autodeploy.py` | Pendaftaran awal akun/key/receiver; bukan langkah setiap deploy |

Workflow aktif adalah [deploy-vps.yml](../../../.github/workflows/deploy-vps.yml).
Receiver yang terpasang ada di `/usr/local/libexec/surveey-release.py`. Push
kode tidak memperbarui receiver root-owned secara otomatis; perubahan pada
receiver/gate perlu pemasangan administratif tersendiri dalam lingkup yang
disetujui. Env, TLS, database, media dan konfigurasi edge berada di luar paket
rilis. Jangan memakai akun CI sebagai akun administrasi Mac.

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

Pada mode aktif, PostgreSQL dan media tetap Railway. Jangan menjalankan exporter,
restore, atau cluster lokal sebagai bagian deploy aplikasi biasa. Pengembalian
Railway dijelaskan pada [runbook](../../../docs/return-to-railway.md).
