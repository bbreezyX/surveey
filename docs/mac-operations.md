# Melanjutkan operasional Surveey dari Mac

Panduan ini untuk checkout Git dan administrasi deployment yang sudah ada.
Tidak perlu membuat ulang VPS, tunnel, database, bucket, atau workflow saat
pindah perangkat. Baca [peta sistem](railway-vps-handoff.md) terlebih dahulu.
Perintah di bawah adalah referensi untuk pelaksanaan nanti, bukan perintah
yang dijalankan saat dokumentasi ini dipublikasikan.

## 1. Siapkan akses GitHub dan checkout

Gunakan Git dan, bila memilih login lewat CLI, GitHub CLI. Masuk sebagai akun
yang mempunyai hak push ke `bbreezyX/surveey`. Clone lewat HTTPS tidak
menggunakan SSH key VPS.

```bash
gh auth login --hostname github.com --git-protocol https --web
gh auth setup-git
git clone https://github.com/bbreezyX/surveey.git
cd surveey
git switch master
```

Jika checkout sudah ada, masuk ke foldernya dan gunakan `git pull --ff-only
origin master` saat working tree siap. Jika pull ditolak karena perubahan
lokal/divergensi, selesaikan perubahan tersebut; jangan memakai reset hard.

Node.js 24 dan npm hanya diperlukan untuk pengembangan/build frontend lokal.
Build produksi VPS dilakukan GitHub Actions, jadi Mac tidak perlu memasang
Python Linux, PostgreSQL server, atau Docker untuk sekadar push kode.

`.env.local` tidak ikut clone. Bila memerlukan peta development, dapatkan nilai
`VITE_GOOGLE_MAPS_KEY` melalui akses provider/pengelola yang berwenang. Jangan
mengambil atau menyalin private key CI atau env database produksi untuk ini.
Nama variable dan kebutuhan development ada di README/deployment Railway.

## 2. Hubungkan Mac ke Tailscale

Pasang aplikasi macOS dari [unduhan resmi Tailscale](https://tailscale.com/download),
lalu masuk ke tailnet yang sama dengan akses administrator Niskala. Dokumentasi
Tailscale menyarankan varian Standalone; gunakan satu varian yang sesuai dengan
perangkat. Akun/perangkat pribadi menggunakan identitas pengguna, bukan tag CI.

Alamat yang dicatat pada 21 Oktober 2026:

| Kegunaan | Tujuan |
|---|---|
| OpenSSH VPS | `ubuntu@100.64.182.105`, TCP 22 |
| MagicDNS VPS | `niskala-udara.tailc60422.ts.net` |
| Web produksi | `https://survey.esdm.cloud/` |
| Admin produksi | `https://survey.esdm.cloud/admin/` |
| Web privat opsional | `https://100.64.182.105:18443/` |

Login Tailscale memberikan jalur jaringan sesuai grant yang sudah ada. Login
tersebut belum mendaftarkan public SSH key Mac pada akun Linux. Pertahankan
Tailscale SSH nonaktif dan grant Windows/CI lama.

Web privat 18443 memakai certificate self-signed tersendiri; Mac tidak otomatis
memercayainya. Akses domain produksi menggunakan certificate edge Cloudflare.
Jika ingin mempercayai certificate privat, peroleh certificate publiknya melalui
jalur tepercaya dan lakukan pengaturan trust perangkat secara terpisah.

## 3. Buat key SSH khusus Mac

Pilih nama file yang belum digunakan. Pertahankan private key di Mac dan gunakan
passphrase ketika diminta. Jangan menimpa key yang sudah ada.

```bash
mkdir -p ~/.ssh
chmod 700 ~/.ssh
ssh-keygen -t ed25519 -f ~/.ssh/id_ed25519_surveey_mac -C surveey-mac
cat ~/.ssh/id_ed25519_surveey_mac.pub
```

Hanya satu baris public key `.pub` yang perlu didaftarkan ke
`/home/ubuntu/.ssh/authorized_keys` pada VPS. Tambahkan baris baru, pertahankan
semua baris lama beserta opsi pembatasannya. Gunakan sesi administrator Windows
yang sudah dipercaya atau console provider untuk pendaftaran pertama. Koneksi
Mac yang key-nya belum terdaftar tidak bisa dipakai untuk mendaftarkan dirinya.

Contoh **di PowerShell Windows yang sudah punya akses**, setelah mengganti
placeholder dengan public key Mac yang lengkap:

```powershell
$surveeyMacPublicKey = 'ssh-ed25519 GANTI_DENGAN_PUBLIC_KEY_MAC surveey-mac'
$surveeyMacPublicKey | ssh -o BatchMode=yes -o StrictHostKeyChecking=yes ubuntu@100.64.182.105 'umask 077; mkdir -p ~/.ssh; cat >> ~/.ssh/authorized_keys'
```

Jangan mengirim file tanpa akhiran `.pub`, mengganti key Windows/CI, atau
memasukkan key Mac ke akun `surveey-deploy` yang mempunyai forced command CI.

## 4. Tambahkan alias SSH pada Mac

Tambahkan blok berikut pada `~/.ssh/config` yang sudah ada. Pertahankan entry
server/proyek lain; jangan mengganti seluruh file.

```sshconfig
Host surveey-vps
    HostName 100.64.182.105
    User ubuntu
    IdentityFile ~/.ssh/id_ed25519_surveey_mac
    IdentitiesOnly yes
    StrictHostKeyChecking ask
    ServerAliveInterval 30
```

Fingerprint Ed25519 yang dicatat melalui jalur administrator tepercaya saat
persiapan:

```text
SHA256:XmIKOYMjqxvWiJgINH6dQhURTimreX4ehTu7vZ+jQLw
```

Cocokkan fingerprint pada koneksi pertama dengan catatan tepercaya tersebut.
Jika berbeda, cari penyebab/perubahan host melalui akses administrator atau
console provider sebelum menerima key baru; jangan otomatis menghapus entry
known_hosts atau menonaktifkan pemeriksaannya.

Setelah public key terdaftar dan fingerprint cocok, alias dipakai seperti ini:

```bash
ssh surveey-vps
```

Panduan ini tidak mengklaim koneksi dari Mac sudah diuji. Pendaftaran key serta
koneksi perangkat barunya dilakukan saat Mac tersebut tersedia.

## 5. Perubahan kode dan autodeploy

Kerjakan perubahan di checkout Mac, stage hanya file yang dimaksud, lalu commit
dan push ke master ketika memang hendak menerapkan perubahan ke produksi.

```bash
git pull --ff-only origin master
# Edit file yang diperlukan; ganti path di bawah dengan file perubahan sendiri.
git add -- path/ke/file
git commit -m "Jelaskan perubahan Surveey"
git push origin master
```

Push normal ke master memicu workflow VPS melalui Tailscale dan integrasi
autodeploy Railway secara terpisah. Keberhasilan salah satunya tidak membuktikan
yang lain berhasil. Pada uji 21 Oktober, VPS lolos; Railway masih tertahan dan
akses HTTP cadangannya belum terbukti. Lihat [hasil uji](autodeploy-test-2026-10-21.md).

SSH key, known_hosts dan konfigurasi OIDC untuk CI sudah tersimpan pada GitHub.
Tidak perlu memindahkan private key Windows atau membuat ulang credential CI
ketika pindah ke Mac. Lihat [nama Secrets/Variables](autodeploy-vps.md).

Untuk commit dokumentasi yang ingin melewatkan workflow VPS:

```bash
git commit -m "Perbarui dokumentasi operasional [skip actions]"
git push origin master
```

Penanda tersebut melewatkan workflow GitHub Actions pada push; jangan menganggap
semua integrasi eksternal, termasuk Railway, pasti ikut melewatkan deployment.
Jangan menonaktifkan autodeploy Railway hanya untuk menerbitkan dokumentasi.
Permintaan commit/push saja tidak berarti menjalankan tes tambahan.

## 6. Referensi perintah administrasi

Perintah berikut dibaca/dijalankan saat memang diperlukan dalam lingkup kerja
yang diminta. Bukan rangkaian pemeriksaan otomatis setiap commit.

Status layanan Surveey:

```bash
ssh surveey-vps 'sudo systemctl status surveey-admin.service surveey-public.service surveey-broker.service surveey-edge.service surveey-tunnel.service --no-pager'
```

Rilis aktif dan catatan aktivasi, tanpa membuka env:

```bash
ssh surveey-vps 'sudo cat /srv/surveey/current/activated.json'
```

Log backend yang dibatasi jumlah baris:

```bash
ssh surveey-vps 'sudo journalctl -u surveey-admin.service -u surveey-public.service -u surveey-broker.service -n 80 --no-pager'
```

Melihat workflow dari GitHub, jika diminta mengikuti deployment:

```bash
gh run list --repo bbreezyX/surveey --workflow deploy-vps.yml --branch master --limit 5
```

Untuk perubahan credential/config produksi, gunakan editor pada server, misalnya
`sudoedit /srv/surveey/private/admin.env` di sesi SSH administrator. Jangan
menampilkan env lewat `cat`, memasukkannya ke command line, atau menyalinnya ke
Git. Pertahankan role admin/public terpisah, TLS database, dan token broker
lokal; restart Surveey hanya jika perubahan/operasi itu memang diminta.

Jangan menjalankan `prepare-runtime.py`, `install-copy.py`, atau konfigurator
awal sekadar untuk memakai Mac. Sumber skrip disimpan sebagai referensi dan
tidak menggantikan [alur deploy aktif](autodeploy-vps.md).

## 7. Jika ingin kembali ke Railway

Ikuti [runbook kembali ke Railway](return-to-railway.md). Selama database/media
masih Railway, pengembalian aplikasi/domain tidak memerlukan restore database.
Jangan mengubah DNS sebelum menilai kesiapan target sesuai izin pemeriksaan;
temuan 404 dan build tertahan pada uji sebelumnya harus dituntaskan terlebih
dahulu. Untuk rollback **kode VPS**, gunakan bagian rollback pada panduan
autodeploy. Kedua operasi tersebut berbeda dan tidak menghapus sumber data.

## Referensi resmi

- [Varian Tailscale macOS](https://tailscale.com/docs/concepts/macos-variants)
- [Membuat SSH key Ed25519](https://docs.github.com/en/authentication/connecting-to-github-with-ssh/generating-a-new-ssh-key-and-adding-it-to-the-ssh-agent)
- [GitHub CLI auth login](https://cli.github.com/manual/gh_auth_login)
- [GitHub CLI setup Git credentials](https://cli.github.com/manual/gh_auth_setup-git)
