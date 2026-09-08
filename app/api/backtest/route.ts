import { NextRequest, NextResponse } from 'next/server';
import { loadBacktestConfig, segmentBacktest, summarizeBacktest } from '@/lib/backtest';
import { getBacktestRows } from '@/lib/supabase';
import { ACTIVE_MODEL_VERSION } from '@/lib/model-versions';
import { guardScreenerRequest, screeningApiError } from '@/lib/screener-api';
import { parseStrategyId, strategyIdentity } from '@/lib/strategies';
import { marketBacktestReadiness } from '@/lib/strategy-backtest';

export async function GET(request: NextRequest) {
  const denied = await guardScreenerRequest(request); if (denied) return denied;
  try {
    const strategyId = parseStrategyId(request.nextUrl.searchParams.get('strategyId'));
    const mode = request.nextUrl.searchParams.get('executionMode') ?? 'live';
    if (!['live','historical_replay'].includes(mode)) throw new RangeError('executionMode harus live atau historical_replay.');
    const identity = strategyIdentity(strategyId), config = loadBacktestConfig();
    const allRows = await getBacktestRows(strategyId === 'swing' ? ACTIVE_MODEL_VERSION : identity.strategy_version);
    const rows = allRows.filter(row => {
      const snapshot = row.snapshot as Record<string, unknown> | undefined;
      return snapshot?.execution_mode === mode && Object.entries(identity).every(([key,value])=>snapshot?.[key]===value && row[key]===value) && row.backtest_config_version===config.configVersion;
    });
    const readiness = marketBacktestReadiness(strategyId);
    return NextResponse.json({ success:true,...identity,execution_mode:mode,status:rows.length?'observed_outcomes':'insufficient_data',readiness:rows.length?null:readiness,summary:strategyId==='ara'?null:summarizeBacktest(rows,config),segments:segmentBacktest(rows,config),data:rows.map(({snapshot,...row})=>row),validation:{holdout:'not_declared',marketStrategyValidated:false,drawdownMethod:'sequential_indexed_approximation',warning:'Outcome observasi belum merupakan validasi strategi tanpa periode holdout dan coverage universe terverifikasi.'} });
  } catch (error) { return screeningApiError(error,'Backtest belum dapat dimuat. Periksa konfigurasi data.'); }
}
