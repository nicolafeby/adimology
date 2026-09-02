import { NextRequest, NextResponse } from 'next/server';
import { runMarketScreener } from '@/lib/screener-service';

export const maxDuration = 300;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const result = await runMarketScreener({ analysisDate: body.analysisDate, universeLimit: Math.min(Number(body.universeLimit || 1000), 1000), deepLimit: Math.min(Number(body.deepLimit || 50), 100), aiLimit: Math.min(Number(body.aiLimit || 10), 20), concurrency: Math.min(Number(body.concurrency || 4), 6) });
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : 'Screening gagal' }, { status: 500 });
  }
}
