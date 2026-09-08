import { NextRequest, NextResponse } from 'next/server';
import { runMarketScreener } from '@/lib/screener-service';
import { parseScreenerRequest } from '@/lib/screener-request';
import { guardScreenerRequest, screeningApiError } from '@/lib/screener-api';
export const maxDuration = 300;
export async function POST(request: NextRequest) {
  const denied = await guardScreenerRequest(request, true); if (denied) return denied;
  try {
    let body: unknown;
    try { body = await request.json(); } catch { throw new RangeError('Body JSON tidak valid.'); }
    const options = parseScreenerRequest(body);
    const headerKey = request.headers.get('idempotency-key');
    if (headerKey && !/^[A-Za-z0-9_.:-]{1,128}$/.test(headerKey)) throw new RangeError('Idempotency key tidak valid.');
    const result = await runMarketScreener({ ...options, triggerSource: 'api', idempotencyKey: headerKey ?? options.idempotencyKey });
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    if (error && typeof error === 'object' && 'message' in error && error.message === 'SCREENING_CAPACITY_REACHED') return NextResponse.json({ success: false, error: 'Empat run sedang berjalan. Tunggu salah satu selesai lalu coba lagi.' }, { status: 429, headers: { 'Retry-After': '30' } });
    if (error instanceof Error && error.message.startsWith('HISTORICAL_SNAPSHOT_MISSING')) return NextResponse.json({ success: false, code: 'insufficient_data', error: 'Arsip point-in-time dan universe historis belum lengkap. Historical replay tidak dijalankan.' }, { status: 422 });
    return screeningApiError(error, 'Screening gagal. Periksa koneksi sumber data atau coba lagi.');
  }
}
