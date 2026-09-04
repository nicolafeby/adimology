import { NextRequest, NextResponse } from 'next/server';
import { getLatestScreeningRun } from '@/lib/supabase';

export async function GET(request: NextRequest) {
  try {
    const snapshot = await getLatestScreeningRun(request.nextUrl.searchParams.get('date') || undefined);
    if (!snapshot) return NextResponse.json({ success: false, error: 'Run lengkap atau parsial belum tersedia' }, { status: 404 });
    return NextResponse.json({ success: true, run: snapshot.run, summary: snapshot.run.summary ?? {} });
  } catch { return NextResponse.json({ success: false, error: 'Run tidak dapat dimuat' }, { status: 500 }); }
}
