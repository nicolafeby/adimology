# OPSI B: Instalasi Lokal (PC + Supabase)

Ikuti langkah-langkah berikut secara berurutan:

## B1. Setup Supabase

> ⚠️ Langkah ini **sama dengan Opsi A**. Jika sudah setup Supabase, lanjut ke B2.

1. Buat akun dan project baru di [Supabase](https://supabase.com/)
2. Catat kredensial berikut dari **Project Settings > Data API**:
   - `Project URL` → untuk `NEXT_PUBLIC_SUPABASE_URL`
3. Catat kredensial berikut dari **Project Settings > API Keys > Legacy anon, service_role API keys**:
   - `anon public` key → untuk `NEXT_PUBLIC_SUPABASE_ANON_KEY`

> **PENTING: Persiapan Database (Wajib Sekali Saja)**
> Lakukan langkah yang sama seperti di **Opsi A (A1: Langkah 1-4)** dengan menjalankan `supabase/000_init.sql` di SQL Editor Supabase.
> 
> Setelah infrastruktur siap, Anda bisa menjalankan migrasi database lainnya secara otomatis dengan perintah:
> ```bash
> npm run migrate
> ```

## B2. Clone & Install

1. Clone repository:
   ```bash
   git clone https://github.com/username/adimology.git
   cd adimology
   ```

2. Install dependensi:
   ```bash
   npm install
   ```

3. Salin file environment:
   ```bash
   cp .env.local.example .env.local
   ```

4. Edit `.env.local` dan isi variabel berikut:
   ```env
   NEXT_PUBLIC_SUPABASE_URL=https://xxxxx.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
   GEMINI_API_KEY=AIzaSy...
   AUTH_SECRET=<minimal 32 karakter>
   TOKEN_SYNC_SECRET=<secret acak>
   TOKEN_ENCRYPTION_KEY=<base64 32-byte>
   ```

   | Variable | Nilai | Wajib |
   |----------|-------|:-----:|
   | `NEXT_PUBLIC_SUPABASE_URL` | URL dari Supabase | ✅ |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Anon key dari Supabase | ✅ |
   | `GEMINI_API_KEY` | API Key dari [Google AI Studio](https://aistudio.google.com/) | ✅ |
   | `STOCKBIT_JWT_TOKEN` | Token manual (opsional, ekstensi lebih baik) | ❌ |
   | `AUTH_SECRET` | Hasil `openssl rand -base64 48` | ✅ |
   | `TOKEN_SYNC_SECRET` | Hasil `openssl rand -base64 32` | ✅ |
   | `TOKEN_ENCRYPTION_KEY` | Hasil `openssl rand -base64 32` | ✅ |

## B3. Jalankan Aplikasi

```bash
npm run dev
```

Aplikasi akan berjalan di [http://localhost:3000](http://localhost:3000)

## B3.5. Background job lokal

AI Story dan retry screener dijalankan langsung oleh server Next.js. Tidak diperlukan Netlify CLI, akun Netlify, atau service tambahan di port `8888`.

## B4. Setup Chrome Extension (untuk Lokal)

1. Buka folder `stockbit-token-extension/` di repository
2. Salin file konfigurasi:
   ```bash
   cp stockbit-token-extension/manifest.json.example stockbit-token-extension/manifest.json
   cp stockbit-token-extension/background.js.example stockbit-token-extension/background.js
   ```

3. Edit `manifest.json` - konfigurasi untuk localhost:
   ```json
   "host_permissions": [
      "https://*.stockbit.com/*",
      "http://localhost:3000/*"
   ]
   ```

4. Edit `background.js` - set `APP_API_URL` ke localhost:
   ```javascript
   const APP_API_URL = "http://localhost:3000/api/update-token";
   const TOKEN_SYNC_SECRET = "nilai-yang-sama-dengan-env";
   ```

5. Install ekstensi di Chrome:
   - Buka `chrome://extensions/`
   - Aktifkan **Developer mode** (pojok kanan atas)
   - Klik **Load unpacked**
   - Pilih folder `stockbit-token-extension`

## B5. Verifikasi Instalasi

1. Pastikan aplikasi berjalan (`npm run dev`)
2. Buka [Stockbit](https://stockbit.com/) dan login
3. Ekstensi akan otomatis menangkap dan mengirim token ke Supabase
4. Buka [http://localhost:3000](http://localhost:3000)
5. Cek indikator koneksi Stockbit - harus menunjukkan **Connected**
6. Coba analisis saham pertama Anda! 🎉
