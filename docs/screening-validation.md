# Bukti pengujian Screening

Pemeriksaan aktual pada 7–8 September 2026. Keberhasilan implementasi dipisahkan dari kesiapan provider, penerapan database dan validasi pasar.

| Pemeriksaan | Hasil | Lingkup bukti |
| --- | --- | --- |
| `npm test` | 159/159 lulus | Engine, berita, point-in-time, outcome, calibration, API, auth dan diagnosis data kosong; fixture deterministik serta mock provider/database |
| `npm run typecheck` | Lulus | TypeScript seluruh proyek dan scripts |
| `npm run build` | Lulus; 37 halaman statis dihasilkan | Production build Next.js 16.3.4 dengan Webpack |
| `npm run test:migrations` | 30 migration lulus | PostgreSQL sementara: instalasi baru, legacy sebelum 028, pengulangan 028, idempotensi, immutable decision, enrichment dan recovery |
| `node --import tsx scripts/strategy-backtest-fixtures.ts` | Lulus | BPJS/BSJP/ARA dan SWING 5/10/20; hasil berlabel fixture, tidak masuk calibration |
| `npm run test:screening-ui` | 11 skenario lulus | Komponen Next.js nyata + API mock, Chrome desktop/mobile, tanpa browser runtime/console error tak terduga |
| `npm run test:screening-auth` | 8 skenario lulus | Tiga pemeriksaan API lokal asli tanpa mutasi database + lima skenario UI dengan API auth mock, termasuk request yang menggantung |
| Audit provider/database | Akses daily/orderbook terverifikasi; arsip belum mencukupi | Baca-saja, terpisah dari mock UI; lihat [audit data](screening-data-audit.json) |

`build` memakai opsi resmi `next build --webpack`. Build Turbopack gagal pada lingkungan pengujian ini saat worker mencoba membuka port (`EPERM`); keberhasilan build di atas adalah Webpack. Dev server menggunakan Turbopack. Tidak ada perubahan versi dependency untuk mengatasi masalah tersebut.

## Regresi sesi yang dilaporkan

Screenshot pengguna memperlihatkan POST `/api/screener/run` ditolak 401 ketika halaman sudah terbuka. Cookie sesi yang diterbitkan `NextResponse` mengandung encoding persen, termasuk padding `%3D`. Pemeriksaan proxy sebelumnya membaca cookie yang telah di-decode, sedangkan guard API baru membaca header mentah. Akibatnya sesi yang sama lolos proxy tetapi gagal verifikasi tanda tangan di handler.

`sessionTokenFromRequest` sekarang menjadi pembaca cookie bersama untuk proxy, guard, pemeriksaan password dan `getSession`. Nilai cookie di-decode sekali tanpa memotong padding `=`. Verifikasi tetap memeriksa tanda tangan, algoritma, status authenticated dan expiry yang sah; cookie malformed/tampered/expired tetap ditolak.

PasswordGate memeriksa status HTTP dan bentuk respons. Respons gagal atau malformed tidak membuka aplikasi. Ketika Screening menerima 401, gate memeriksa sesi kembali, memperbarui guest session bila password dinonaktifkan, atau menampilkan form login. Login berhasil memulihkan preset/run dari URL; POST yang gagal tidak diputar ulang otomatis.

Bukti [auth smoke](screening-auth-smoke.json): cookie verified dan guest yang benar-benar diserialisasi Next.js mencapai validasi input (400 untuk strategy fixture yang sengaja invalid), sedangkan request tanpa sesi tetap 401. Ini menjalankan route/proxy lokal asli dan tidak membuat screening run. Skenario browser terpisah membuktikan login ulang mempertahankan BPJS serta kegagalan status HTTP/payload dapat dipulihkan melalui retry.

Dev server lokal dimulai ulang setelah HMR menyimpan referensi `next/headers` lama. Enam skenario auth lulus setelah pemuatan modul terbaru.

## UI dan API

Bukti mesin: [UI smoke](screening-ui-smoke.json), [auth smoke](screening-auth-smoke.json). Tangkapan layar [desktop](screenshots/screening-desktop.png) dan [detail mobile](screenshots/screening-mobile-detail.png) menggunakan fixture yang jelas terpisah dari data pasar.

Sebelas skenario UI mencakup empat preset dan payload strategi; pergantian cepat dengan respons tertunda; filter multi-label berita/status dan audit; isolasi detail per run serta retry AI tanpa mengubah kuantitatif; riwayat dan refresh; resume serta polling sampai terminal; error aman/retry; pemisahan kandidat/monitoring ARA; alasan nol Passed dan penghitung data wajib; layout desktop/mobile dan keyboard modal; penghentian polling pada unmount dan pemeriksaan error browser.

Unit/API tests meliputi cookie asli hasil `Set-Cookie`, autentikasi gagal, ID/input invalid sebelum akses data, propagasi empat preset sampai snapshot/outcome, isolasi latest/history/idempotensi, provider gagal/rate limit/timeout, partial success dan AI gagal. SQL contracts memeriksa aturan database dengan PostgreSQL asli, bukan hanya mencocokkan teks migration.

## Batas pengujian

- Tidak ada deployment, migration produksi, screening run produksi atau penulisan outcome pasar sebagai bagian dari pengujian.
- Audit ulang 7 September 14:46 UTC membuktikan kolom strategi dapat dibaca, menggantikan temuan `42703` pada audit awal. Audit 8 September menemukan layanan backend Supabase tidak merespons; detail bukti dan batas pemulihan ada di [audit hasil kosong/login](screening-empty-results-audit.md). Mock UI yang lulus tidak membuktikan layanan remote sehat.
- Provider asli hanya diperiksa melalui audit baca-saja. Feed intraday, kalender historis, timestamp orderbook, provenance ARA resmi dan berita primer terstruktur belum terverifikasi lengkap.
- Keempat backtest pasar berstatus `insufficient_data`. Hasil engine dengan fixture membuktikan perilaku perhitungan; tidak membuktikan profitabilitas atau kesiapan live.
- Kebijakan autentikasi existing menerima signed guest session bila diterbitkan saat password dinonaktifkan. Mengaktifkan password tidak menyediakan pencabutan global token browser lain yang sudah diterbitkan; desain revocation belum ditambahkan pada perbaikan parsing cookie ini.

## Mengulang pemeriksaan browser

```sh
npm run dev -- --hostname 127.0.0.1 --port 3000
SCREENING_SMOKE_URL=http://127.0.0.1:3000 SCREENING_BROWSER_CHANNEL=chrome npm run test:screening-ui
SCREENING_SMOKE_URL=http://127.0.0.1:3000 SCREENING_BROWSER_CHANNEL=chrome npm run test:screening-auth
```

Chrome harus tersedia. Auth smoke membaca `.env.local` agar tanda tangan cookie uji cocok dengan server lokal; script membatasi target ke localhost, tidak mencetak cookie dan tidak mengirim strategi valid ke endpoint mutasi. Pengujian login/password menggunakan mock terpisah. Jangan mengarahkannya ke deployment produksi.
