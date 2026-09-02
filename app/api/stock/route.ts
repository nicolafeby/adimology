import { NextRequest, NextResponse } from 'next/server';
import { fetchMarketDetector, fetchOrderbook, getTopBroker, parseLot, getBrokerSummary, fetchEmitenInfo, fetchHistoricalSummary, fetchKeyStats } from '@/lib/stockbit';
import { calculateTargets } from '@/lib/calculations';
import { buildComprehensiveAnalysis } from '@/lib/analysis';
import { saveStockQuery, updatePendingRealPrices, getLatestStockQuery, getSpecificStockQuery, getStockPriceByDate, getRecentStockQueries, getLatestCompletedAgentStory } from '@/lib/supabase';
import type { StockInput, ApiResponse } from '@/lib/types';
import { formatMarketDate } from '@/lib/date';

export async function POST(request: NextRequest) {
  try {
    const body: StockInput = await request.json();
    const { emiten, fromDate, toDate } = body;

    // Validate input
    if (!emiten || !fromDate || !toDate) {
      return NextResponse.json(
        { success: false, error: 'Missing required fields: emiten, fromDate, toDate' },
        { status: 400 }
      );
    }

    const isSingleDate = fromDate === toDate;
    const todayStr = formatMarketDate();
    const isToday = toDate === todayStr;

    // 2. Fetch data from both Stockbit APIs and emiten info
    const historyStart = new Date(`${toDate}T00:00:00Z`);
    historyStart.setUTCDate(historyStart.getUTCDate() - 140);
    const [marketDetectorData, orderbookData, emitenInfoData, historicalData, keyStatsData, benchmarkHistory, brokerHistory, catalyst] = await Promise.all([
      fetchMarketDetector(emiten, fromDate, toDate),
      fetchOrderbook(emiten),
      fetchEmitenInfo(emiten).catch(() => null),
      fetchHistoricalSummary(emiten, historyStart.toISOString().slice(0, 10), toDate, 100).catch(() => []),
      fetchKeyStats(emiten).catch(() => undefined),
      fetchHistoricalSummary('COMPOSITE', historyStart.toISOString().slice(0, 10), toDate, 100).catch(() => []),
      getRecentStockQueries(emiten).catch(() => []),
      getLatestCompletedAgentStory(emiten).catch(() => null),
    ]);

    // Extract top broker data
    const brokerData = getTopBroker(marketDetectorData);

    if (!brokerData) {
       // Attempt to fetch latest historical data
       const historyData = await getLatestStockQuery(emiten);
       
       if (historyData) {
         return NextResponse.json({
           success: true,
           data: {
             input: { emiten, fromDate: historyData.from_date, toDate: historyData.to_date },
             stockbitData: {
               bandar: historyData.bandar,
               barangBandar: historyData.barang_bandar,
               rataRataBandar: historyData.rata_rata_bandar
             },
             marketData: {
                harga: historyData.harga,
                offerTeratas: historyData.ara,
                bidTerbawah: historyData.arb,
                totalBid: historyData.total_bid,
                totalOffer: historyData.total_offer,
                fraksi: historyData.fraksi
             },
             calculated: {
               totalPapan: historyData.total_papan,
               rataRataBidOfer: historyData.rata_rata_bid_ofer,
               a: historyData.a,
               p: historyData.p,
               targetRealistis1: historyData.target_realistis,
               targetMax: historyData.target_max
             },
             brokerSummary: null,
             isFromHistory: historyData.from_date !== fromDate || historyData.to_date !== toDate,
             historyDate: historyData.from_date
           }
         });
       }

      return NextResponse.json(
        {
          success: false,
          error: 'Data broker tidak tersedia untuk periode ini (Market belum buka atau saham tidak aktif)'
        },
        { status: 404 }
      );
    }

    // Extract broker summary for the new card
    const brokerSummary = getBrokerSummary(marketDetectorData);

    // Extract sector from emiten info
    const sector = emitenInfoData?.data?.sector || undefined;

    // Extract market data
    const obData = orderbookData.data || (orderbookData as any);

    if (!obData.total_bid_offer || obData.close === undefined) {
      throw new Error('Invalid Orderbook API response structure');
    }

    // Default market data from orderbook (live)
    let marketData = {
      harga: Number(obData.close),
      offerTeratas: 0,
      bidTerbawah: 0,
      totalBid: parseLot(obData.total_bid_offer.bid.lot),
      totalOffer: parseLot(obData.total_bid_offer.offer.lot),
    };

    const offerPrices = (obData.offer || []).map((o: { price: string }) => Number(o.price));
    const bidPrices = (obData.bid || []).map((b: { price: string }) => Number(b.price));

    const officialAra = Number(obData.ara?.value ?? obData.ara);
    const officialArb = Number(obData.arb?.value ?? obData.arb);
    marketData.offerTeratas = officialAra > marketData.harga
      ? officialAra
      : offerPrices.length > 0 ? Math.max(...offerPrices) : Number(obData.high || 0);
    marketData.bidTerbawah = officialArb > 0 && officialArb < marketData.harga
      ? officialArb
      : bidPrices.length > 0 ? Math.min(...bidPrices) : 0;

    const toOrderbookLevel = (level: {
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

    // Orderbook is a live snapshot, so do not attach it to historical analysis.
    const orderbook = isToday
      ? {
          bid: (obData.bid || []).slice(0, 10).map(toOrderbookLevel),
          offer: (obData.offer || []).slice(0, 10).map(toOrderbookLevel),
        }
      : undefined;

    // 3. For any non-today queries (past single dates or ranges), Override Price from Database (if available)
    if (!isToday) {
      const histPrice = await getStockPriceByDate(emiten, toDate);
      if (histPrice) {
        marketData = {
          harga: Number(histPrice.harga),
          offerTeratas: Number(histPrice.ara),
          bidTerbawah: Number(histPrice.arb),
          totalBid: Number(histPrice.total_bid),
          totalOffer: Number(histPrice.total_offer),
        };
      }
    }

    // Calculate targets
    const calculated = calculateTargets(
      brokerData.rataRataBandar,
      brokerData.barangBandar,
      marketData.offerTeratas,
      marketData.bidTerbawah,
      marketData.totalBid / 100,
      marketData.totalOffer / 100,
      marketData.harga
    );

    // Additional analysis is deliberately additive. Existing target calculations
    // remain unchanged for backward compatibility.
    const comprehensiveAnalysis = buildComprehensiveAnalysis({
      brokerSummary,
      orderbook,
      lastPrice: marketData.harga,
      history: historicalData,
      keyStats: keyStatsData,
      benchmarkHistory,
      brokerHistory,
      catalyst,
    });

    // Prepare response
    const result: ApiResponse = {
      success: true,
      data: {
        input: { emiten, fromDate, toDate },
        stockbitData: brokerData,
        marketData: {
          ...marketData,
          fraksi: calculated.fraksi,
        },
        calculated: {
          totalPapan: calculated.totalPapan,
          rataRataBidOfer: calculated.rataRataBidOfer,
          a: calculated.a,
          p: calculated.p,
          targetRealistis1: calculated.targetRealistis1,
          targetMax: calculated.targetMax,
        },
        brokerSummary,
        sector,
        orderbook,
        comprehensiveAnalysis,
      },
    };

    // 4. Save to Supabase ONLY if Single Date Query
    if (isSingleDate) {
      await saveStockQuery({
        emiten,
        sector,
        from_date: fromDate,
        to_date: toDate,
        bandar: brokerData.bandar,
        barang_bandar: brokerData.barangBandar,
        rata_rata_bandar: brokerData.rataRataBandar,
        harga: marketData.harga,
        ara: marketData.offerTeratas,
        arb: marketData.bidTerbawah,
        fraksi: calculated.fraksi,
        total_bid: marketData.totalBid,
        total_offer: marketData.totalOffer,
        total_papan: calculated.totalPapan,
        rata_rata_bid_ofer: calculated.rataRataBidOfer,
        a: calculated.a,
        p: calculated.p,
        target_realistis: calculated.targetRealistis1,
        target_max: calculated.targetMax,
      });

      // A price snapshot for this date evaluates the most recent earlier signal.
      // This also covers records created through the manual stock analysis flow.
      await updatePendingRealPrices(emiten, historicalData);
    }

    return NextResponse.json(result);
  } catch (error) {
    console.error('API Error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
      },
      { status: 500 }
    );
  }
}
