import { NextRequest, NextResponse } from 'next/server';
import { getScreeningRunHistory, recoverStaleScreeningRuns } from '@/lib/supabase';
import { guardScreenerRequest, screeningQuery, screeningApiError } from '@/lib/screener-api';
import { boundedInteger } from '@/lib/screener-request';
export async function GET(request: NextRequest) {
 const denied = await guardScreenerRequest(request); if (denied) return denied;
 try {
  const { strategyId } = screeningQuery(request), limit = boundedInteger(request.nextUrl.searchParams.get('limit'), 20, 1, 100, 'limit');
  await recoverStaleScreeningRuns();
  const data = await getScreeningRunHistory(strategyId, limit);
  return NextResponse.json({ success: true, strategyId, data, runs: data });
 } catch (error) { return screeningApiError(error, 'History tidak dapat dimuat.'); }
}
