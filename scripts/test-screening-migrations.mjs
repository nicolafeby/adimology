import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

// Always creates a disposable local cluster. No .env or production URL is read.
const directory = mkdtempSync(join(tmpdir(), 'adimology-migration-'));
const cluster = join(directory, 'data'), port = 55439;
function command(program, args, input) {
  const result = spawnSync(program, args, { input, encoding: 'utf8', maxBuffer: 8_000_000 });
  if (result.error || result.status !== 0) throw new Error(`${program} failed: ${result.error?.message ?? result.stderr}`);
  return result.stdout;
}
const sql = text => command('psql', ['-h', directory, '-p', String(port), '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-q'], text);
let started = false;
try {
  command('initdb', ['-D', cluster, '-A', 'trust', '--no-locale']);
  command('pg_ctl', ['-D', cluster, '-l', join(directory, 'postgres.log'), '-o', `-p ${port} -k ${directory} -h ''`, 'start']);
  started = true;
  sql('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;');
  const files = readdirSync('supabase').filter(x => x.endsWith('.sql')).sort((a,b) => parseInt(a)-parseInt(b) || a.localeCompare(b));
  for (const file of files) {
    if (file.startsWith('028_')) {
      sql(`INSERT INTO screening_runs(id,analysis_date,status,started_at) VALUES('00000000-0000-4000-8000-000000000001','2026-09-04','completed','2026-09-04T10:00:00+07:00');
      INSERT INTO signal_snapshots(signal_date,symbol,score,signal,model_version) VALUES('2026-09-04','OLDX',50,'watch','legacy-v1');`);
    }
    sql(readFileSync(join('supabase', file), 'utf8'));
  }
  // New additive migration is also safe to apply manually twice.
  sql(readFileSync('supabase/028_strategy_screening.sql','utf8'));
  const output = sql(readFileSync('tests/screening-migration-contract.sql','utf8'));
  console.log(output.trim());
  console.log(`PASS: ${files.length} migrations; legacy compatibility, scoped idempotency, immutable decisions, enrichment audit and recovery.`);
} catch (error) { console.error(error.message); process.exitCode = 1; }
finally {
  if (started) command('pg_ctl', ['-D', cluster, '-m', 'fast', 'stop']);
  rmSync(directory, { recursive: true, force: true });
}
