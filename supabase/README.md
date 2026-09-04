# Supabase Migrations

Direktori ini berisi database migration scripts untuk project Adimology. Migrasi dijalankan secara otomatis sebelum build process di Netlify.

## 🚀 Cara Kerja

Sistem migrasi otomatis akan:
1. ✅ Membaca semua file `.sql` dari folder ini
2. ✅ Mengurutkan berdasarkan prefix angka (001, 002, 003, dst)
3. ✅ Memeriksa migrasi yang sudah dijalankan di tabel `schema_migrations`
4. ✅ Menjalankan hanya migrasi baru secara sequential
5. ✅ Mencatat hasil eksekusi dengan timestamp dan checksum

## 📝 Naming Convention

Semua file migrasi harus mengikuti format:

```
{prefix}_{deskripsi}.sql
```

Contoh:
- `001_session_table.sql`
- `002_stock_queries_table.sql`
- `013_add_new_feature.sql`

**Penting:** Gunakan prefix angka 3 digit (001, 002, dst) untuk memastikan urutan eksekusi yang benar.

## 🆕 Menambahkan Migrasi Baru

1. Buat file baru dengan prefix angka berikutnya:
   ```bash
   # Migrasi terakhir adalah 012, maka buat 013
   supabase/013_nama_fitur_baru.sql
   ```

2. Tulis SQL statements di dalam file:
   ```sql
   -- Deskripsi singkat tentang migrasi
   
   CREATE TABLE IF NOT EXISTS nama_tabel (
     id SERIAL PRIMARY KEY,
     -- kolom lainnya
   );
   
   CREATE INDEX IF NOT EXISTS idx_nama ON nama_tabel(kolom);
   ```

3. Commit dan push ke repository:
   ```bash
   git add supabase/013_nama_fitur_baru.sql
   git commit -m "Add migration: nama_fitur_baru"
   git push
   ```

4. Deploy akan otomatis menjalankan migrasi baru

## 💻 Menjalankan Migrasi Lokal

Untuk testing atau development lokal:

```bash
# Pastikan environment variables sudah di-set
# (biasanya sudah ada di .env.local)

npm run migrate
```

**Environment Variables Required:**
- `SUPABASE_URL` - URL project Supabase
- `SUPABASE_SERVICE_ROLE_KEY` - Service role key (bukan anon key)

## 🔍 Memeriksa Status Migrasi

Untuk melihat migrasi yang sudah dijalankan, query ke database Supabase:

```sql
SELECT 
  migration_name, 
  executed_at, 
  execution_time_ms 
FROM schema_migrations 
ORDER BY migration_name;
```

Atau via Supabase Dashboard:
1. Buka project di dashboard.supabase.com
2. Pilih "SQL Editor"
3. Jalankan query di atas

## ⚠️ Best Practices

### DO ✅
- Gunakan `IF NOT EXISTS` untuk CREATE TABLE/INDEX
- Tulis migrasi yang idempotent (aman dijalankan berkali-kali)
- Test migrasi di local environment terlebih dahulu
- Buat backup database sebelum migrasi besar

### DON'T ❌
- Jangan edit file migrasi yang sudah dijalankan
- Jangan hapus file migrasi lama
- Jangan skip nomor prefix (gunakan sequential: 001, 002, 003)
- Jangan hard-code data produksi dalam migrasi

## 🐛 Troubleshooting

### Migration Gagal di Netlify

1. Cek build logs di Netlify Dashboard
2. Identifikasi error message dari migration script
3. Fix error di file SQL yang bermasalah
4. Push fix dan trigger rebuild

### Migration Tidak Jalan

Pastikan:
- ✅ Environment variables sudah set di Netlify
- ✅ File SQL ada di folder `supabase/`
- ✅ Naming convention benar (prefix angka)
- ✅ SQL syntax valid

### Migration Sudah Jalan Tapi Ingin Re-run

**Tidak disarankan**, tapi jika diperlukan:

1. Hapus record dari tabel `schema_migrations`:
   ```sql
   DELETE FROM schema_migrations 
   WHERE migration_name = '013_nama_file.sql';
   ```

2. Jalankan migration lagi:
   ```bash
   npm run migrate
   ```

## 📊 Schema Migrations Table

## Retensi funnel Screener

Migration 025 menyimpan satu current-state row per `(run_id, symbol)` dan event transisi ringkas. Event tidak dihapus otomatis. Operator boleh menerapkan retensi minimal 90 hari setelah kebutuhan audit dikonfirmasi; snapshot run/item dan tabel ranking/signal historis tidak ikut dihapus. Menghapus sebuah run akan menghapus item/event-nya melalui foreign key cascade, tetapi tidak menghapus snapshot ranking atau outcome legacy.

Run `running` yang lebih tua dari 120 menit dapat direkonsiliasi secara eksplisit dengan `select mark_stale_screening_runs(120);`. Scheduled maintenance harus memanggil fungsi itu; migration tidak menjalankan job tersembunyi.

Tabel tracking otomatis dibuat dengan struktur:

```sql
CREATE TABLE schema_migrations (
  id SERIAL PRIMARY KEY,
  migration_name TEXT UNIQUE NOT NULL,
  executed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  checksum TEXT,
  execution_time_ms INTEGER
);
```

## 🔗 Related Files

- **Migration Script:** [`scripts/run-migrations.js`](../scripts/run-migrations.js)
- **Netlify Config:** [`netlify.toml`](../netlify.toml)
- **Package Scripts:** [`package.json`](../package.json)
