import { NextRequest, NextResponse } from 'next/server';
import { runMarketScreener } from '@/lib/screener-service';

export const maxDuration = 300;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const result = await runMarketScreener({ analysisDate: body.analysisDate, universeLimit: Math.min(Number(body.universeLimit ?? 1000), 1000), deepLimit: Math.min(Number(body.deepLimit ?? 50), 100), aiLimit: Math.max(0, Math.min(Number(body.aiLimit ?? 10), 20)), concurrency: Math.min(Number(body.concurrency ?? 4), 6) });
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    const message = error instanceof Error
      ? error.message
      : error && typeof error === 'object' && 'message' in error && typeof error.message === 'string'
        ? error.message
        : 'Screening gagal';
    console.error('Market screener failed:', error);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
