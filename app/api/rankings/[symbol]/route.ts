import { NextRequest, NextResponse } from 'next/server';
import { getStockRankingDetail } from '@/lib/supabase';

export async function GET(request: NextRequest, { params }: { params: Promise<{ symbol: string }> }) {
  try {
    const { symbol: rawSymbol } = await params;
    const symbol = rawSymbol.toUpperCase();
    if (!/^[A-Z0-9]{4,12}$/.test(symbol)) return NextResponse.json({ success: false, error: 'Kode saham tidak valid' }, { status: 400 });
    const result = await getStockRankingDetail(symbol, request.nextUrl.searchParams.get('date') || undefined);
    if (!result.ranking) return NextResponse.json({ success: false, error: 'Detail ranking tidak ditemukan' }, { status: 404 });
    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : 'Gagal mengambil detail ranking' }, { status: 500 });
  }
}
