import { NextRequest, NextResponse } from 'next/server';
import { formatMarketDate } from '@/lib/date';
import { fetchWatchlist, fetchMarketDetector, fetchOrderbook, getTopBroker, fetchEmitenInfo, fetchHistoricalSummary } from '@/lib/stockbit';
import { calculateTargets } from '@/lib/calculations';
import { saveWatchlistAnalysis, updatePreviousDayRealPrice, getCachedWatchlistItems, getCachedWatchlistGroups } from '@/lib/supabase';

export async function POST(request: NextRequest) {
  try {
    // Optional: Add authorization check
    const authHeader = request.headers.get('authorization');
    const expectedToken = process.env.CRON_SECRET;

    if (expectedToken && authHeader !== `Bearer ${expectedToken}`) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }

    // Get current date for analysis
    const today = formatMarketDate();

    // Try to fetch watchlist from local cache first
    let watchlistItems: any[] = [];
    
    // Get the default group from cache
    const cachedGroups = await getCachedWatchlistGroups();
    if (cachedGroups.groups.length > 0) {
      const defaultGroup = cachedGroups.groups.find(g => g.is_default) || cachedGroups.groups[0];
      const cached = await getCachedWatchlistItems(defaultGroup.watchlist_id);
      watchlistItems = cached.items;
    }
    
    // Fallback to Stockbit API if cache is empty
    if (watchlistItems.length === 0) {
      const watchlistResponse = await fetchWatchlist();
      watchlistItems = watchlistResponse.data?.result || [];
    }


    if (watchlistItems.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'No watchlist items to analyze',
        results: []
      });
    }

    const results = [];
    const errors = [];

    // Analyze each watchlist item
    for (const item of watchlistItems) {
      const emiten = item.symbol || item.company_code;

      try {
        // Fetch market data for today
        const [marketDetectorData, orderbookData, emitenInfoData] = await Promise.all([
          fetchMarketDetector(emiten, today, today),
          fetchOrderbook(emiten),
          fetchEmitenInfo(emiten).catch(() => null), // Don't fail if sector fetch fails
        ]);

        const brokerData = getTopBroker(marketDetectorData);
        const sector = emitenInfoData?.data?.sector || undefined;


        if (!brokerData) {
          errors.push({ emiten, error: 'No broker data' });
          continue;
        }

        const obData = orderbookData.data || (orderbookData as any);
        const offerPrices = (obData.offer || []).map((o: any) => Number(o.price));
        const bidPrices = (obData.bid || []).map((b: any) => Number(b.price));

        const marketData = {
          harga: Number(obData.close),
          offerTeratas: Number(obData.ara?.value ?? obData.ara) > Number(obData.close)
            ? Number(obData.ara?.value ?? obData.ara)
            : offerPrices.length > 0 ? Math.max(...offerPrices) : Number(obData.high || 0),
          bidTerbawah: Number(obData.arb?.value ?? obData.arb) > 0 && Number(obData.arb?.value ?? obData.arb) < Number(obData.close)
            ? Number(obData.arb?.value ?? obData.arb)
            : bidPrices.length > 0 ? Math.min(...bidPrices) : 0,
          totalBid: Number(obData.total_bid_offer.bid.lot.replace(/,/g, '')),
          totalOffer: Number(obData.total_bid_offer.offer.lot.replace(/,/g, '')),
        };

        const calculated = calculateTargets(
          brokerData.rataRataBandar,
          brokerData.barangBandar,
          marketData.offerTeratas,
          marketData.bidTerbawah,
          marketData.totalBid / 100,
          marketData.totalOffer / 100,
          marketData.harga
        );

        // Save to database
        await saveWatchlistAnalysis({
          from_date: today,
          to_date: today,
          emiten,
          sector,
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
          status: 'success'
        });

        // Update previous day's record with real price from historical data
        try {
          // Fetch yesterday's close and high from historical summary
          const yesterday = new Date();
          yesterday.setDate(yesterday.getDate() - 7); // Look back 7 days to ensure we get data
          const historicalData = await fetchHistoricalSummary(emiten, yesterday.toISOString().split('T')[0], today, 5);
          
          if (historicalData.length > 0) {
            // Get the most recent historical data (which is today's or latest available)
            const latestData = historicalData[0];
            await updatePreviousDayRealPrice(emiten, today, latestData.close, latestData.high);
          }
        } catch (updateError) {
          console.error(`Failed to update previous day real price for ${emiten}`, updateError);
        }

        results.push({ emiten, status: 'success' });

      } catch (error) {
        console.error(`Error analyzing ${emiten}:`, error);

        errors.push({
          emiten,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }

    return NextResponse.json({
      success: true,
      date: today,
      analyzed: results.length,
      errors: errors.length,
      results,
      errorDetails: errors
    });

  } catch (error) {
    console.error('Watchlist analysis error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}
