/** Read-only integration audit. Never runs migrations, screening, AI or outcome writes. */
import { writeFile } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';
import { decryptSecret } from '../lib/secret-storage';
import { STRATEGY_IDS, strategyIdentity } from '../lib/strategies';

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const checkedAt = new Date().toISOString();
  const report: Record<string, unknown> = { checkedAt, mode: 'read_only_real_integration', writesPerformed: false, strategies: STRATEGY_IDS.map(id => ({ ...strategyIdentity(id), status: 'insufficient_data', metrics: null })) };
  if (!url || !key) { report.database = 'credentials_unavailable'; }
  else {
    const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(15_000) }) } });
    const [snapshots, archives, strategyRows, universe, session] = await Promise.all([
      db.from('signal_snapshots').select('id', { count: 'exact', head: true }),
      db.from('source_snapshots').select('data_type,available_at,is_historical_snapshot,payload').not('payload', 'is', null).limit(1000),
      db.from('signal_snapshots').select('strategy_id,strategy_version,configuration_version,execution_model,outcome_definition,execution_mode,point_in_time_valid,backtest_eligible,signal_date').limit(10000),
      db.from('idx_universe').select('symbol', { count: 'exact', head: true }),
      db.from('session').select('value').eq('key','stockbit_token').maybeSingle(),
    ]);
    report.database = { snapshotCount: snapshots.count, snapshotReadStatus: snapshots.error ? 'unavailable' : 'ok', snapshotReadCode: snapshots.error?.code ?? null, archivePayloadCount: archives.data?.length ?? null, archiveStatus: archives.error ? 'unavailable' : 'ok', archiveReadCode: archives.error?.code ?? null, strategySchemaStatus: strategyRows.error ? 'unavailable' : 'ok', strategySchemaCode: strategyRows.error?.code ?? null, activeUniverseCount: universe.count, historicalUniverseVerified: false };
    report.strategies = STRATEGY_IDS.map(id => {
      const identity = strategyIdentity(id), rows = (strategyRows.data ?? []).filter(row => Object.entries(identity).every(([k,v]) => row[k as keyof typeof row] === v) && row.point_in_time_valid && row.backtest_eligible);
      return { ...identity, status: 'insufficient_data', verifiedSnapshots: strategyRows.error ? null : rows.length, period: rows.length ? { from: rows.map(x=>x.signal_date).sort()[0], to: rows.map(x=>x.signal_date).sort().at(-1) } : null, metrics: null, missing: ['Historical universe, board changes and corporate action archive verified as available at cutoff', ...(id === 'swing' ? ['Compatible immutable SWING v8 snapshots with outcome archive'] : ['Completed intraday candles and same-clock volume archive', 'Verified calendar sessions', ...(id === 'ara' ? ['Official ARA per symbol/session with source timestamp'] : [])])] };
    });
    let token: string | null = null;
    try { token = session.data?.value ? decryptSecret(session.data.value) : process.env.STOCKBIT_JWT_TOKEN ?? null; } catch { /* Report unavailability without exposing secrets. */ }
    if (!token) report.provider = { status: 'token_unavailable' };
    else {
      const headers = { authorization: `Bearer ${token}`, origin: 'https://stockbit.com', referer: 'https://stockbit.com/', accept: 'application/json', 'user-agent': 'Mozilla/5.0' };
      const probe = async (path: string) => {
        try { const response = await fetch(`https://exodus.stockbit.com${path}`, { headers, signal: AbortSignal.timeout(15_000) }); return { status: response.status, data: response.ok ? await response.json() : null }; }
        catch { return { status: 'network_unavailable', data: null }; }
      };
      const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date());
      const start = new Date(); start.setDate(start.getDate()-30);
      const [daily, book] = await Promise.all([probe(`/company-price-feed/historical/summary/BBCA?period=HS_PERIOD_DAILY&start_date=${start.toISOString().slice(0,10)}&end_date=${date}&limit=25&page=1`), probe('/company-price-feed/v2/orderbook/companies/BBCA')]);
      const rows = Array.isArray(daily.data?.data?.result) ? daily.data.data.result : [];
      const orderbook = book.data?.data;
      report.provider = { symbol: 'BBCA', daily: { httpStatus: daily.status, resolution: 'daily', bars: rows.length, period: rows.length ? { from: rows.map((x: {date:string})=>x.date).sort()[0], to: rows.map((x: {date:string})=>x.date).sort().at(-1) } : null }, orderbook: { httpStatus: book.status, bidLevels: Array.isArray(orderbook?.bid) ? orderbook.bid.length : null, offerLevels: Array.isArray(orderbook?.offer) ? orderbook.offer.length : null, providerObservationTimestampPresent: !!(orderbook?.timestamp || orderbook?.observed_at), providerAraFieldPresent: !!orderbook?.ara, officialSessionLimitProvenanceVerified: false }, intradayAdapter: 'unavailable', structuredNewsAdapter: 'unavailable' };
    }
  }
  const file = 'docs/screening-data-audit.json';
  await writeFile(file, JSON.stringify(report, null, 2)+'\n');
  console.log(`Read-only integration evidence written to ${file}`);
}
main().catch(() => { console.error('Data audit failed; no sensitive error payload emitted.'); process.exitCode = 1; });
