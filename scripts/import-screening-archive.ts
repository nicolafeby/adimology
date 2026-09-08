/** Explicit operator command for collecting forward inputs; never runs automatically. */
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { isStrategyId, strategyIdentity } from '../lib/strategies';
import { evaluateStrategyScreening, type StrategyScreeningData } from '../lib/strategy-screening';
import { safeNewsUrl } from '../lib/news';

async function main() {
  const filename = process.argv[2];
  if (!filename) throw new Error('Usage: node --env-file=.env.local --import tsx scripts/import-screening-archive.ts archive.json');
  const document = JSON.parse(await readFile(filename,'utf8'));
  if (!document || !isStrategyId(document.strategyId) || !/^[A-Z0-9]{4,12}$/.test(document.symbol) || !/^[0-9a-f-]{36}$/i.test(document.runId) || !safeNewsUrl(document.sourceUrl) || !['screening_input','outcome'].includes(document.kind)) throw new Error('Archive identity, kind, sourceUrl, runId or symbol invalid.');
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth:{persistSession:false,autoRefreshToken:false}, global:{fetch:(input,init)=>fetch(input,{...init,signal:AbortSignal.timeout(15000)})} });
  const identity = strategyIdentity(document.strategyId);
  const run = await db.from('screening_runs').select('*').eq('id',document.runId).eq('strategy_id',document.strategyId).single();
  if (run.error || !run.data || Object.entries(identity).some(([k,v])=>run.data[k]!==v)) throw new Error('Parent run missing or strategy version incompatible. Apply migration and create the correct preset run first.');
  const receivedAt = new Date().toISOString();
  if (document.kind==='screening_input') {
    const payload = document.payload as StrategyScreeningData;
    if (!payload || payload.symbol!==document.symbol || !Array.isArray(payload.candles) || !Array.isArray(payload.sameClockVolumes)) throw new Error('Expected StrategyScreeningData payload.');
    // Receipt is recorded honestly. Imported files cannot be backdated into an older decision.
    const assessment = evaluateStrategyScreening({strategyId:document.strategyId,cutoffAt:receivedAt,data:payload});
    const hash = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
    const { error } = await db.from('source_snapshots').insert({ ...identity,run_id:document.runId,symbol:document.symbol,source:document.sourceUrl,data_type:'strategy_screening_input',payload,provider_reference:document.sourceUrl,content_hash:hash,observed_at:payload.book?.observedAt??null,effective_at:null,published_at:null,fetched_at:receivedAt,available_at:receivedAt,is_historical_snapshot:false,temporal_validation_status:'valid' });
    if (error) throw new Error('Archive persistence failed. Verify migration and permissions.');
    console.log(JSON.stringify({status:'recorded_for_forward_screening',receivedAt,strategyId:document.strategyId,support:assessment.support,notice:'Run screening again; existing decisions remain immutable. File contents retain provider timestamps, receipt is never backdated.'},null,2));
  } else {
    if (!Number.isSafeInteger(document.snapshotId)) throw new Error('snapshotId must identify a persisted decision.');
    const snapshot = await db.from('signal_snapshots').select('*').eq('id',document.snapshotId).eq('run_id',document.runId).eq('symbol',document.symbol).single();
    if (snapshot.error || !snapshot.data || Object.entries(identity).some(([k,v])=>snapshot.data[k]!==v)) throw new Error('Outcome snapshot identity mismatch.');
    if (!document.payload || !Array.isArray(document.payload.candles) || !document.payload.calendar || !document.payload.asOf || Date.parse(document.payload.asOf)>Date.parse(receivedAt)) throw new Error('Expected StrategyOutcomeArchive with nonfuture asOf.');
    const { error } = await db.from('strategy_outcome_archives').insert({snapshot_id:document.snapshotId,archive:{...document.payload,...identity},recorded_at:receivedAt});
    if (error) throw new Error('Outcome archive persistence failed. Verify migration and permissions.');
    console.log(JSON.stringify({status:'outcome_archive_recorded',snapshotId:document.snapshotId,receivedAt,notice:'Run POST /api/backtest/evaluate for this strategy. No predictive fields were changed.'}));
  }
}
main().catch(error=>{console.error(error instanceof Error?error.message:'Archive import failed.');process.exitCode=1;});
