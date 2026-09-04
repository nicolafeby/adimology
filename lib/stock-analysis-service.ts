import { buildComprehensiveAnalysis } from './analysis';
import { calculateTargets } from './calculations';
import { getLatestCompletedAgentStory, getRecentStockQueries } from './supabase';
import { fetchEmitenInfo, fetchHistoricalSummary, fetchKeyStats, fetchMarketDetector, fetchOrderbook, getBrokerSummary, getTopBroker, parseLot } from './stockbit';
import { calculateMarketRegime, calculateRelativeStrength } from './market-regime';
import type { HistoricalSummaryItem } from './stockbit';
import { completedDailyCandleAvailableAt, createPointInTimeContext, filterCompletedDailyCandles, validatePointInTimeSource, type PointInTimeContext, type SourceProvenance } from './point-in-time';

export async function analyzeSymbol(symbol: string, analysisDate: string, benchmarks: { stockHistory?: HistoricalSummaryItem[]; marketHistory?: HistoricalSummaryItem[]; sectorHistory?: HistoricalSummaryItem[]; pointInTimeContext?: PointInTimeContext } = {}) {
  const emiten = symbol.trim().toUpperCase();
  if (benchmarks.pointInTimeContext?.executionMode === 'historical_replay') throw new Error('HISTORICAL_SNAPSHOT_MISSING: replay memerlukan source_snapshots; endpoint live tidak dipanggil.');
  const start = new Date(`${analysisDate}T00:00:00Z`);
  // Keep the range within the historical-summary API's accepted window while
  // retaining enough observations for MA20/ATR and relative-strength inputs.
  start.setUTCDate(start.getUTCDate() - 60);
  const historyStart = start.toISOString().slice(0, 10);
  const detectorStartDate = new Date(`${analysisDate}T00:00:00Z`);
  detectorStartDate.setUTCDate(detectorStartDate.getUTCDate() - 28);
  const detectorStart = detectorStartDate.toISOString().slice(0, 10);
  const [detector, orderbookResponse, info, history, keyStats, fetchedBenchmark, brokerHistory, catalyst] = await Promise.all([
    fetchMarketDetector(emiten, detectorStart, analysisDate),
    fetchOrderbook(emiten),
    fetchEmitenInfo(emiten).catch(() => null),
    benchmarks.stockHistory ? Promise.resolve(benchmarks.stockHistory) : fetchHistoricalSummary(emiten, historyStart, analysisDate, 45).catch(() => []),
    fetchKeyStats(emiten).catch(() => undefined),
    benchmarks.marketHistory ? Promise.resolve(benchmarks.marketHistory) : fetchHistoricalSummary('COMPOSITE', historyStart, analysisDate, 45).catch(() => []),
    getRecentStockQueries(emiten).catch(() => []),
    getLatestCompletedAgentStory(emiten).catch(() => null),
  ]);
  const fetchedAt = new Date().toISOString();
  const context = createPointInTimeContext({ analysisDate, screenedAt: benchmarks.pointInTimeContext?.screenedAt ?? fetchedAt, informationCutoffAt: fetchedAt, executionMode: benchmarks.pointInTimeContext?.executionMode ?? 'live' });
  const makeSource = (dataType: SourceProvenance['dataType'], values: Partial<SourceProvenance> = {}): SourceProvenance => {
    const draft: SourceProvenance = { source: 'stockbit', dataType, symbol: emiten, observedAt: fetchedAt, effectiveAt: fetchedAt, publishedAt: null, fetchedAt, availableAt: fetchedAt, isHistoricalSnapshot: false, providerReference: null, rawSnapshotId: null, temporalValidity: 'valid', ...values };
    draft.temporalValidity = validatePointInTimeSource(draft, context).status;
    return draft;
  };
  const topBroker = getTopBroker(detector);
  const brokerSummary = getBrokerSummary(detector);
  const raw = orderbookResponse.data || (orderbookResponse as never);
  const ob = raw as typeof orderbookResponse.data;
  if (!ob?.total_bid_offer || ob.close === undefined) throw new Error('Struktur orderbook tidak valid');
  const toLevel = (row: { price: string; volume: string; que_num: string; change_percentage: string }) => ({ price: Number(row.price), volume: parseLot(row.volume), queues: parseLot(row.que_num), changePercentage: Number(row.change_percentage || 0) });
  const orderbook = { bid: (ob.bid ?? []).slice(0, 10).map(toLevel), offer: (ob.offer ?? []).slice(0, 10).map(toLevel) };
  const lastPrice = Number(ob.close);
  // The top-buyer list can be empty even when price/orderbook/technical feeds are
  // valid. Keep legacy target fields safe without dropping the stock entirely.
  const brokerData = topBroker ?? { bandar: '-', barangBandar: 0, rataRataBandar: lastPrice };
  const offerPrices = (ob.offer ?? []).map((row) => Number(row.price));
  const bidPrices = (ob.bid ?? []).map((row) => Number(row.price));
  const ara = Number(ob.ara?.value ?? ob.ara) > lastPrice ? Number(ob.ara?.value ?? ob.ara) : Math.max(...offerPrices, Number(ob.high || 0));
  const arbRaw = Number(ob.arb?.value ?? ob.arb);
  const arb = arbRaw > 0 && arbRaw < lastPrice ? arbRaw : bidPrices.length ? Math.min(...bidPrices) : 0;
  const totalBid = parseLot(ob.total_bid_offer.bid.lot);
  const totalOffer = parseLot(ob.total_bid_offer.offer.lot);
  const targets = calculateTargets(brokerData.rataRataBandar, brokerData.barangBandar, ara, arb, totalBid / 100, totalOffer / 100, lastPrice);
  // Enforce the requested as-of date even if an upstream feed returns newer rows.
  const asOfHistory = filterCompletedDailyCandles(history, context);
  const asOfMarket = filterCompletedDailyCandles(fetchedBenchmark, context);
  const asOfSector = benchmarks.sectorHistory ? filterCompletedDailyCandles(benchmarks.sectorHistory, context) : undefined;
  const historyLast = asOfHistory.at(-1)?.date ?? null;
  const benchmarkLast = asOfMarket.at(-1)?.date ?? null;
  const sourceProvenance: SourceProvenance[] = [
    makeSource('historical_price', { observedAt: historyLast ? completedDailyCandleAvailableAt(historyLast) : null, effectiveAt: historyLast ? `${historyLast}T16:00:00+07:00` : null, availableAt: historyLast ? completedDailyCandleAvailableAt(historyLast) : null, isHistoricalSnapshot: true }),
    makeSource('benchmark', { symbol: 'COMPOSITE', observedAt: benchmarkLast ? completedDailyCandleAvailableAt(benchmarkLast) : null, effectiveAt: benchmarkLast ? `${benchmarkLast}T16:00:00+07:00` : null, availableAt: benchmarkLast ? completedDailyCandleAvailableAt(benchmarkLast) : null, isHistoricalSnapshot: true }),
    makeSource('orderbook'), makeSource('market_price'),
    makeSource('broker_summary', { periodStart: `${detectorStart}T00:00:00+07:00`, periodEnd: `${analysisDate}T16:00:00+07:00` }),
    makeSource('fundamental', { effectiveAt: null, availableAt: null, observedAt: null }),
    makeSource('ai_story', { source: 'database', observedAt: catalyst?.created_at ?? null, effectiveAt: null, availableAt: catalyst?.created_at ?? null }),
    makeSource('emiten_info'),
  ];
  const valid = (type: SourceProvenance['dataType']) => sourceProvenance.find((item) => item.dataType === type)?.temporalValidity === 'valid';
  const marketRegime = calculateMarketRegime(asOfMarket);
  const relativeStrength = calculateRelativeStrength(asOfHistory, asOfMarket, asOfSector);
  const analysis = buildComprehensiveAnalysis({ brokerSummary: valid('broker_summary') ? brokerSummary : undefined, orderbook: valid('orderbook') ? orderbook : undefined, lastPrice, history: valid('historical_price') ? asOfHistory : [], keyStats: valid('fundamental') ? keyStats : undefined, benchmarkHistory: valid('benchmark') ? asOfMarket : [], brokerHistory, catalyst: valid('ai_story') ? catalyst : null, sourceTimestamps: { orderbook: fetchedAt, marketPrice: fetchedAt, brokerSummary: fetchedAt, historicalPrice: historyLast ? completedDailyCandleAvailableAt(historyLast) : null, benchmark: benchmarkLast ? completedDailyCandleAvailableAt(benchmarkLast) : null } });
  analysis.marketRegime = marketRegime;
  analysis.relativeStrength = relativeStrength;
  return { symbol: emiten, sector: info?.data?.sector, brokerData, brokerSummary, orderbook, history: asOfHistory, lastPrice, ara, arb, totalBid, totalOffer, targets, analysis, catalyst, marketRegime, relativeStrength, pointInTimeContext: context, sourceProvenance };
}
