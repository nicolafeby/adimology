/** Inspect existing runs only; never starts screening, changes auth, or writes to the database. */
import { createClient } from '@supabase/supabase-js';
import { writeFile } from 'node:fs/promises';

async function main() {
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(15_000) }) },
  });
  const runs = [];
  for (const strategy of ['bpjs', 'bsjp', 'swing', 'ara']) {
    const { data: run, error } = await db.from('screening_runs').select('id,strategy_id,status,quantitative_status,started_at,completed_at,information_cutoff_at,market_session,summary,strategy_support').eq('strategy_id', strategy).order('started_at', { ascending: false }).limit(1).maybeSingle();
    if (error) throw new Error('Run audit query failed');
    if (!run) { runs.push({ strategy, run: null }); continue; }
    const { data: rows, error: rowError } = await db.from('screening_results').select('screening_status,quantitative_status,data_quality,failed_rules,strategy_support').eq('run_id', run.id).limit(1000);
    if (rowError) throw new Error('Result audit query failed');
    const categories: Record<string, number> = {}, rules: Record<string, number> = {}, missing: Record<string, number> = {}, failures: Record<string, number> = {};
    for (const row of rows ?? []) {
      categories[row.screening_status ?? 'pending'] = (categories[row.screening_status ?? 'pending'] ?? 0) + 1;
      for (const rule of row.failed_rules ?? []) {
        rules[rule.key] = (rules[rule.key] ?? 0) + 1;
        if (rule.key === 'required_data' && Array.isArray(rule.actualValue)) for (const reason of rule.actualValue) if (typeof reason === 'string') missing[reason] = (missing[reason] ?? 0) + 1;
        if (rule.key === 'processing_completed') {
          const value = String(rule.actualValue ?? '');
          const category = /Run timeout/i.test(value) ? 'run_deadline' : /timeout|timed out|abort/i.test(value) ? 'request_timeout' : /401/.test(value) ? 'provider_401' : /403/.test(value) ? 'provider_403' : /429/.test(value) ? 'provider_429' : /400/.test(value) ? 'provider_400' : /does not exist|schema cache/i.test(value) ? 'schema_missing' : /orderbook.*valid/i.test(value) ? 'invalid_orderbook' : /Cannot read properties|is not a function/i.test(value) ? value.replace(/https?:\/\/\S+|[A-Za-z0-9_-]{40,}/g, '[redacted]').slice(0, 150) : 'other_processing_error';
          failures[category] = (failures[category] ?? 0) + 1;
        }
      }
    }
    runs.push({ ...run, rows: rows?.length ?? 0, categories, quantitativeCompleted: rows?.filter(row => row.quantitative_status === 'completed').length ?? 0, validData: rows?.filter(row => row.data_quality?.valid === true).length ?? 0, failedRules: rules, missingRequirements: missing, failures });
  }
  const { count, error } = await db.from('source_snapshots').select('id', { head: true, count: 'exact' }).eq('data_type', 'strategy_screening_input').not('payload', 'is', null);
  if (error) throw new Error('Archive audit query failed');
  const report = { checkedAt: new Date().toISOString(), mode: 'read_only_existing_runs', databaseWrites: false, strategyInputArchives: count, runs };
  await writeFile('docs/screening-run-audit.json', JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
}
main().catch(() => { console.error('Run audit unavailable; no database diagnostics or credentials logged.'); process.exitCode = 1; });
