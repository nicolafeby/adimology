import { NextRequest, NextResponse } from 'next/server';
import { evaluateMatureSignals } from '@/lib/outcome-service';

export const maxDuration = 300;

export async function POST(request: NextRequest) {
  const expected = process.env.CRON_SECRET;
  if (expected && request.headers.get('authorization') !== `Bearer ${expected}`) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
  try {
    return NextResponse.json({ success: true, ...await evaluateMatureSignals(100) });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : 'Evaluasi gagal' }, { status: 500 });
  }
}
