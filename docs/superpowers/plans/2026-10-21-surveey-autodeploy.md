# Autodeploy Surveey melalui Tailscale

Tujuan: push ke `bbreezyX/surveey` branch `master` mengirim rilis aplikasi ke
VPS Niskala, dengan PostgreSQL dan media tetap di Railway. Railway tetap
autodeploy sebagai cadangan. Persiapan ini tidak menjalankan build atau deploy.

1. Tambahkan workflow push master. Build frontend dan unduh wheel Python di
   runner Ubuntu 24.04/Python 3.12, tanpa test, lint, atau typecheck.
2. Buat arsip allowlist: backend admin/broker, backend publik terpisah, build
   admin, aset publik yang diizinkan, dan wheel. Jangan kemas env/data/media.
3. Pasang penerima rilis root-owned khusus `/srv/surveey`. SSH memakai akun
   `surveey-deploy`, forced command, dan sudo hanya untuk penerima tersebut.
4. Installer menyiapkan virtualenv per rilis dengan CPU/memori terbatas dan
   tanpa akses env produksi. Perpindahan rilis dan restart hanya tiga backend
   dan edge khusus Surveey; rilis lama disimpan, tanpa migrasi database otomatis.
5. Siapkan tag `surveey-ci` dengan akses tcp:22 hanya ke VPS tujuan, serta OIDC
   GitHub yang dibatasi repo/branch/workflow. Pertahankan seluruh grant lama.
6. Simpan SSH key dan known_hosts sebagai GitHub Secrets; konfigurasi Tailscale
   sebagai Variables. Kunci aplikasi tetap di VPS. Dokumentasikan rollback.
7. Publikasi konfigurasi harus melewatkan workflow pada commit persiapan agar
   belum ada build/deploy. Push master selanjutnya mengaktifkan alur otomatis.

Tidak menjalankan workflow, build, tes, lint, pemeriksaan browser aplikasi,
migrasi skema, atau verifikasi pascaperubahan. Tidak mengubah Niskala, Caddy
bersama, Railway, DNS, environment produksi, maupun penyimpanan data.
