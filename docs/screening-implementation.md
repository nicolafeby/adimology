# Implementasi Screening empat preset

Status implementasi, pemeriksaan, dan bukti data pada 7 September 2026. Seluruh perubahan berada di workspace; tidak dilakukan deployment atau migration ke database produksi.

## Perilaku akhir

| Preset | Screening/entry WIB | Exit | Sumber kuantitatif | Dukungan adapter yang tersedia |
| --- | --- | --- | --- | --- |
| BPJS | 09:15–10:30 | Jendela 15:30–15:45, sesi yang sama | Candle intraday selesai, VWAP, momentum pembukaan, volume pada jam setara, orderbook bertimestamp | `unavailable` tanpa input arsip; evaluator menerima arsip valid |
| BSJP | 15:00–15:30 | 09:00–09:30 sesi bursa berikutnya | Momentum sore, posisi dalam rentang sesi sampai cutoff, VWAP, volume jam setara, likuiditas | `unavailable` tanpa input arsip dan kalender lengkap |
| SWING | Baseline daily selesai; jendela profil 09:00–16:15 | Outcome 5/10/20 sesi dari entry; definisi utama 10 sesi | Momentum, relative strength, broker persistence, kualitas eksekusi | `partial`: daily tersedia, timestamp orderbook dan provenance belum lengkap |
| ARA | 09:15–15:30 dalam continuous trading | Event diamati setelah cutoff sampai 16:15, termasuk arsip lelang yang sah | Batas ARA resmi per simbol/sesi, momentum intraday, jarak ARA, volume jam setara, likuiditas | `unavailable` tanpa batas resmi bertimestamp dan intraday |

ARA menampilkan kandidat, sudah menyentuh ARA, dan terkunci di ARA secara terpisah. Kandidat dapat memperoleh ranking heuristik; Decision Card tetap monitoring karena execution model ARA adalah event-only. Tidak ada probabilitas ARA atau P&L yang diasumsikan dari touch/antrean.

Status `ready` pada run berarti data wajib input run terpenuhi, bukan strategi telah tervalidasi atau setiap order pasti terisi. UI memakai dukungan aktual run bila tersedia, lalu fallback ke kemampuan adapter. Risiko pribadi tidak mengganti preset strategi.

## Audit dan perbaikan

| Temuan kode awal | Perubahan / batas yang dipertahankan |
| --- | --- |
| Profil aktif tunggal `swing_5_20d`; preset risiko bukan strategi | Registry bertipe `bpjs`, `bsjp`, `swing`, `ara`; identitas diteruskan dari UI ke run, hasil, snapshot, outcome dan calibration. Alias profil faktor lama tetap terbaca. |
| Fallback ARA pada `analyzeSymbol` memakai offer tertinggi/high harian dan menolak nilai sama dengan harga | Screening hanya membaca field batas provider; nilai yang hilang menjadi `null`. Penilaian resmi ARA memerlukan kontrak `OfficialAraLimit`, bukan field numerik saja. |
| `ai_news` berbobot nol pada konfigurasi, tetapi komponen catalyst berbobot 10 pada analysis; confidence dipengaruhi confidence/freshness AI | Catalyst tetap informasi, berbobot nol dan dikeluarkan dari coverage, agreement, konflik, reliability, confidence, eligibility dan ranking. Umur AI tidak mengurangi confidence Decision Card. Model menjadi `multifactor-swing-v8`, quality `quality-v2`. |
| Daily final dapat masuk pre-screen sebelum penutupan | Daily disaring sampai candle selesai sebelum cutoff, termasuk benchmark. Broker history dibatasi tanggal, periode satu sesi dan waktu persistensi. |
| `analyzeSymbol` menggeser cutoff eksplisit ke waktu fetch; run menggeser cutoff ke akhir AI | Cutoff eksplisit dipertahankan. Cutoff live tanpa waktu eksplisit diselesaikan pada acquisition, sebelum persistensi kuantitatif dan enrichment; setiap simbol menyimpan cutoff sendiri, run menyimpan maksimum acquisition. |
| Timestamp receipt dianggap timestamp observasi orderbook | Receipt/availability direkam sebagai waktu pengambilan nyata. Observasi provider yang tidak tersedia tetap tidak diketahui. Tidak ada fallback freshness ke waktu sekarang. |
| Histori detail dapat fallback ke simbol/tanggal atau AI terbaru dari run lain | Semua pembacaan baru memakai strategy + run; detail salah preset mengembalikan 404. Enrichment historis tidak mengambil AI live. |
| Idempotensi global hanya run running; race SELECT/INSERT | Key mencakup strategi, versi, konfigurasi, mode, tanggal, cutoff dan opsi. RPC memakai advisory lock dan juga mengembalikan run terminal pada retry key yang sama. |
| Source archive metadata saja, payload kosong | Snapshot sumber yang baru merekam payload kuantitatif/hash. Input forward dan outcome dapat diarsipkan terpisah tanpa mengubah prediksi. |
| Run dapat tertinggal running setelah proses terputus | Deadline tahap, timeout provider, retry terbatas, status partial/error per simbol, dan recovery run stale. |
| Outcome berlabel `net_return_10d_positive` berasal dari evaluasi 20 sesi | Outcome utama sekarang 10 sesi; hasil 5/10/20 disimpan terpisah di `horizon_outcomes`. Config `idx-backtest-v3` mengisolasi hasil lama. |
| Migration mengubah tabel ranking/outcome yang belum pernah dibuat dalam repositori | `018_base_ranking_schema.sql` menambahkan bootstrap `CREATE TABLE IF NOT EXISTS`; runner mengurutkan prefix lalu nama. Seluruh migration diuji pada PostgreSQL sementara. |
| Halaman terbuka tetapi POST screening ditolak `Sesi tidak valid` | Guard membaca cookie terenkode sebagai token mentah; pembacaan cookie kini konsisten dengan proxy, dan 401 membuka pemulihan login. Cookie malformed/expired tetap ditolak. Pemeriksaan status password gagal tidak membuka aplikasi. |

Tidak ditemukan AGENTS.md yang berlaku sebelum audit. Next.js kemudian menghasilkan AGENTS.md/CLAUDE.md ketika dev server dijalankan; panduan route handler dan Playwright lokal yang dirujuk telah dibaca. Workspace awal bersih berdasarkan `git status --short`.

## Registry, faktor, threshold, dan kalender

Registry utama: [`lib/strategies.ts`](../lib/strategies.ts). Identitas yang dipersistenkan: `strategy_id`, `strategy_version`, `configuration_version`, `execution_model`, `outcome_definition`. Model analisis/ranking/data-policy/backtest mempunyai versi tersendiri. Nilai registry adalah sumber yang dipakai engine dan UI.

| Strategi | Versi | Configuration | Execution | Outcome |
| --- | --- | --- | --- | --- |
| BPJS | `bpjs-v1` | `bpjs-baseline-v1` | `intraday_next_bar_open_v1` | `bpjs_same_session_net_return_positive` |
| BSJP | `bsjp-v1` | `bsjp-baseline-v1` | `overnight_next_bar_open_v1` | `bsjp_next_session_morning_net_return_positive` |
| SWING | `swing-5-20d-v1` | `eligibility-execution-v2` | `entry_zone_conservative` | `net_return_10d_positive` |
| ARA | `ara-v1` | `ara-baseline-v1` | `ara_event_only_no_assumed_fill_v1` | `official_ara_touched_after_cutoff` |

Baseline intraday: minimal lima sesi pembanding volume pada **jam yang sama**, RVOL ≥1,2×, momentum >0, harga ≥VWAP, nilai transaksi kumulatif ≥Rp1 miliar, spread ≤1%, candle terakhir ≤300 detik dan orderbook ≤60 detik. Skor heuristik menggunakan momentum, RVOL, spread serta posisi rentang sesi atau jarak ARA. Seluruh aturan menyimpan actual, threshold, status dan penjelasan. Opening range tersedia sebagai metrik; satu snapshot orderbook tidak menjadi bukti arah.

BPJS/BSJP menggunakan baseline stop 1,5%, target 3%, fraksi harga, maksimum risiko modal 1%, participation 1% dan lot 100. Sizing membutuhkan modal/kas/risk yang diisi; tidak dibuat jika belum ada input. BSJP mengakui risiko gap dan agenda selama menginap. ARA tidak membentuk rencana entry/stop/target P&L.

Threshold SWING pre-screen dipertahankan: riwayat ≥20 sesi, nilai transaksi rata-rata ≥Rp1 miliar, harga ≥MA20, return 5 sesi >0, relative volume ≥1,2×, ATR ≤8%. Eligibility eksekusi dan bobot ranking existing tidak dioptimalkan terhadap fixture atau keseluruhan periode. Perbaikan pengaruh AI mengubah hasil model dan diberi versi baru, sehingga bukan klaim identik numerik dengan v7.

Kalender menggunakan `Asia/Jakarta`. Jam pasar reguler diperiksa terhadap [BEI — Trading Hours and Mechanism](https://www.idx.id/en/products-services/trading-hours-and-mechanism/). Mekanisme memisahkan pre-open, opening auction, continuous pagi, istirahat, continuous sore, closing auction, post-close, closed dan unknown. Kalender memerlukan record terverifikasi dengan sumber dan availability untuk setiap hari; Jumat berbeda, akhir pekan/libur tidak ditebak sebagai sesi berikutnya. Papan dengan mekanisme lelang khusus memerlukan calendar/windows dan provenance sendiri; tidak otomatis dianggap continuous. Tidak dihitung batas ARA dari persentase aturan bursa yang belum diverifikasi per papan/tanggal/referensi/fraksi.

## Berita dan AI

`lib/news.ts` memisahkan verifikasi, freshness, impact direction, risiko dan temporal validity. Empat label bisa muncul bersama:

- **Katalis terverifikasi:** konfirmasi peristiwa dari pengumuman primer dengan sumber yang dapat ditelusuri. Bukan jaminan dampak harga.
- **Rumor:** klaim spesifik tanpa konfirmasi primer; tidak berlaku otomatis untuk semua media dan tidak menyatakan informasi palsu.
- **Berita lama:** umur publikasi substansi asli, termasuk duplicate group; publikasi ulang tidak mereset umur. Policy 24 jam untuk intraday dan 120 jam untuk SWING.
- **Risiko peristiwa:** kategori, severity, alasan, waktu dan sumber peristiwa yang overlap horizon. Berita lama masih dapat berisiko untuk agenda mendatang. UMA berbeda dari pelanggaran/suspensi.

Status sumber membedakan tidak ada berita relevan, sumber tidak tersedia, fetch gagal, waktu tidak terverifikasi, dan pending. Input menyimpan ID, simbol, judul/publisher/URL, source type, published/original published/first seen/fetched/available/event time, confirmation, duplicate/event group, alasan, temporal validity, classification version dan AI version.

Berita yang baru tersedia setelah cutoff berada di `monitoring_updates`. Enrichment disimpan append-only terpisah dari snapshot prediksi. Sumber berprovenance dapat dibawa di `StrategyScreeningData.news`. AI Story lama hanya menghasilkan citation unverified; AI tidak dapat memberikan konfirmasi primer atau admission gate. Link disaring menjadi HTTP(S) tanpa credentials, teks dirender oleh React sebagai teks. Kegagalan AI tidak membatalkan hasil kuantitatif; retry enrichment memakai run/simbol/strategi yang benar.

## Data aktual dan batas integrasi

Bukti baca-saja: [`screening-data-audit.json`](screening-data-audit.json), diambil 2026-09-07T14:46:17.198Z. Probe ini tidak menulis token/session, membuat run, memanggil AI atau menjalankan migration. Audit lanjutan hasil kosong dan gangguan login pada 8 September ada di [`screening-empty-results-audit.md`](screening-empty-results-audit.md).

| Data | Bukti aktual | Batas |
| --- | --- | --- |
| OHLCV harian | Stockbit BBCA HTTP 200, 19 candle 10 Agustus–7 September 2026 | Candle hari berjalan wajib disaring; bukan intraday dan bukan universe backtest |
| Orderbook | HTTP 200, 37 bid dan 56 offer | Timestamp observasi tidak tersedia pada field yang didukung adapter; tidak dinyatakan fresh |
| ARA | Field ARA ada | Sumber/timestamp/session/board/rules provenance belum terverifikasi untuk kontrak resmi |
| Intraday, VWAP dan RVOL jam setara | Kontrak arsip/evaluator tersedia | Belum ada adapter provider yang menyediakan arsip input tersebut |
| Transaksi tick dan perubahan orderbook | Tidak ada adapter/arsip yang terverifikasi | Tidak ada klaim queue position, fill pasti atau arah dari satu book |
| Broker | Endpoint market detector dan cache query ada di kode | Bukan arsip net-flow per sesi lengkap; publication/period/freshness membatasi pemakaian |
| Fundamental | Endpoint key stats ada | Waktu publikasi asli tidak lengkap; input tanpa bukti tidak masuk snapshot valid |
| Berita | AI citations dan classifier tersedia | Feed primer terstruktur otomatis belum terpasang; metadata tidak dikarang |
| Snapshot/database | 1.006 snapshot existing, 966 anggota universe terkini; kolom strategi dapat dibaca | Nol snapshot kompatibel memenuhi identitas baru, point-in-time dan backtest eligibility per preset |
| Arsip sumber | Nol payload non-null pada audit | Replay pasar dan validasi holdout belum dapat dijalankan |
| Universe historis | Tidak tersedia terverifikasi | Delisting, perubahan papan, corporate action dan survivorship bias harus diselesaikan sebelum validasi pasar |

`historical_replay` pada endpoint screening berhenti dengan status kekurangan arsip sebelum endpoint live dipanggil. Engine fixture/replay menerima arsip eksplisit. Outcome SWING historical replay juga hanya memakai daily archive; outcome live-observed boleh memakai harga setelah keputusan dengan label asalnya. Mode dan origin tidak dicampur pada calibration. Penambahan adapter/provider otomatis dan pengumpulan periode historis valid masih diperlukan untuk kesiapan live preset intraday.

## File dan migration

Perubahan utama: `app/rankings/page.tsx`, `app/rankings/screening.css`, `DecisionCard.tsx`, `ScreeningNews.tsx`; API screener/rankings/backtest; registry/calendar/screening/backtest/news; service, persistence, point-in-time, analysis quality dan provider transport; background jobs lokal/Netlify; tests dan scripts pemeriksaan.

Migration baru:

- [`018_base_ranking_schema.sql`](../supabase/018_base_ranking_schema.sql): bootstrap additive tabel ranking, signal/outcome, universe dan alert yang sebelumnya berasal dari luar rantai migration.
- [`028_strategy_screening.sql`](../supabase/028_strategy_screening.sql): identitas nullable untuk legacy, index strategi, RPC idempotensi/recovery, consistency parent run, rank hanya untuk passed, immutable prediction, enrichment audit dan outcome archive append-only, role grants.

Tidak ada blanket backfill SWING. Record tanpa bukti tetap `legacy_unverified`/strategy NULL dan tidak menjadi sampel calibration. Compatibility `stock_rankings` lama tetap tersedia bagi pembaca lama; tab Screening baru memakai hasil run sebagai sumber otoritatif.

## Pengujian

Lihat [`screening-validation.md`](screening-validation.md) untuk hasil perintah akhir dan batas bukti. Tests menggunakan fixture deterministik dan mock HTTP database/provider. Playwright menjalankan komponen Next.js nyata dengan API mock di Chrome, memeriksa desktop/mobile, keyboard, race, polling, filter/detail/retry dan runtime/console. Smoke provider asli dilakukan terpisah melalui script audit baca-saja; bukan E2E produksi dengan migration baru.

## Menjalankan

```sh
npm test
npm run typecheck
npm run build
npm run test:migrations
node --import tsx scripts/strategy-backtest-fixtures.ts
npm run dev -- --hostname 127.0.0.1 --port 3100
SCREENING_BROWSER_CHANNEL=chrome npm run test:screening-ui
SCREENING_BROWSER_CHANNEL=chrome npm run test:screening-auth
```

Smoke browser default ke port 3100; untuk server yang sudah berjalan pada port 3000, set `SCREENING_SMOKE_URL=http://127.0.0.1:3000`. Build memakai opsi resmi Webpack; alasan dan hasil verifikasi ada pada laporan pengujian.

`test:migrations` membutuhkan `initdb`, `pg_ctl`, `psql` di PATH. Script selalu membuat cluster sementara dengan socket lokal, menerapkan 30 migration, menyisipkan legacy sebelum 028, mengulang 028, menguji kontrak, lalu membersihkan hanya cluster uji. Tidak membaca `.env.local`.

Untuk instalasi yang hendak diperbarui, arahkan konfigurasi migration ke database lokal/test yang dipilih, lalu `npm run migrate`. Runner membutuhkan `exec_migration_sql` dan `schema_migrations` sesuai `supabase/README.md`. Jika 018–027 sudah terpasang, bootstrap baru tetap aman melalui `CREATE TABLE IF NOT EXISTS`. Migration produksi tidak dijalankan sebagai pengujian tugas ini.

Buka `/rankings?strategyId=bpjs` (atau bsjp/swing/ara), login dengan autentikasi existing, lalu jalankan preset. Run/history dan URL memulihkan pilihan. API POST `/api/screener/run` menerima `{ "strategyId": "bpjs" }`; default kompatibilitas adalah SWING. Gunakan header `idempotency-key` untuk retry request yang sama; gunakan key baru untuk acquisition baru. API memerlukan session valid atau secret cron yang dikonfigurasi; mutasi browser diperiksa origin-nya.

API history: `GET /api/screener/runs?strategyId=...`; latest: `GET /api/screener/runs/latest?strategyId=...`; hasil `GET /api/rankings?strategyId=...&runId=...`; detail melalui `/api/screener/runs/{runId}/symbols/{symbol}?strategyId=...`. Seluruh query run eksplisit diverifikasi terhadap strategi.

Evaluasi: `POST /api/backtest/evaluate` dengan `{ "strategyId": "bpjs" }`; ringkasan `GET /api/backtest?strategyId=bpjs&executionMode=live`. Beri `historical_replay` hanya untuk pool arsip yang benar. Biaya dapat diatur lewat `BACKTEST_BUY_FEE_PERCENT`, `BACKTEST_SELL_FEE_PERCENT`, `BACKTEST_MINIMUM_FEE`, `BACKTEST_FIXED_SLIPPAGE_PERCENT`, `BACKTEST_LOT_SIZE`, `BACKTEST_CONFIG_VERSION`; perubahan asumsi wajib mempunyai versi baru.

## Forward archive dan impor operator

`scripts/import-screening-archive.ts` adalah perintah operator eksplisit, tidak dipanggil otomatis dan tidak dijalankan terhadap database produksi selama tugas ini:

```sh
node --env-file=.env.local --import tsx scripts/import-screening-archive.ts /path/to/archive.json
```

Envelope file memuat `kind` (`screening_input` atau `outcome`), `strategyId`, `symbol`, `runId` parent yang cocok, `sourceUrl`, dan `payload`. Untuk input, payload mengikuti `StrategyScreeningData` di `lib/strategy-screening.ts`; optional `news` mengikuti `NewsInput`. Bukti asal data harus menyertakan `origin` (`live_observed`, `historical_archive`, `fixture`, atau `legacy_unverified`), provenance universe dan corporate actions untuk kelayakan backtest. Contoh struktural fixture berada di `tests/strategy-fixtures.ts`; tidak boleh dilabeli sebagai data pasar.

Impor input mencatat waktu receipt/availability sebenarnya dan hash payload, lalu run screening berikutnya dapat membaca sumber yang sudah tersedia sebelum cutoff. Impor tidak dapat memasukkan file yang baru diterima ke keputusan lama. Kalender, candle dan orderbook tetap menggunakan timestamp provider yang disediakan, tanpa dibuatkan timestamp observasi baru.

Impor outcome juga membutuhkan `snapshotId`; payload mengikuti `StrategyOutcomeArchive` (origin, sumber, candle, kalender, asOf, coverage, missing intervals, universe/corporate actions, optional dailyCandles untuk SWING). Outcome archive terhubung ke snapshot yang cocok dan append-only. Engine menolak origin berbeda, fixture untuk calibration, gap cakupan, waktu tidak sah, dan data yang belum tersedia untuk evaluasi. Setelah arsip disimpan, panggil evaluasi backtest preset. Arsip parsial dapat ditambahkan sebagai record baru, tanpa mengubah prediksi.

Audit data baca-saja dapat diulang dengan `npm run audit:screening-data`; hasilnya tersimpan di `docs/screening-data-audit.json`. Jangan menyimpulkan profitabilitas dari output fixture, skor heuristik atau keberhasilan build.
