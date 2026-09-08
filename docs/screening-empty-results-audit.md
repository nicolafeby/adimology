# Audit hasil kosong dan login — 8 September 2026

## Hasil run yang benar-benar tersimpan

Audit baca-saja ada di [screening-run-audit.json](screening-run-audit.json). Tidak membuat run atau menulis database.

| Preset / run | Temuan |
| --- | --- |
| BPJS `8b4fff7e` | 966 watch, 0 passed, 0 data valid, 0 analisis lanjutan selesai. Cutoff 8 September 06:28:21 WIB berada di luar jendela entry 09:15–10:30. |
| BSJP `383b339d` | Run failed; tidak ada hasil simbol tersimpan. Penyebab teknis rinci belum terverifikasi. |
| SWING `4058e9aa` | 65 lolos pre-screen, tetapi 0 analisis lanjutan selesai; 104 processing error, 862 dilewati. Lolos pre-screen belum sama dengan final Passed. |
| ARA `c773fd23` | 966 watch, 0 passed, 0 data valid. Cutoff 7 September 21:50 WIB; data resmi ARA dan input intraday tidak tersedia. |

Jumlah `source_snapshots` dengan tipe `strategy_screening_input` dan payload: **0**. BPJS/BSJP/ARA membaca kontrak arsip tersebut; belum ada adapter otomatis yang mengisinya dari provider. Daily OHLCV tidak digunakan sebagai pengganti intraday.

Seluruh 966 hasil BPJS gagal `required_data`, `continuous_session` dan `entry_window`. Kekurangan yang tercatat: kalender terverifikasi, candle intraday selesai sejak awal sesi, minimal lima sesi volume pembanding pada jam sama, dan orderbook dengan timestamp yang cukup segar. Masuk ke jendela waktu yang benar saja belum mencukupi tanpa sumber tersebut. Angka Passed tidak dipaksakan dengan melonggarkan threshold.

## Perbaikan ringkasan

Sebelumnya `dataAcquisitionSucceeded` menghitung semua baris tanpa error acquisition. Query arsip yang berhasil tetapi menghasilkan data kosong ikut terhitung sebagai 966 “Data tersedia”. Sekarang API dan UI menggunakan **Data wajib valid**, diturunkan dari aturan data pada setiap hasil. Run lama juga mendapat ringkasan yang dihitung ulang saat dibaca; prediksi/database historis tidak diubah.

Saat nol Passed, panel alasan tetap terlihat meskipun filter Passed dipilih. Panel menampilkan jumlah data wajib yang kurang, jendela entry, analisis yang dilewati, dan alasan agregat. Tombol “Lihat alasan Watch” atau “Lihat kegagalan proses” membuka kelompok yang relevan. Kegagalan momentum/VWAP akibat data kosong tidak disajikan sebagai bukti bahwa harga benar-benar gagal faktor tersebut.

`completed` merupakan akhir proses pemeriksaan. Pada run BPJS tersebut analisis lanjutan justru dilewati untuk 966 saham; status proses tidak menyatakan strategi siap dieksekusi.

## Penyebab layar login terakhir

Request `check-password` perlu membaca pengaturan keamanan dari Supabase. Audit koneksi langsung, terpisah dari Next.js/browser, menunjukkan:

- DNS menghasilkan alamat IPv4 dan koneksi TCP/TLS berhasil.
- Gateway REST tanpa kredensial merespons 401 dalam 117 ms.
- Query baca nama key `password_enabled` melalui REST dengan anon key maupun service role tidak mendapat respons dalam 8 detik.
- Endpoint Supabase `/auth/v1/health` merespons **504** dalam sekitar 5,2 detik.

Bukti tersebut mengisolasi kegagalan ke layanan backend proyek Supabase. Belum ada bukti apakah penyebab dasarnya resource database, status proyek, atau gangguan internal layanan. Pemeriksaan tambahan detail kegagalan SWING/BSJP juga tidak berhasil; penyebab spesifik run tersebut tidak diklaim sudah ditemukan.

Timeout aplikasi tidak memulihkan backend Supabase. Batas waktu kini 5 detik untuk pembacaan pengaturan server dan 10 detik untuk request browser; gagal tetap menutup gate, tidak mengaktifkan guest session. API membedakan `AUTH_SETTINGS_TIMEOUT` dan `AUTH_SETTINGS_UNAVAILABLE`, dengan pesan tetap yang aman. Tombol retry memakai tampilan tombol aplikasi.

Langkah operator: periksa status layanan serta Database Reports/Logs pada dashboard proyek. Panduan resmi [diagnosis HTTP API Supabase](https://supabase.com/docs/guides/troubleshooting/http-api-issues) dan [connection timeout](https://supabase.com/docs/guides/troubleshooting/failed-to-run-sql-query-connection-terminated-due-to-connection-timeout) menjelaskan pemeriksaan resource dan pemulihan layanan. Audit ini tidak menjalankan restart atau perubahan database remote.

## Validasi

Regresi penghitung data dan skenario BPJS 966 watch diuji dengan fixture; pengujian browser mencakup alasan kosong ketika filter Passed aktif dan pemulihan request login yang sengaja digantung. Hasil lengkap ada di [screening-validation.md](screening-validation.md). Keberhasilan mock membuktikan perilaku aplikasi ketika provider gagal; bukan bukti backend Supabase telah pulih.

Untuk mengulang audit run setelah layanan pulih:

```sh
node --env-file=.env.local --import tsx scripts/screening-run-audit.ts
```
