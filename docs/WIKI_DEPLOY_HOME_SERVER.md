# Deploy ke Home Server dengan GitHub Actions

Deployment ini menggunakan GitHub Actions self-hosted runner dan PM2. Setiap push ke `main` akan menjalankan test, typecheck, build standalone, membuat release baru, lalu me-reload aplikasi.

## 1. Persiapan server

Pasang Node.js 22 dan PM2, lalu buat direktori yang dimiliki user runner:

```bash
sudo mkdir -p /srv/adimology/releases
sudo chown -R github-runner:github-runner /srv/adimology
sudo npm install -g pm2
```

Ganti `github-runner` dengan user yang menjalankan Actions Runner. Daftarkan runner dari **Repository Settings → Actions → Runners → New self-hosted runner**, lalu tambahkan label `adimology`. Runner harus memiliki label `self-hosted`, `linux`, `x64`, dan `adimology`.

Agar aplikasi kembali hidup setelah reboot, jalankan sebagai user runner:

```bash
pm2 startup
pm2 save
```

Ikuti perintah `sudo` yang dicetak oleh `pm2 startup`.

## 2. GitHub Environment

Buat Environment bernama `production` melalui **Settings → Environments**.

Tambahkan Environment secrets berikut:

| Secret | Wajib | Keterangan |
|---|:---:|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Ya | URL project Supabase |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Ya | Anon/public key Supabase; nilainya ikut masuk ke bundle browser |
| `SUPABASE_SERVICE_ROLE_KEY` | Ya | Service-role key, hanya digunakan di server |
| `GEMINI_API_KEY` | Ya | API key Gemini |
| `AUTH_SECRET` | Ya | String acak panjang untuk menandatangani sesi |
| `CRON_SECRET` | Disarankan | Token pengaman endpoint cron |
| `STOCKBIT_JWT_TOKEN` | Tidak | Token awal; aplikasi juga dapat menyimpannya di Supabase |

Buat `AUTH_SECRET` dengan `openssl rand -base64 48`. Jangan menaruh nilainya di repository.

Tambahkan Environment variable (bukan secret):

| Variable | Nilai contoh |
|---|---|
| `DEPLOY_PATH` | `/srv/adimology` |
| `APP_PORT` | `3100` |
| `GEMINI_STORY_MODELS` | Opsional |
| `SCREENER_UNIVERSE_LIMIT` | Opsional, misalnya `1000` |
| `SCREENER_DEEP_LIMIT` | Opsional, misalnya `50` |
| `SCREENER_AI_LIMIT` | Opsional, misalnya `10` |

`NEXT_PUBLIC_*` tetap disimpan sebagai secret sesuai permintaan, tetapi secara desain Next.js nilai tersebut tertanam di JavaScript browser dan bukan rahasia. Gunakan anon key, jangan service-role key.

## 3. Deploy

Push ke branch `main`, atau buka **Actions → Deploy to Home Server → Run workflow**. Status aplikasi dapat dicek di server:

```bash
pm2 status adimology
pm2 logs adimology
```

Aplikasi tersedia pada port `APP_PORT` (default `3100`). Port ini dipilih karena tidak bentrok dengan port container yang sudah berjalan di home server. Workflow juga menguji ketersediaannya saat deployment pertama. Gunakan reverse proxy seperti Caddy atau Nginx untuk HTTPS dan akses melalui domain. AI Story dan retry screener dijalankan sebagai background task oleh server Next.js yang sama, sehingga tidak memerlukan Netlify Dashboard atau service tambahan di port `8888`.
