import { NextRequest, NextResponse } from 'next/server';
import { getLatestScreeningRun, recoverStaleScreeningRuns } from '@/lib/supabase';
import { guardScreenerRequest, screeningQuery, screeningApiError } from '@/lib/screener-api';
export async function GET(request: NextRequest) {
  const denied = await guardScreenerRequest(request); if (denied) return denied;
  try {
    const { date, strategyId } = screeningQuery(request);
    await recoverStaleScreeningRuns();
    const snapshot = await getLatestScreeningRun(date, strategyId, { includeRunning: true });
    if (!snapshot) return NextResponse.json({ success: false, error: 'Run preset ini belum tersedia.' }, { status: 404 });
    return NextResponse.json({ success: true, run: snapshot.run, summary: snapshot.run.summary ?? {} });
  } catch (error) { return screeningApiError(error, 'Run tidak dapat dimuat.'); }
}
