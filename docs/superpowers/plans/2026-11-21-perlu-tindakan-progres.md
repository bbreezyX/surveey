# Rencana Perlu Tindakan di Progres

Petugas memilih desa dan tahap untuk melihat patok yang bisa dilaporkan, laporan yang perlu dikirim ulang, dan bukti foto yang masih perlu dilengkapi. Satu patok bisa menunggu pemeriksaan untuk Galian sekaligus siap dilaporkan untuk Cor.

## Tampilan untuk petugas

- Buka `Perlu Tindakan` dari `Progres` setelah memilih kabupaten/kota. Kelompokkan hasil per desa di dalam kecamatan agar desa dengan nama sama tetap mudah dibedakan. Sediakan filter `Desa` dan `Tahap` dengan pilihan `Semua`, `Galian`, `Cor`, `Tiang`, dan `Lampu`. Ingat pilihan saat petugas kembali dari detail atau pelaporan.
- Tampilkan nomor patok, tahap yang memerlukan tindakan, dan status laporan sebelumnya apabila relevan. Ketuk baris untuk melihat posisi di peta. Beri satu aksi utama per patok dan tahap, yaitu `Lapor`, `Kirim Ulang`, atau `Tambah Foto`.
- Hitung tindakan per pasangan patok dan tahap. Patok yang memerlukan tindakan untuk dua tahap dapat muncul di keduanya. Hitung laporan yang menunggu secara terpisah dan beri satuan yang sesuai pada setiap angka.
- Surveey belum memiliki `DESIGN.md`. Gunakan panel, baris, chip, dan token warna `Progres` yang sudah ada. Pakai label teks untuk setiap status. Tata baris agar nomor patok, tahap, dan aksi terbaca pada ponsel. Ikuti `DESIGN.md` PJUTS ESDM saat menyesuaikan `Detail Titik`.

Contoh baris untuk filter `Cor`.

| Patok | Tindakan | Status laporan sebelumnya | Aksi |
| --- | --- | --- | --- |
| 023 | Cor Pondasi perlu dilaporkan | Galian menunggu diperiksa | `Lapor` |

## Status tiap laporan

Satu pengiriman memiliki satu identitas. Status tahap pada peta tetap dipakai untuk progres konstruksi. Status tinjauan dan jumlah foto berasal dari laporan yang bersangkutan.

| Label | Kapan muncul | Tindakan petugas |
| --- | --- | --- |
| `Draf di HP Ini` | Foto disimpan di perangkat sebelum `Kirim` | Lanjutkan draf di `/lapangan` |
| `Menunggu Jaringan` / `Mengunggah` | Antrean di perangkat sedang menunggu atau mengirim | Lihat antrean di `/lapangan` |
| `Sebagian Foto Terkirim` / `Gagal Kirim` | Hanya sebagian foto sampai, atau pengiriman gagal | Lihat jumlah foto dan penyebabnya di `/lapangan` |
| `Menunggu Diperiksa` | Laporan sudah bisa diperiksa dan keputusan masih tertunda | Buka detail laporan. Tampilkan jumlah foto jika pengiriman belum lengkap |
| `Diterima` | Peninjau menerima pengiriman tersebut | Lihat tahap dan patok tempat laporan dicatat |
| `Ditolak` | Peninjau menolak pengiriman tersebut | Lihat alasan di `/lapangan` dan pilih `Kirim Ulang` jika bukti masih diperlukan |
| `Dibatalkan` | Pengiriman ditarik kembali | Lihat di riwayat |

Saat laporan sudah diputuskan, tampilkan keputusan dan jumlah foto sebagai informasi terpisah. Contohnya `Diterima · 1 dari 3 foto` jika peninjau menerima laporan sebelum semua foto sampai. Status draf dan antrean pada perangkat muncul di `/lapangan`, yang menyimpan foto dan antrean tersebut.

## Aturan tindakan per tahap

1. Ambil tahap berikutnya dari aturan yang dipakai `/lapangan`. Saat Galian menunggu pemeriksaan, tampilkan Cor jika bisa dilaporkan. Saat Cor juga menunggu, tawarkan Tiang jika memenuhi aturan yang sama. Pemeriksaan dan validasi pengiriman tetap berjalan di PJUTS ESDM.
2. Terapkan pembatasan duplikat pada patok dan tahap yang sama. Begitu Cor sudah punya laporan terbuka, baris menampilkan `Cor menunggu diperiksa` dan menawarkan tindakan berikutnya yang tersedia. Status Galian tetap bisa dibuka di riwayat titik.
3. Gunakan `Kirim Ulang` ketika laporan yang dibutuhkan ditolak, bukti tahap masih belum terpenuhi, dan belum ada pengiriman pengganti yang sedang diperiksa. Pengiriman pengganti mendapat status sendiri. Laporan pada tahap lain mengikuti hasil tinjauannya masing-masing.
4. Gunakan `Tambah Foto` jika tahap tercatat melalui laporan tahap lain dan belum punya bukti fotonya sendiri. Khusus Lampu yang tercatat bersama Tiang, perlakukan foto tambahan sebagai pilihan di detail titik. Masukkan Lampu ke antrean bila ada laporan Lampu yang memang perlu dikirim, dilengkapi, atau diperbaiki. Ini asumsi untuk versi awal.
5. Saat data yang tampil berasal dari salinan terakhir, tandai umur atau keadaan datanya. `/lapangan` memakai data terbaru yang tersedia sebelum menawarkan pengiriman. Jika petugas lain baru mengirim untuk tahap tersebut, pilih tindakan berdasarkan status yang sekarang dan beri akses ke riwayat.

## Urutan implementasi

1. **Sediakan data tindakan di PJUTS ESDM.** Gunakan aturan tahap di `lib/field/jobs.ts` dan data laporan serta bukti di `lib/field/points.server.ts`. Tambahkan ringkasan tindakan per `Nomor` ke `/api/public/survey-progress` dengan tahap, jenis tindakan, dan tahap yang menunggu. Pertahankan kontrak progres yang sudah dipakai peta. Gunakan status ringkas di feed publik dan detail tinjauan di `/lapangan`. Ambil ringkasan dalam satu permintaan progres.
2. **Buat tanda terima berdasarkan pengiriman.** Respons unggah di PJUTS ESDM sudah mengembalikan `reportId`. Simpan referensi itu bersama antrean dan gunakan `publicReportKey` sebagai bagian dari referensi baca tanda terima. Teruskan referensi ke Surveey saat kembali dari `app/lapangan/survey-return.ts`. Resolusi tanda terima memakai ID laporan yang stabil dan mengembalikan keputusan, jumlah foto, serta patok dan tahap hasil pencatatan. Simpan `clientId` asli di `/lapangan`. Di Surveey, pakai referensi untuk memperbarui tanda terima pada detail patok dan laporan terakhir. Selama status belum tersedia, tampilkan `Status Laporan Belum Tersedia`.
3. **Tambahkan `Perlu Tindakan` di Surveey.** Baca ringkasan di `src/public/data/progress.ts` dan gunakan di `src/public/components/WorkList.svelte` serta `Sidebar.svelte`. Render tindakan dan status menunggu di baris yang sama. Saat ringkasan tindakan belum tersedia, peta tetap bisa menampilkan progres dengan status daftar tindakan belum tersedia.
4. **Hubungkan tombol dengan tahap yang dipilih.** Tambahkan parameter `tahap` pada tautan dari `src/shared/survey/report.ts`. Pada `Detail Titik`, pilih tahap itu dan tampilkan patok untuk dikonfirmasi sebelum petugas membuka formulir. Gunakan draf lama ketika patok dan tahap cocok. Tautan yang hanya memuat `nomor` mengikuti alur yang sudah ada.

## Hasil yang diharapkan

- Progres Desa A dengan filter Cor menampilkan Patok 023 dengan laporan Galian yang masih diperiksa. Tombol `Lapor` membuka Detail Titik pada tahap Cor.
- Setelah Cor terkirim, Patok 023 menampilkan status Cor yang sebenarnya. Jika Tiang tersedia, tindakan Tiang muncul pada filter yang sesuai.
- Patok yang sudah `Terpasang` bisa memiliki pengiriman Lampu baru berstatus `Menunggu Diperiksa` atau `Ditolak`. Tanda terimanya mengikuti pengiriman baru tersebut.
- Jika peninjau menerima laporan pada patok atau tahap yang dikoreksi, tanda terima menampilkan hasil pencatatan itu dengan referensi pengiriman yang sama.
