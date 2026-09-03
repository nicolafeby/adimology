import { NextResponse } from 'next/server';
import { fetchStockbitPortfolio } from '@/lib/stockbit-portfolio';

export async function GET() {
  try {
    return NextResponse.json({ success: true, data: await fetchStockbitPortfolio() }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    const value = error as Error & { status?: number; code?: string };
    return NextResponse.json({ success: false, code: value.code, error: value.message || 'Gagal mengambil portofolio' }, { status: value.status || 502 });
  }
}
