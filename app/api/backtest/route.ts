import { NextResponse } from 'next/server';
import { summarizeBacktest } from '@/lib/backtest';
import { getBacktestRows } from '@/lib/supabase';
import { RANKING_MODEL_VERSION } from '@/lib/model-version';

export async function GET() {
  try {
    const rows = await getBacktestRows(RANKING_MODEL_VERSION);
    return NextResponse.json({ success: true, summary: summarizeBacktest(rows), data: rows });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : 'Gagal mengambil backtest' }, { status: 500 });
  }
}
