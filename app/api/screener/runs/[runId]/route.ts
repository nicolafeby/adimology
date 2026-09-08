import { NextRequest, NextResponse } from 'next/server';
import { getScreeningRun, recoverStaleScreeningRuns } from '@/lib/supabase';
import { guardScreenerRequest, screeningQuery, screeningApiError } from '@/lib/screener-api';
import { validRunId } from '@/lib/screener-request';
export async function GET(request: NextRequest, { params }: { params: Promise<{ runId: string }> }) {
 const denied = await guardScreenerRequest(request); if (denied) return denied;
 try {
  const { runId } = await params, { strategyId } = screeningQuery(request);
  if (!validRunId(runId)) throw new RangeError('Run ID tidak valid.');
  await recoverStaleScreeningRuns();
  const run = await getScreeningRun(runId, strategyId);
  return run ? NextResponse.json({ success: true, run, summary: run.summary ?? {} }) : NextResponse.json({ success: false, error: 'Run tidak ditemukan untuk preset ini.' }, { status: 404 });
 } catch (error) { return screeningApiError(error, 'Run tidak dapat dimuat.'); }
}
