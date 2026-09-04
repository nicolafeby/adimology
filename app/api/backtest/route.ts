import { NextResponse } from 'next/server';
import { loadBacktestConfig, segmentBacktest, summarizeBacktest } from '@/lib/backtest';
import { getBacktestRows } from '@/lib/supabase';
import { RANKING_MODEL_VERSION } from '@/lib/model-version';

export async function GET() {
  try {
    const rows = await getBacktestRows(RANKING_MODEL_VERSION);
    const config = loadBacktestConfig();
    const current = rows.filter((row) => row.backtest_config_version === config.configVersion);
    const primaryRows = current.length ? current : rows.filter((row) => row.backtest_config_version == null);
    return NextResponse.json({ success: true, summary: summarizeBacktest(primaryRows, config), segments: segmentBacktest(rows, config), data: rows });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : 'Gagal mengambil backtest' }, { status: 500 });
  }
}
