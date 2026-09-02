import { NextRequest, NextResponse } from 'next/server';
import { fetchOrderbook, parseLot } from '@/lib/stockbit';

const toLevel = (level: {
  price: string;
  volume: string;
  que_num: string;
  change_percentage: string;
}) => ({
  price: Number(level.price),
  volume: parseLot(level.volume),
  queues: parseLot(level.que_num),
  changePercentage: Number(level.change_percentage || 0),
});

export async function GET(request: NextRequest) {
  const emiten = request.nextUrl.searchParams.get('emiten')?.trim().toUpperCase();

  if (!emiten || !/^[A-Z0-9]{4,12}$/.test(emiten)) {
    return NextResponse.json(
      { success: false, error: 'Kode emiten tidak valid' },
      { status: 400 },
    );
  }

  try {
    const response = await fetchOrderbook(emiten);
    const data = response.data || response;

    if (!data.total_bid_offer || data.close === undefined) {
      throw new Error('Invalid Orderbook API response structure');
    }

    const result = {
      marketData: {
        harga: Number(data.close),
        offerTeratas: Number(data.ara?.value ?? data.ara) > Number(data.close)
          ? Number(data.ara?.value ?? data.ara)
          : data.offer?.length
          ? Math.max(...data.offer.map((level) => Number(level.price)))
          : Number(data.high || 0),
        bidTerbawah: Number(data.arb?.value ?? data.arb) > 0 && Number(data.arb?.value ?? data.arb) < Number(data.close)
          ? Number(data.arb?.value ?? data.arb)
          : data.bid?.length
          ? Math.min(...data.bid.map((level) => Number(level.price)))
          : 0,
        totalBid: parseLot(data.total_bid_offer.bid.lot),
        totalOffer: parseLot(data.total_bid_offer.offer.lot),
      },
      orderbook: {
        bid: (data.bid || []).slice(0, 10).map(toLevel),
        offer: (data.offer || []).slice(0, 10).map(toLevel),
      },
      updatedAt: new Date().toISOString(),
    };

    return NextResponse.json(
      { success: true, data: result },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Gagal mengambil orderbook',
      },
      { status: 502 },
    );
  }
}
