import { NextRequest, NextResponse } from 'next/server';
import { getStockRankingDetail } from '@/lib/supabase';

export async function GET(request: NextRequest, { params }: { params: Promise<{ symbol: string }> }) {
  try {
    const { symbol: rawSymbol } = await params;
    const symbol = rawSymbol.toUpperCase();
    if (!/^[A-Z0-9]{4,12}$/.test(symbol)) return NextResponse.json({ success: false, error: 'Kode saham tidak valid' }, { status: 400 });
    const result = await getStockRankingDetail(symbol, request.nextUrl.searchParams.get('date') || undefined);
    if (!result.ranking) return NextResponse.json({ success: false, error: 'Detail ranking tidak ditemukan' }, { status: 404 });
    const reasons = Array.isArray(result.ranking.reasons) ? result.ranking.reasons : [];
    const isAiV2 = reasons.some((reason: { label?: string; value?: string }) => reason.label === 'Scoring Model' && reason.value === 'multifactor-ai-v2') && reasons.some((reason: { label?: string }) => reason.label === 'AI Story');
    if (!isAiV2) return NextResponse.json({ success: false, error: 'Snapshot lama belum menggunakan AI integrated scoring v2. Jalankan screener kembali.' }, { status: 409 });
    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : 'Gagal mengambil detail ranking' }, { status: 500 });
  }
}
