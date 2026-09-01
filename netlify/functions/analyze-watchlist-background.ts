import { fetchWatchlist, fetchMarketDetector, fetchOrderbook, getTopBroker, fetchEmitenInfo, fetchHistoricalSummary } from '../../lib/stockbit';
import { formatMarketDate } from '../../lib/date';
import { calculateTargets } from '../../lib/calculations';
import { 
  saveWatchlistAnalysis, 
  updatePreviousDayRealPrice,
  createBackgroundJobLog,
  appendBackgroundJobLogEntry,
  updateBackgroundJobLog
} from '../../lib/supabase';

export default async (req: Request) => {
  const startTime = Date.now();
  let jobLogId: number | null = null;

  console.log('[Background] Starting analysis job...');

  try {
    // Get current date for analysis
    const today = formatMarketDate();

    // Fetch watchlist first to know total items
    const watchlistResponse = await fetchWatchlist();
    const watchlistItems = watchlistResponse.data?.result || [];

    if (watchlistItems.length === 0) {
      console.log('[Background] No watchlist items to analyze');
      return new Response(JSON.stringify({ success: true, message: 'No items' }), { status: 200 });
    }

    // Create job log entry
    try {
      const jobLog = await createBackgroundJobLog('analyze-watchlist', watchlistItems.length);
      jobLogId = jobLog.id;
      console.log(`[Background] Created job log with ID: ${jobLogId}`);
    } catch (logError) {
      console.error('[Background] Failed to create job log, continuing without logging:', logError);
    }

    const results = [];
    const errors: { emiten: string; error: string }[] = [];

    // Analyze each watchlist item
    for (const item of watchlistItems) {
      const emiten = item.symbol || item.company_code;
      console.log(`[Background] Analyzing ${emiten}...`);

      try {
        const [marketDetectorData, orderbookData, emitenInfoData] = await Promise.all([
          fetchMarketDetector(emiten, today, today),
          fetchOrderbook(emiten),
          fetchEmitenInfo(emiten).catch(() => null),
        ]);

        const brokerData = getTopBroker(marketDetectorData);
        if (!brokerData) {
          const errorMsg = 'No broker data available';
          errors.push({ emiten, error: errorMsg });
          
          if (jobLogId) {
            await appendBackgroundJobLogEntry(jobLogId, {
              level: 'warn',
              message: errorMsg,
              emiten,
            });
          }
          continue;
        }

        const sector = emitenInfoData?.data?.sector || undefined;
        const obData = orderbookData.data || (orderbookData as any);
        const offerPrices = (obData.offer || []).map((o: any) => Number(o.price));
        const bidPrices = (obData.bid || []).map((b: any) => Number(b.price));

        const marketData = {
          harga: Number(obData.close),
          offerTeratas: offerPrices.length > 0 ? Math.max(...offerPrices) : Number(obData.high || 0),
          bidTerbawah: bidPrices.length > 0 ? Math.min(...bidPrices) : 0,
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

        // Update previous day's record with close and high from historical data
        try {
          const yesterday = new Date();
          yesterday.setDate(yesterday.getDate() - 7); // Look back 7 days to ensure we get data
          const historicalData = await fetchHistoricalSummary(emiten, yesterday.toISOString().split('T')[0], today, 5);
          
          if (historicalData.length > 0) {
            const latestData = historicalData[0];
            await updatePreviousDayRealPrice(emiten, today, latestData.close, latestData.high);
          }
        } catch (updateError) {
          console.error(`[Background] Failed to update price for ${emiten}`, updateError);
        }

        results.push({ emiten, status: 'success' });

        // Log successful analysis
        if (jobLogId) {
          await appendBackgroundJobLogEntry(jobLogId, {
            level: 'info',
            message: `Successfully analyzed`,
            emiten,
            details: { 
              harga: marketData.harga, 
              targetRealistis: calculated.targetRealistis1 
            },
          });
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`[Background] Error analyzing ${emiten}:`, error);
        errors.push({ emiten, error: errorMessage });

        // Log error for this emiten
        if (jobLogId) {
          // Check if it's a token error
          const isTokenError = errorMessage.includes('401') || 
                               errorMessage.includes('unauthorized') ||
                               errorMessage.includes('token') ||
                               errorMessage.includes('authentication');
          
          await appendBackgroundJobLogEntry(jobLogId, {
            level: 'error',
            message: isTokenError ? 'Token authentication failed' : errorMessage,
            emiten,
            details: { 
              isTokenError,
              originalError: errorMessage 
            },
          });
        }
      }
    }

    const duration = (Date.now() - startTime) / 1000;
    console.log(`[Background] Job completed in ${duration}s. Success: ${results.length}, Errors: ${errors.length}`);

    // Update job log with final status
    if (jobLogId) {
      const hasErrors = errors.length > 0;
      await updateBackgroundJobLog(jobLogId, {
        status: hasErrors && results.length === 0 ? 'failed' : 'completed',
        success_count: results.length,
        error_count: errors.length,
        error_message: hasErrors ? `${errors.length} items failed` : undefined,
        metadata: { 
          duration_seconds: duration,
          date: today,
        },
      });
    }

    return new Response(JSON.stringify({ 
      success: true, 
      results: results.length, 
      errors: errors.length,
      jobLogId,
    }), { status: 200 });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error('[Background] Critical error:', error);

    // Check if it's a token-related error
    const isTokenError = errorMessage.includes('401') || 
                         errorMessage.includes('unauthorized') ||
                         errorMessage.includes('token') ||
                         errorMessage.includes('authentication');

    // Update job log with failure
    if (jobLogId) {
      await appendBackgroundJobLogEntry(jobLogId, {
        level: 'error',
        message: isTokenError 
          ? 'Stockbit token expired or invalid. Please refresh your token.'
          : errorMessage,
        details: { isTokenError, error: errorMessage }
      });

      await updateBackgroundJobLog(jobLogId, {
        status: 'failed',
        error_message: isTokenError 
          ? 'Stockbit token expired or invalid. Please refresh your token.'
          : errorMessage,
        metadata: { 
          isTokenError,
          duration_seconds: (Date.now() - startTime) / 1000,
        },
      });
    } else {
      // If we couldn't create a job log, try to create one now with the error
      try {
        const failedLog = await createBackgroundJobLog('analyze-watchlist', 0);
        await updateBackgroundJobLog(failedLog.id, {
          status: 'failed',
          error_message: isTokenError 
            ? 'Stockbit token expired or invalid. Please refresh your token.'
            : errorMessage,
          metadata: { isTokenError },
        });
      } catch (logError) {
        console.error('[Background] Failed to log critical error:', logError);
      }
    }

    return new Response(JSON.stringify({ 
      success: false, 
      error: errorMessage,
      isTokenError,
    }), { status: 500 });
  }
};
