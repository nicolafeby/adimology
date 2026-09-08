import { NextRequest, NextResponse } from 'next/server';
import { getScreeningRun, getScreeningSymbolJourney } from '@/lib/supabase';
import { guardScreenerRequest, screeningQuery, screeningApiError } from '@/lib/screener-api';
import { validRunId } from '@/lib/screener-request';
export async function GET(request: NextRequest, { params }: { params: Promise<{ runId: string; symbol: string }> }) {
 const denied = await guardScreenerRequest(request); if (denied) return denied;
 try {
  const { runId, symbol: raw } = await params, symbol = raw.toUpperCase(), { strategyId } = screeningQuery(request);
  if (!validRunId(runId) || !/^[A-Z0-9]{4,12}$/.test(symbol)) throw new RangeError('Parameter tidak valid.');
  if (!await getScreeningRun(runId, strategyId)) return NextResponse.json({ success: false, error: 'Run tidak ditemukan untuk preset ini.' }, { status: 404 });
  const data = await getScreeningSymbolJourney(runId, symbol);
  return data ? NextResponse.json({ success: true, data }) : NextResponse.json({ success: false, error: 'Perjalanan emiten tidak ditemukan.' }, { status: 404 });
 } catch (error) { return screeningApiError(error, 'Perjalanan emiten tidak dapat dimuat.'); }
}
