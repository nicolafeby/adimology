import { NextRequest, NextResponse } from 'next/server';
import { getStockRankingDetail } from '@/lib/supabase';
import { guardScreenerRequest, screeningQuery, screeningApiError } from '@/lib/screener-api';
export async function GET(request: NextRequest, { params }: { params: Promise<{ symbol: string }> }) {
  const denied = await guardScreenerRequest(request); if (denied) return denied;
  try {
    const { symbol: rawSymbol } = await params, symbol = rawSymbol.toUpperCase();
    if (!/^[A-Z0-9]{4,12}$/.test(symbol)) throw new RangeError('Kode saham tidak valid.');
    const { date, strategyId, runId } = screeningQuery(request);
    const result = await getStockRankingDetail(symbol, date, strategyId, runId);
    if (!result.screening) return NextResponse.json({ success: false, error: 'Detail screening tidak ditemukan untuk run dan preset ini.' }, { status: 404 });
    return NextResponse.json({ success: true, data: result });
  } catch (error) { return screeningApiError(error, 'Detail screening tidak dapat dimuat.'); }
}
