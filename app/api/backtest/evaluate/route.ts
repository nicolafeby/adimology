import { NextRequest, NextResponse } from 'next/server';
import { evaluateMatureSignals } from '@/lib/outcome-service';
import { guardScreenerRequest, screeningApiError } from '@/lib/screener-api';
import { parseStrategyId } from '@/lib/strategies';

export const maxDuration = 300;

export async function POST(request: NextRequest) {
  const denied = await guardScreenerRequest(request, true); if (denied) return denied;
  try {
    const raw = await request.text();
    let body: Record<string, unknown> = {};
    if (raw.trim()) { try { body = JSON.parse(raw); } catch { throw new RangeError('Body JSON tidak valid.'); } }
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new RangeError('Body harus object JSON.');
    const strategyId = parseStrategyId(body.strategyId ?? request.nextUrl.searchParams.get('strategyId'));
    return NextResponse.json({ success: true, ...await evaluateMatureSignals(100, strategyId) });
  } catch (error) {
    return screeningApiError(error, 'Evaluasi outcome gagal. Coba lagi setelah sumber data tersedia.');
  }
}
