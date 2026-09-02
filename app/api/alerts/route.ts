import { NextRequest, NextResponse } from 'next/server';
import { getRecentAlertEvents } from '@/lib/supabase';

export async function GET(request: NextRequest) {
  try {
    return NextResponse.json({ success: true, data: await getRecentAlertEvents(Math.min(100, Math.max(1, Number(request.nextUrl.searchParams.get('limit') || 20)))) });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : 'Gagal mengambil alert' }, { status: 500 });
  }
}
