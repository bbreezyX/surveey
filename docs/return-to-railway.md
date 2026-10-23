# Mengembalikan produksi Surveey ke Railway

**Perubahan keadaan 22 Oktober 2026:** PostgreSQL dan media aktif kini berada
di VPS. Railway menyimpan snapshot lama dengan writer dibatasi. Ikuti
[runbook data VPS](vps-data-migration-2026-10-22.md) dan skenario migrasi data
terbaru; prosedur pengalihan aplikasi saja pada bagian A merupakan arsip kondisi
hybrid sebelumnya. Jangan membuka writer Railway atau mengubah DNS sebelum
seluruh perubahan VPS terbaru dipindahkan dengan jeda penulisan yang terkoordinasi.

Dokumen operasional dibuat 21 Oktober 2026. Ini panduan untuk pelaksanaan berikutnya, bukan pernyataan bahwa pemindahan kembali sudah dilakukan. Baca keadaan aktual sebelum menjalankannya; alamat, versi, kredensial, dan status deployment dapat berubah.

Untuk melanjutkan dari Mac, mulai dari [handoff Railway–VPS](railway-vps-handoff.md)
dan [panduan akses Mac](mac-operations.md). Tidak perlu memindahkan credential CI
atau menyalin `.local` Windows untuk menjalankan operasional yang sudah ada.

**Bukti terakhir saat uji 21 Oktober 2026 pukul 23.15 WIB:** autodeploy VPS
berhasil, sementara check suite Railway masih queued dan akses langsung Railway
merespons `404 Application not found`. Status API Online belum membuktikan target
siap menerima produksi. Temuan itu perlu dituntaskan sebelum pengalihan DNS;
lihat [hasil uji dan batasnya](autodeploy-test-2026-10-21.md). Catatan ini tidak
menggantikan pembacaan kondisi aktual saat pemindahan nanti.

Keputusan historis 21 Oktober: **tunda penghentian aplikasi Railway; biarkan Railway menyala sebagai cadangan utama**. Instruksi migrasi penuh 22 Oktober kemudian mengizinkan pemindahan data dengan sumber Railway tetap disimpan. Writer admin Railway dihentikan untuk pemindahan dan login role sumber dibatasi. Riwayat percobaan 0 replica/penghentian CLI serta pembatalan Remove Deployment sebelumnya tidak menjadi instruksi untuk menghapus resource.

Autodeploy frontend `surveypjuts` sempat dinonaktifkan saat persiapan penghentian, lalu dipulihkan ke branch `master`; hasil UI kembali menampilkan **Auto deploys when pushed to GitHub**. Pengaturan autodeploy dua aplikasi lainnya tidak diubah. Tidak ada pemeriksaan fungsional tambahan untuk pembatalan ini.

**23 Oktober 2026: autodeploy GitHub ketiga aplikasi Railway dimatikan.** Setelah migrasi data, setiap push ke `master` tetap membangun ketiga aplikasi Railway. `survey-public-data` selalu gagal healthcheck (`role "survey_public_app" is not permitted to log in`) dan meninggalkan check merah pada commit, padahal deploy VPS sukses. Deployment trigger GitHub `surveypjuts` (`77e0bba3-440e-4024-b075-0b638f95d948`), `survey-admin` (`8b59e965-7a97-4df0-ba53-3275a242797e`) dan `survey-public-data` (`78b5a654-26cd-41dd-9c6e-0cafc868ed6b`) dihapus melalui `deploymentTriggerDelete`, sama dengan tombol **Disable** di UI. Source `bbreezyX/surveey`, service, variabel, deployment terakhir (`f71e96f`), Postgres, volume dan bucket tidak diubah. Untuk menyalakan lagi, klik **Enable** di Settings tiap service, atau jalankan per service:

```bash
railway api 'mutation($i:DeploymentTriggerCreateInput!){deploymentTriggerCreate(input:$i){id}}' --var 'i={"projectId":"ebebdd21-0358-4ab1-a0d5-1afe4ee2673b","environmentId":"6abf965b-42d4-44ad-8b15-55c8be2adc76","serviceId":"<service id>","provider":"github","repository":"bbreezyX/surveey","branch":"master","checkSuites":false}'
```

## Arsip posisi data sebelum migrasi 22 Oktober

| Komponen | Lokasi produksi yang digunakan |
| --- | --- |
| Aplikasi produksi publik, admin, public delivery dan media broker | VPS Niskala, direktori khusus `/srv/surveey` |
| Aplikasi cadangan yang dipertahankan menyala | Railway: `surveypjuts`, `survey-admin`, `survey-public-data` |
| PostgreSQL, termasuk akun, sesi, titik, draft, publikasi dan metadata media | Railway, service `Postgres` |
| Objek media produksi | Bucket Railway `survey-private-media` |
| Domain `survey.esdm.cloud` | Cloudflare Tunnel menuju Surveey di VPS |
| PostgreSQL lokal VPS | Cluster kosong dari persiapan awal; bukan sumber data produksi |
| `/srv/surveey/media` | Salinan awal media; bukan bucket produksi terkini |

**Untuk kembali penuh ke Railway dari posisi ini, tidak perlu memigrasikan atau me-restore database.** Perubahan melalui aplikasi VPS sudah masuk ke database dan bucket Railway yang sama. Aplikasi Railway dapat menggunakan data tersebut lagi setelah diaktifkan.

Belum ada arsip `pg_dump` produksi yang berhasil dibuat/disalin pada pekerjaan persiapan VPS ini. Adanya dokumen ini, direktori snapshot, runtime PostgreSQL, atau salinan media awal tidak berarti tersedia backup database terkini.

## Identitas yang harus dipertahankan

| Resource | ID atau nilai saat dicatat |
| --- | --- |
| Railway project `survey` | `ebebdd21-0358-4ab1-a0d5-1afe4ee2673b` |
| Environment `production` | `6abf965b-42d4-44ad-8b15-55c8be2adc76` |
| `survey-admin` | `55d8e517-529a-4985-bc66-0bad6f5e16d4` |
| `survey-public-data` | `873d72e9-1711-495d-b62d-825681972117` |
| `surveypjuts`, frontend/proxy publik | `09469b8d-578c-4c02-89dd-0b62de14d6ca` |
| `Postgres` | `ca38ef07-1f75-4191-a905-af3a9af4a423` |
| `postgres-volume` | `bcb907f0-4de2-4701-8c52-8bc76016464f` |
| `survey-private-media` | `47e77464-c207-4932-b355-2d3773dd05bb` |
| GitHub source | `bbreezyX/surveey`, branch `master` |
| Region aplikasi yang tersimpan sebelum penghentian | `asia-southeast1-eqsg3a`, masing-masing 1 replica |
| Cloudflare account | `b609d8c1b1f93a0ef108139c90542382` |
| Cloudflare zone `esdm.cloud` | `3e88bf5e9e5528a510f59e177e31f391` |
| Tunnel `surveey-niskala-vps` | `6e53a53e-ff83-45c6-a2a4-dd30fa5c33e5` |

Snapshot konfigurasi sebelum permintaan penghentian yang kemudian ditunda ada di `.local/vps-copy/railway-apps-before-pause.json` pada checkout persiapan Windows. Direktori `.local` diabaikan Git; file itu tidak tersedia setelah clone di Mac. ID dan pembagian resource yang dibutuhkan sudah dicatat pada tabel di atas. Bila memerlukan snapshot privat tersebut, ambil melalui perangkat/penyimpanan administrasi yang berwenang; jangan menganggapnya backup database.

## A. Arsip pengalihan aplikasi ketika sumber data masih Railway

1. Buka project dan environment yang tercantum di atas. Baca status aplikasi, PostgreSQL, volume, bucket, dan pending changes. Jangan menerapkan pending changes milik pekerjaan lain. Jangan membuat ulang atau mengganti PostgreSQL/bucket yang masih menjadi sumber data.
2. Pilih revisi aplikasi yang disetujui dan kompatibel dengan schema database saat itu. Pertahankan service, variabel, private networking dan domain yang ada. Jangan menjalankan migrasi schema sekadar untuk memindahkan lokasi aplikasi.
3. Aktifkan `survey-admin` dan `survey-public-data` terlebih dahulu, kemudian `surveypjuts`. Jika deployment sebelumnya dihentikan/removed, gunakan tindakan manual **Deploy Latest Commit** pada source/branch yang benar atau tindakan redeploy yang tersedia untuk deployment yang dipilih. Jika suatu hari penghentian memakai 0 replica, kembalikan region yang tersimpan ke 1 replica. Jangan menganggap setting 0 replica berhasil hanya karena pernah direncanakan.
4. Bila GitHub autodeploy dinonaktifkan saat penghentian, deployment manual tetap dapat dipilih dari kontrol Railway. Mengaktifkan kembali autodeploy adalah keputusan tersendiri; lakukan bila memang ingin setiap push berikutnya kembali mendeploy ke Railway. Source GitHub tidak perlu diputus atau dipasang ulang.
5. Pastikan konfigurasi Railway menggunakan database melalui private networking Railway, role aplikasi admin dan public yang berbeda, serta bucket Railway yang sama. Pertahankan signing secret Django bila sesi yang sudah ada hendak tetap dikenali. Jangan mengganti koneksi aplikasi dengan kredensial operator/superuser.
6. Pertahankan konfigurasi admin/public/media broker yang memang dipakai Railway. Token broker pada VPS dibuat terpisah; jangan menyalinnya ke Railway tanpa penyesuaian pasangan layanan yang lengkap. Dokumen ini hanya mencantumkan nama dan lokasi kredensial, tidak nilainya.
7. Setelah deployment Railway tersedia, selesaikan pemeriksaan yang secara eksplisit diizinkan pengguna. Cakupan yang relevan: status deployment, `/`, redirect `/admin` ke `/admin/`, halaman login dan aset, data publik, satu media yang sudah terbit, serta penolakan API anonim. Uji login/edit/upload hanya bila diizinkan karena dapat mengubah sesi, audit atau data. Perintah deploy saja tidak memberi izin untuk pemeriksaan tambahan.
8. Ubah **hanya** record produksi `survey.esdm.cloud` sesuai tabel DNS di bawah. Tetap simpan TXT `_railway-verify.survey.esdm.cloud`. Jangan mengubah root domain, `www`, `arsip`, domain Niskala atau record lain.
9. Beri kesempatan cache DNS lama berakhir. Selama masa transisi, VPS dan Railway boleh tetap menyala karena keduanya memakai sumber database/media yang sama, sepanjang revisi dan schema kompatibel. Jangan menghentikan VPS sebagai bagian dari perubahan DNS yang belum selesai.
10. Setelah pengguna menyetujui pelepasan VPS dan tersedia bukti yang memadai sesuai izin pemeriksaan, hentikan hanya service Surveey yang diminta. Simpan file dan konfigurasi sebagai jalur kembali. Jangan mematikan Niskala, Caddy Niskala, SSH atau Tailscale.

### Nilai DNS untuk kembali

| Field | Nilai Railway yang disimpan |
| --- | --- |
| Name | `survey.esdm.cloud` |
| Type | `CNAME` |
| Target | `kly7n6wa.up.railway.app` |
| Proxy | **DNS only** |
| TTL | **Auto** |

Target tersebut berasal dari record produksi sebelum cutover VPS. Baca kembali domain yang masih terpasang di service `surveypjuts` sebelum menggunakannya; jangan memakai target lama jika Railway sudah menggantinya.

Target saat berada di VPS adalah CNAME `6e53a53e-ff83-45c6-a2a4-dd30fa5c33e5.cfargotunnel.com`, **Proxied**, **TTL Auto**. Pertahankan tunnel sampai pengguna meminta penonaktifan atau penghapusannya. Tidak perlu menghapus domain atau tunnel untuk mengubah CNAME.

### Data dan konfigurasi rahasia

Variabel sumber Railway harus dipertahankan, terutama `DATABASE_URL`, `DJANGO_SECRET_KEY`, daftar host/origin, kredensial S3, dan pasangan token broker. File VPS yang relevan ada di `/srv/surveey/private`, dimiliki root dan tidak boleh dimasukkan Git, ditampilkan dalam chat atau disalin ke static root. `/srv/surveey/PRODUCTION_CUTOVER.json` dan `/srv/surveey/private/production-dns-before.json` mencatat pengalihan domain; keduanya bukan backup data.

TCP proxy PostgreSQL `centerbeam.proxy.rlwy.net:29929` masih dibutuhkan selama VPS memakai database Railway. Jangan menonaktifkannya hanya karena aplikasi Railway dinyalakan lagi. Setelah VPS benar-benar tidak memakai database itu, perubahan akses proxy dapat direncanakan terpisah.

## B. Kembali ke Railway setelah database produksi pindah ke VPS

Database produksi sudah dipindahkan ke VPS pada 22 Oktober. Bagian ini tetap
merupakan rencana untuk pemindahan balik yang belum dijalankan; cocokkan dengan
[runbook data VPS](vps-data-migration-2026-10-22.md). Jangan memakai cluster kosong
`/srv/surveey/postgres`, database percobaan, atau snapshot lama sebagai sumber produksi.

1. Catat database sumber yang benar, versi PostgreSQL, extensions, schema/migrasi, role, ukuran, lokasi media, dan aplikasi/proses yang masih menulis. Siapkan Railway PostgreSQL tujuan yang kompatibel dan baru/kosong agar database lama tetap utuh. Biaya dan pembuatan resource baru memerlukan cakupan persetujuan pengguna.
2. Tentukan waktu pengalihan. Untuk migrasi logical dump tanpa replikasi, jeda **semua** penulisan Surveey selama dump final, restore, dan pengalihan koneksi. Ini termasuk admin pada kedua host dan job yang menulis. Snapshot dump konsisten sendiri tidak menangkap tulisan yang datang setelah snapshot; tanpa jeda atau sinkronisasi lanjutan, tulisan tersebut dapat tertinggal.
3. Buat logical dump baru dengan `pg_dump` format custom dari sumber produksi yang benar. Gunakan client yang mendukung versi server sumber dan rencanakan target kompatibel. Arsipkan secara privat beserta timestamp UTC, identitas sumber, revisi aplikasi dan metadata migrasi. Kredensial harus melalui mekanisme privat; jangan menuliskannya di argumen shell, dokumen atau Git.
4. Siapkan roles/extensions yang dibutuhkan, lalu restore ke database tujuan baru dengan `pg_restore`. Ownership dan grants harus direncanakan agar admin, public delivery dan broker tetap memakai role dengan izin yang sesuai. `pg_dump` satu database tidak mencakup seluruh role global. Jangan memakai restore yang menghapus atau menimpa database Railway/VPS yang masih menyimpan data aktif.
5. Jika media tetap di Railway, tidak perlu menyalin objek. Jika media kelak ikut berpindah, salin objek produksi terkini ke bucket tujuan sambil mempertahankan key dan metadata yang dirujuk database. Sinkronkan perubahan final pada jendela jeda yang sama; simpan sumber. Snapshot awal 1.190 objek tidak boleh dianggap inventaris produksi terkini.
6. Lakukan pemeriksaan integritas yang diizinkan secara eksplisit: hasil dump/restore, schema, jumlah entitas, publikasi aktif, hubungan media, akun dan izin. Status HTTP 200 saja tidak membuktikan seluruh data lengkap. Jangan membuka aplikasi untuk penulisan sebelum keputusan pengalihan disetujui dan kekurangan bukti diterangkan.
7. Perbarui koneksi aplikasi Railway ke database/bucket tujuan, pertahankan pemisahan role dan signing secret bila sesuai, lalu ikuti alur aktivasi aplikasi dan DNS pada bagian A. Simpan database/objek sumber sampai masa retensi yang disetujui selesai; penghapusan memerlukan instruksi terpisah.
8. Setelah tulisan baru masuk ke database Railway tujuan, database VPS lama menjadi tertinggal. Kembali ke VPS setelah titik ini memerlukan sinkronisasi balik tulisan baru; mengubah DNS saja tidak cukup. Jika ada kegagalan, jeda penulisan lagi dan rekonsiliasi data sebelum memilih sumber yang akan diteruskan.

Tidak ada dump, restore, pengubahan role, pembuatan database baru, penghentian penulisan atau penghapusan resource yang dilakukan hanya karena dokumen ini dibuat.

## Kondisi pemeriksaan yang sudah pernah dilakukan

Pada 21 Oktober 2026 sekitar 22.47 WIB, pemeriksaan anonim yang diminta pengguna mengembalikan publik 200, `/admin` 308 menuju `/admin/`, login admin 200, empat aset JS/CSS 200, GeoJSON 200 berisi 547 feature, dan API sesi anonim 401. Penghitung tunnel VPS bertambah tepat 9 permintaan dengan nol error tunnel. Ini bukti akses melalui VPS pada saat pemeriksaan tersebut, bukan hasil pemeriksaan setelah aplikasi Railway dihentikan dan bukan uji login/edit/upload atau latihan pemulihan.

## Referensi

- [Catatan persiapan dan pengalihan VPS](vps-copy.md).
- [Konfigurasi deployment Railway di repo](railway-deployment.md).
- [Railway: GitHub autodeploy dan deployment manual](https://docs.railway.com/deployments/github-autodeploys).
- [Railway: tindakan deployment](https://docs.railway.com/deployments/deployment-actions).
- [Railway: backup dan restore PostgreSQL](https://docs.railway.com/guides/postgres-backups-restores).
- [PostgreSQL: pg_dump](https://www.postgresql.org/docs/current/app-pgdump.html).
- [PostgreSQL: pg_restore](https://www.postgresql.org/docs/current/app-pgrestore.html).
