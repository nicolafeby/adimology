import { NextRequest, NextResponse } from 'next/server';
import { connectStockbitSecurities } from '@/lib/stockbit-portfolio';

export async function POST(request: NextRequest) {
  try {
    const { pin } = await request.json();
    await connectStockbitSecurities(String(pin || ''));
    return NextResponse.json({ success: true });
  } catch (error) {
    const value = error as Error & { status?: number };
    return NextResponse.json({ success: false, error: value.message || 'Gagal menghubungkan akun sekuritas' }, { status: value.status || 502 });
  }
}
