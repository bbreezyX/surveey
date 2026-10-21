# Autodeploy Surveey ke VPS

Untuk melanjutkan dari perangkat baru, mulai dari
[handoff Railway–VPS](railway-vps-handoff.md) dan [panduan Mac](mac-operations.md).
Credential CI yang sudah tersimpan tidak perlu dipindahkan ke Mac.

## Alur

Workflow `.github/workflows/deploy-vps.yml` menerima push ke `master` pada
`bbreezyX/surveey`. Runner GitHub Ubuntu 24.04/Node 24/Python 3.12 membangun
frontend publik dan admin, mengunduh wheel sesuai `requirements.lock`, lalu
mengirim arsip melalui OpenSSH di jaringan Tailscale. Build tidak dijalankan
di VPS bersama Niskala.

Alur tidak menjalankan test, typecheck, lint, pemeriksaan HTTP, maupun migrasi
database. Perubahan skema database perlu prosedur terpisah karena VPS dan
cadangan Railway menggunakan PostgreSQL yang sama. Kode yang di-push harus
tetap kompatibel dengan skema dan versi aplikasi Railway yang berjalan.

Railway tetap menggunakan integrasi GitHub/autodeploy yang sudah ada. Workflow
VPS tidak memanggil API Railway, mematikan service, atau mengubah variabel
Railway. PostgreSQL dan bucket media tetap Railway; env/kredensial produksi
tetap tersimpan di `/srv/surveey/private`.

## Akses yang disiapkan

- Akun Linux `surveey-deploy`, terpisah dari akun deploy Niskala.
- SSH key khusus dengan `restrict` dan forced command. Tidak tersedia shell,
  PTY, port forwarding, atau password login untuk akun ini.
- Sudo dibatasi ke penerima root-owned
  `/usr/local/libexec/surveey-release.py receive ...`.
- Node CI sementara memakai `tag:surveey-ci`; grant hanya `tcp:22` menuju
  `100.64.182.105` / `fd7a:115c:a1e0::4729:b66a`.
- Tailscale SSH tetap tidak dipakai. Grant/perangkat/key Niskala tetap ada.
- OIDC issuer GitHub: `https://token.actions.githubusercontent.com`.
- OIDC subject yang diterima saat uji GitHub pada 21 Oktober 2026:
  `repo:bbreezyX@98301235/surveey@1204822236:ref:refs/heads/master`.
  Pencocokan mencakup ID pemilik dan repository, tidak hanya nama.
- Claim `workflow_ref`:
  `bbreezyX/surveey/.github/workflows/deploy-vps.yml@refs/heads/master`.
- Claim `event_name`: `push`. Scope hanya `auth_keys`, tag `surveey-ci`.

GitHub repository Secrets:

| Nama | Isi |
|---|---|
| `SURVEEY_DEPLOY_SSH_KEY` | Private key khusus CI; tidak berada di Git |
| `SURVEEY_DEPLOY_KNOWN_HOSTS` | Host key Ed25519 dari koneksi administrator yang sudah dipercaya |
| `SURVEEY_GOOGLE_MAPS_KEY` | Nilai build frontend yang sama dengan `.env.local` |

GitHub repository Variables:

| Nama | Kegunaan |
|---|---|
| `SURVEEY_DEPLOY_HOST` | Alamat Tailscale VPS |
| `SURVEEY_TS_CLIENT_ID` | Client ID federated identity khusus Surveey |
| `SURVEEY_TS_AUDIENCE` | Audience untuk token OIDC Tailscale |

Jangan masukkan database URL, password, S3 secret, `.env`, foto asli, atau
salinan database ke workflow/artifact. Google Maps key menjadi bagian bundle
browser; pembatasan referrer/provider tetap berlaku.

## Rilis di VPS

Penerima menolak link/path traversal dan berkas di luar allowlist, membatasi
ukuran arsip, serta membandingkan SHA-256 transfer sebelum mengganti aplikasi.
Paket publik terpisah dari kode account/admin. Data publik dan media tetap
diambil melalui backend; `points.geojson` dan foto repository tidak disalin
ke static root produksi.

Setiap rilis berada di `/srv/surveey/releases/<sha-pendek>-<run>-<attempt>`.
Dependensi dipasang dari wheel secara offline sebagai `surveey-deploy` dalam
unit sementara dengan CPU 25%, MemoryMax 192M, dan slice Surveey yang sudah
ada. Installer tidak mempunyai akses ke private env, media, PostgreSQL,
snapshot, atau folder Niskala. Instalasi gagal sebelum switch mempertahankan
rilis lama dan menyisakan kandidat untuk investigasi.

Pada deployment nyata pertama, penerima menyimpan folder lama ke
`releases/before-autodeploy`, lalu membuat `app`, `public-app`, dan `static`
sebagai symlink melalui `current`. Konversi ini tidak dilakukan saat setup.
Virtualenv lama tetap tersedia untuk baseline. Perubahan unit hanya override
ExecStart ketiga backend Surveey agar memakai virtualenv rilis aktif.

Switch dilakukan setelah paket dan dependensi siap. Hanya
`surveey-admin.service`, `surveey-public.service`, dan
`surveey-broker.service`, dan edge khusus `surveey-edge.service` yang
dihentikan/dijalankan kembali. Edge disertakan karena unit tersebut bergantung
pada ketiga backend. Ada jeda singkat Surveey saat perpindahan. Niskala, Caddy
bersama, Cloudflare tunnel, database, dan media tidak di-restart oleh workflow.

`current` menunjuk rilis aktif, `previous` menunjuk rilis sebelumnya. Apabila
perintah systemd start langsung gagal, pointer dikembalikan dan versi lama
dijalankan lagi. Ini bukan health check aplikasi; crash sesudah start atau
error aplikasi tidak otomatis terdeteksi. Semua rilis dipertahankan. Jika ruang
disk tersisa kurang dari 2 GiB, deploy ditolak tanpa menghapus rilis/data.

## Rollback kode oleh administrator

Lakukan hanya jika rollback memang diminta. Jangan menjalankan migrasi atau
mengubah database untuk rollback kode ini. Melalui akun administrator biasa:

```bash
sudo systemctl stop surveey-admin.service surveey-public.service surveey-broker.service surveey-edge.service
sudo python3 - <<'PY'
import os
from pathlib import Path
base = Path('/srv/surveey')
target = (base / 'previous').resolve(strict=True)
if target.parent != (base / 'releases') or not (target / 'venv').exists():
    raise SystemExit('Target rollback di luar direktori rilis Surveey.')
temporary = base / 'rollback.next'
temporary.symlink_to(target)
os.replace(temporary, base / 'current')
print('Pointer kode Surveey dikembalikan; database/media tidak diubah.')
PY
sudo systemctl start surveey-admin.service surveey-public.service surveey-broker.service surveey-edge.service
```

`previous` baru tersedia setelah deployment pertama. Jangan mengubah symlink
ketika deployment lain sedang berlangsung. Akun CI tidak diberi perintah
rollback bebas; gunakan administrator atau push commit perbaikan/revert kode.

## Status persiapan awal

Pada 21 Oktober 2026, penerima rilis, akun SSH, secrets/variables GitHub, grant,
dan OIDC telah disiapkan. Tidak ada build, upload rilis, restart aplikasi,
migrasi, workflow percobaan, atau tes/verifikasi aplikasi yang dijalankan untuk
persiapan ini. Publikasi workflow harus memakai commit `[skip actions]` jika
deployment pertama belum ingin dijalankan. Commit push master berikutnya
tanpa penanda skip akan menjalankan alur otomatis.

## Uji pemicu push

Pada 21 Oktober 2026 diminta satu pengujian deployment nyata melalui push ke
`master`, tanpa penanda skip. Pengujian mencakup GitHub Actions/VPS dan
autodeploy tiga aplikasi Railway. Database dan media tidak dimigrasikan;
pemeriksaan aplikasi hanya menggunakan akses baca.

Hasil uji push `cf24fa8c23a06107ccdac9a0fb5e5b8c70b2bbf3`:

- VPS: berhasil melalui GitHub Actions run `39632355636`, percobaan ke-3.
  Dua percobaan awal berhenti sebelum upload karena subject OIDC tidak cocok.
  Subject diperbaiki sesuai token aktual yang menyertakan ID pemilik/repository.
- Rilis aktif VPS: `/srv/surveey/releases/cf24fa8c23a0-39632355636-3`.
  Baseline tetap di `releases/before-autodeploy` untuk rollback.
- Halaman utama, login admin, JS/CSS publik/admin, GeoJSON, dan satu foto
  publik merespons 200. API sesi anonim tetap 401. GeoJSON memuat 547 titik.
- PID/waktu start/restart count Niskala dan Caddy bersama tidak berubah;
  hash kedua konfigurasi yang dilindungi juga tetap sama.
- Railway: check suite untuk push terbentuk, tetapi deployment baru belum
  muncul ketika platform melaporkan build dijeda. Ketiga aplikasi masih
  berstatus Online/SUCCESS pada commit `6aa0691` menurut API.
- URL langsung Railway merespons `404 Application not found` sebelum dan
  sesudah uji. Kesiapan akses HTTP backup belum terbukti, meskipun API Online.
- Tidak menjalankan migrasi, restore, penghapusan data, atau perubahan DNS.

Lihat [catatan hasil pengujian](autodeploy-test-2026-10-21.md). Saat pengujian
selesai, pembaruan hasil dan subject sempat disimpan lokal agar tidak memicu
push uji kedua. Dokumen tersebut kemudian diterbitkan atas permintaan handoff
ke Mac dengan commit dokumentasi `[skip actions]`. Perbaikan subject sudah
disimpan di konsol Tailscale. Hasil uji mencatat rilis saat itu, bukan keadaan
live setiap commit setelahnya.

## Referensi

- [Tailscale GitHub Action](https://tailscale.com/docs/integrations/github/github-action)
- [Workload identity federation](https://tailscale.com/docs/features/workload-identity-federation)
- [GitHub skip workflow runs](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/skip-workflow-runs)
- [Railway GitHub autodeploys](https://docs.railway.com/deployments/github-autodeploys)
