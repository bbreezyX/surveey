# Optimasi latensi admin dan foto

Perubahan source disiapkan pada 22 Oktober 2026 berdasarkan pengukuran langsung
VPS dan domain produksi dalam percakapan yang sama. Pengguna meminta optimasi
tanpa tes. Pengguna kemudian mengizinkan commit, push, deployment VPS, dan
pembaruan receiver, tetap tanpa tes. Build paket rilis merupakan bagian
deployment; tidak mencakup test, typecheck, lint, atau pemeriksaan HTTP.
Angka pengukuran sebelumnya tidak membuktikan hasil perubahan ini. Hasil
aktivasi rilis dicatat oleh workflow GitHub Actions dan `activated.json`.

## Perubahan aplikasi

- Dashboard memanggil `GET /admin/api/bootstrap` untuk sesi, daftar awal titik,
  statistik, celah penomoran, dan titik peta dalam satu request. Endpoint sesi,
  daftar, dan peta yang lama tetap tersedia untuk tindakan berikutnya dan klien lama.
- Ringkasan titik hanya diambil sekali dalam satu request untuk dipakai bersama
  oleh statistik, celah penomoran, dan data peta. Data yang dapat diedit tidak
  disimpan dalam cache lintas request.
- Hitungan draf detail digabung ke query titik. Foto bukti observasi diambil
  dengan prefetch agar jumlah query tidak bertambah untuk setiap observasi.
- Pembatasan request PostgreSQL memakai satu `INSERT ... ON CONFLICT ...
  RETURNING`. Reset jendela dan penambahan penghitung dilakukan atomik di database.
  Batas request, pemeriksaan akun, aturan sesi, CSRF, dan izin tetap berlaku.
- Izin foto publik memakai subquery `EXISTS` dalam pencarian foto, termasuk
  pemeriksaan grant publikasi aktif sebelum cache maupun respons 304.
- Foto tampilan admin memakai cache privat `/tmp/survey-admin-media-cache`.
  Foto publik tetap memakai `/tmp/survey-media-cache`. Direktori terpisah dari
  web root; setiap request tetap melewati pemeriksaan izin yang sesuai. Foto
  asli admin tetap di-stream dari penyimpanan, tanpa cache file baru.
- Cache menyimpan hanya payload yang cocok dengan checksum. Penulisan atomik
  memakai file privat, request serentak ke checksum sama digabung per worker,
  dan setiap direktori dibatasi sekitar 512 MiB dengan penghapusan entri lama.
  Batas tersebut bersifat perkiraan saat beberapa proses menulis bersamaan.
  Kegagalan menulis cache tidak menggagalkan pengiriman foto yang sudah diambil.

Tidak ada perubahan skema atau migrasi database yang diperlukan. Respons admin
tetap `private, no-store`; cache file server tidak mengubah kebijakan cache browser.

## Konfigurasi VPS yang disiapkan

Sumber receiver rilis dan konfigurator awal kini memakai satu worker `gthread`
per backend, dengan empat thread admin dan dua thread public/broker. Tujuannya
memungkinkan request menunggu jaringan tanpa menghentikan semua request lain,
sambil mempertahankan satu proses per backend dan batas resource Surveey.

`/usr/local/libexec/surveey-release.py` di VPS merupakan receiver root-owned
di luar paket aplikasi. Push biasa tidak memperbaruinya. Saat perubahan ini
akan diterapkan, receiver tersebut perlu diperbarui dari sumber repository
yang telah memuat perubahan metadata branch sebelumnya. Receiver kemudian
menulis konfigurasi thread ketika mengaktifkan rilis berikutnya.

Jangan menjalankan ulang `configure-railway-data.py` pada server aktif hanya
untuk mengganti thread; skrip tersebut adalah konfigurator persiapan awal.
Pembaruan receiver mempertahankan dukungan metadata branch yang sudah dipasang
sebelumnya, menyimpan backup, dan memakai lock autodeploy. Unit Surveey ditulis
oleh receiver ketika rilis diaktifkan; batas resource dan layanan Niskala
berada di luar perubahan ini.

Panduan aktivasi dan rollback kode tetap mengikuti [autodeploy VPS](autodeploy-vps.md).
Pengukuran hasil, pengujian akses/revokasi/sesi, dan pemeriksaan runtime menunggu
permintaan pengguna berikutnya.
