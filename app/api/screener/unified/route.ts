import { NextRequest, NextResponse } from 'next/server';
import { guardScreenerRequest, screeningApiError } from '@/lib/screener-api';
import { parseScreenerRequest, validAnalysisDate, validRunId } from '@/lib/screener-request';
import { getUnifiedScreenerSnapshot, runUnifiedScreener } from '@/lib/unified-screener-service';

export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const denied = await guardScreenerRequest(request);
  if (denied) return denied;
  try {
    const date = request.nextUrl.searchParams.get('date') || undefined;
    const runId = request.nextUrl.searchParams.get('runId') || undefined;
    if (date && !validAnalysisDate(date)) throw new RangeError('Tanggal tidak valid.');
    if (runId && !validRunId(runId)) throw new RangeError('Run ID tidak valid.');
    return NextResponse.json({ success: true, ...await getUnifiedScreenerSnapshot({ date, runId }) });
  } catch (error) {
    return screeningApiError(error, 'Hasil screener terpadu tidak dapat dimuat.');
  }
}

export async function POST(request: NextRequest) {
  const denied = await guardScreenerRequest(request, true);
  if (denied) return denied;
  try {
    let body: unknown;
    try { body = await request.json(); } catch { throw new RangeError('Body JSON tidak valid.'); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new RangeError('Body JSON harus berupa object.');
    const parsed = parseScreenerRequest({ ...(body as Record<string, unknown>), strategyId: 'swing' });
    const headerKey = request.headers.get('idempotency-key');
    if (headerKey && !/^[A-Za-z0-9_.:-]{1,128}$/.test(headerKey)) throw new RangeError('Idempotency key tidak valid.');
    const run = await runUnifiedScreener({ ...parsed, triggerSource: 'api-unified', idempotencyKey: headerKey ?? parsed.idempotencyKey });
    const snapshot = await getUnifiedScreenerSnapshot({ runId: run.runId });
    return NextResponse.json({ success: true, ...snapshot });
  } catch (error) {
    return screeningApiError(error, 'Screener terpadu gagal dijalankan.');
  }
}
