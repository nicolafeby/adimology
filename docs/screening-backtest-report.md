# Laporan backtest Screening

**Backtest pasar: `insufficient_data` untuk BPJS, BSJP, SWING dan ARA.** Tidak tersedia periode/universe historis yang dapat diverifikasi untuk menjalankan validasi pasar keempat versi strategi ini. Tidak dilaporkan angka win rate, return, expectancy, profit factor atau drawdown pasar yang dibuat dari fixture.

## Bukti data

Audit asli baca-saja terbaru pada 7 September 2026 pukul 14:46 UTC tercatat di [`screening-data-audit.json`](screening-data-audit.json). Database berisi 1.006 snapshot existing, 966 anggota universe terkini, dan nol source archive dengan payload non-null. Kolom strategi kini dapat dibaca; nol snapshot per preset memenuhi identitas baru, point-in-time dan backtest eligibility. Migration produksi tidak dijalankan oleh pemeriksaan ini. Audit run tanggal 8 September dicatat terpisah di [`screening-empty-results-audit.md`](screening-empty-results-audit.md).

Probe Stockbit BBCA: OHLCV **daily** HTTP 200, 19 candle 10 Agustus–7 September 2026; orderbook HTTP 200, tanpa timestamp observasi yang dapat diverifikasi oleh adapter. Sampel ini hanya membuktikan akses endpoint dan format data yang tersedia. Bukan universe/periode backtest dan tidak digunakan sebagai intraday.

| Preset | Periode/universe pasar valid | Signal/entry/closed/pending/ambiguous/exclusion pasar | Metrik trading | Data yang kurang |
| --- | --- | --- | --- | --- |
| BPJS | Belum tersedia | Belum dapat dievaluasi | Tidak dihitung | Intraday selesai, volume jam setara, timestamp book, kalender, universe/corporate actions, entry/exit hari sama |
| BSJP | Belum tersedia | Belum dapat dievaluasi | Tidak dihitung | Data BPJS ditambah sesi berikutnya termasuk libur/suspensi serta harga gap pagi |
| SWING | Belum tersedia untuk model v8 dan provenance baru | Belum dapat dievaluasi | Tidak dihitung | Immutable snapshot kompatibel, arsip yang tersedia pada cutoff, outcome 5/10/20 dan split holdout |
| ARA | Belum tersedia | Belum dapat dievaluasi | Event belum dihitung; P&L dinonaktifkan | Batas ARA resmi per simbol/sesi bertimestamp, intraday sebelum/sesudah cutoff, coverage hingga akhir sesi |

Universe historis, delisting, perubahan papan, corporate action dan survivorship bias belum terverifikasi. Data live-observed, historical replay, fixture dan legacy dipisahkan. Tidak ada calibration ARA dengan sampel valid yang cukup, sehingga probabilitas tidak ditampilkan.

## Eksekusi engine dengan fixture

Perintah yang dijalankan:

```sh
node --import tsx scripts/strategy-backtest-fixtures.ts
```

Hasil aktual tersimpan di [`strategy-backtest-fixtures.json`](strategy-backtest-fixtures.json). Fixture menguji BPJS same-day time exit, BSJP next-trading-session/gap exit, no-entry, ambiguity, unfilled dan event ARA; evaluasi SWING menghasilkan jalur 5/10/20 sesi terpisah. Unit tests menambah kasus kehilangan data, lelang, ARA unavailable/already touched/one-sided book, cutoff, origin dan holdout.

Angka dalam file JSON adalah hasil perhitungan fixture deterministik. Sumber, ticker dan waktu fixture adalah input uji, bukan bukti observasi pasar atau profitabilitas. Report memberi label `deterministic_fixture_not_profitability_evidence` serta origin `fixture`; sampel ini tidak masuk calibration.

## Asumsi evaluasi

- Config `idx-backtest-v3`: fee beli 0,15%, fee jual 0,25%, slippage default 0,1% per sisi, minimum fee 0, lot 100. Pengaturan dapat diubah dan harus diberi configuration version baru.
- BPJS/BSJP: entry pada open candle setelah sinyal dalam jendela entry; volume participation membatasi fill. Queue position dan volume tepat pada open tidak diketahui, sehingga fill uncertainty dinyatakan. Stop/target satu candle menghasilkan ambiguous dan P&L dikeluarkan.
- Gap melewati stop menggunakan harga open yang tersedia, bukan harga stop yang tidak dapat dieksekusi. Harga time exit harus tersedia dalam jendela wajib; BPJS tidak dipindah ke hari berikutnya jika tidak ada harga exit.
- ARA: kejadian touch sesudah cutoff dipisahkan dari saham yang sudah touch. Waktu touch memakai batas akhir candle; tidak mengklaim presisi transaksi tick. Event ARA dan P&L trading disajikan terpisah, tanpa asumsi order terisi karena touch.
- SWING: 5/10/20 sesi dievaluasi dari entry secara terpisah. Outcome utama net-return 10 sesi tidak lagi mengambil hasil trade 20 sesi. Entry intrabar dengan extrema yang urutannya tidak diketahui ditandai ambiguous.
- MAE/MFE menggunakan bukti sesudah entry dan sebelum exit; extrema yang bisa terjadi sebelum entry/setelah exit tidak digunakan. Ini membatasi presisi excursion pada candle exit.
- Drawdown menggunakan pendekatan indeks return berurutan (`sequential_indexed_approximation`), bukan simulasi portofolio/modal serentak. Tidak ada klaim return portofolio dari posisi yang overlap.
- Report engine mensyaratkan development-end < holdout-start, identitas strategi/versi/execution/outcome sama, asal data sama dan cutoff dalam periode holdout. Tidak dilakukan optimasi threshold menggunakan seluruh periode.

## Langkah menuju backtest pasar

Terapkan migration pada lingkungan yang dipilih; kumpulkan forward snapshot dan arsip input/outcome bertimestamp melalui adapter/operator; verifikasi kalender, universe historis dan corporate action; deklarasikan periode development/holdout; jalankan engine per preset/version/origin. Mekanisme impor dan endpoint evaluasi dijelaskan di [`screening-implementation.md`](screening-implementation.md). Selama coverage tersebut belum ada, hasil tetap `insufficient_data`.
