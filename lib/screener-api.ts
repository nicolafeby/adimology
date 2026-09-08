import { isScreeningUpdateRequired, SCREENING_UPDATE_REQUIRED, SCREENING_UPDATE_MESSAGE } from './screening-errors';
import { NextRequest, NextResponse } from 'next/server';
import { verifySessionToken, sessionTokenFromRequest } from './auth';
import { secretsEqual, isSameOrigin } from './request-security';
import { parseStrategyId } from './strategies';
import { validAnalysisDate, validRunId } from './screener-request';

/** Route-level guard also protects direct handler invocations and non-proxy runtimes. */
export async function guardScreenerRequest(request: NextRequest | Request, mutation = false): Promise<NextResponse | null> {
  if (secretsEqual(request.headers.get('authorization'), process.env.CRON_SECRET ? `Bearer ${process.env.CRON_SECRET}` : undefined)) return null;
  const cookie = sessionTokenFromRequest(request);
  const session = cookie ? await verifySessionToken(cookie) : null;
  if (!session?.authenticated) return NextResponse.json({ success: false, code: 'SESSION_EXPIRED', error: 'Sesi tidak valid. Silakan masuk kembali.' }, { status: 401 });
  if (mutation && !isSameOrigin(request instanceof NextRequest ? request : new NextRequest(request.url, { headers: request.headers }))) return NextResponse.json({ success: false, error: 'Origin tidak diizinkan.' }, { status: 403 });
  return null;
}
export function screeningQuery(request: NextRequest) {
  const q = request.nextUrl.searchParams;
  const strategyId = parseStrategyId(q.get('strategyId'));
  const date = q.get('date') || undefined, runId = q.get('runId') || undefined;
  if (date && !validAnalysisDate(date)) throw new RangeError('Tanggal tidak valid.');
  if (runId && !validRunId(runId)) throw new RangeError('Run ID tidak valid.');
  return { strategyId, date, runId };
}
export function screeningApiError(error: unknown, fallback: string) {
  if (isScreeningUpdateRequired(error)) return NextResponse.json({ success: false, code: SCREENING_UPDATE_REQUIRED, error: SCREENING_UPDATE_MESSAGE }, { status: 503 });
  return NextResponse.json({ success: false, error: error instanceof RangeError ? error.message : fallback }, { status: error instanceof RangeError ? 400 : 500 });
}
