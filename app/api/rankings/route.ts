import { NextRequest, NextResponse } from 'next/server';
import { formatMarketDate } from '@/lib/date';
import { getStockRankings } from '@/lib/supabase';

export async function GET(request: NextRequest) {
  try {
    const date = request.nextUrl.searchParams.get('date') || undefined;
    const limit = Math.min(100, Math.max(1, Number(request.nextUrl.searchParams.get('limit') || 10)));
    const rankings = await getStockRankings(date, limit);
    return NextResponse.json({ success: true, date: rankings[0]?.analysis_date ?? date ?? formatMarketDate(), data: rankings });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : 'Gagal mengambil ranking' }, { status: 500 });
  }
}
