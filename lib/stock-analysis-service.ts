import { providerPriceLimit } from './provider-http';
import { buildComprehensiveAnalysis } from './analysis';
import { calculateTargets } from './calculations';
import { getLatestCompletedAgentStory, getRecentStockQueries } from './supabase';
import { fetchEmitenInfo, fetchHistoricalSummary, fetchKeyStats, fetchMarketDetector, fetchOrderbook, getBrokerSummary, getTopBroker, parseLot } from './stockbit';
import { calculateMarketRegime, calculateRelativeStrength } from './market-regime';
import type { HistoricalSummaryItem } from './stockbit';
import { completedDailyCandleAvailableAt, createPointInTimeContext, filterCompletedDailyCandles, validatePointInTimeSource, type PointInTimeContext, type SourceProvenance } from './point-in-time';
import { marketCapFromKeyStats } from './idx-screener-adapter';

export async function analyzeSymbol(symbol: string, analysisDate: string, benchmarks: { stockHistory?: HistoricalSummaryItem[]; marketHistory?: HistoricalSummaryItem[]; sectorHistory?: HistoricalSummaryItem[]; pointInTimeContext?: PointInTimeContext; fixedInformationCutoffAt?: string } = {}) {
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
  const context = createPointInTimeContext({ analysisDate, screenedAt: benchmarks.pointInTimeContext?.screenedAt ?? fetchedAt, informationCutoffAt: benchmarks.fixedInformationCutoffAt ?? fetchedAt, executionMode: benchmarks.pointInTimeContext?.executionMode ?? 'live' });
  const makeSource = (dataType: SourceProvenance['dataType'], values: Partial<SourceProvenance> = {}): SourceProvenance => {
    const draft: SourceProvenance = { source: 'stockbit', dataType, symbol: emiten, observedAt: null, effectiveAt: null, publishedAt: null, fetchedAt, availableAt: fetchedAt, isHistoricalSnapshot: false, providerReference: null, rawSnapshotId: null, temporalValidity: 'valid', ...values };
    draft.temporalValidity = validatePointInTimeSource(draft, context).status;
    return draft;
  };
  const topBroker = getTopBroker(detector);
  const brokerSummary = detector?.data?.bandar_detector ? getBrokerSummary(detector) : undefined;
  const raw = orderbookResponse.data || (orderbookResponse as never);
  const ob = raw as typeof orderbookResponse.data;
  if (!ob?.total_bid_offer?.bid || !ob.total_bid_offer.offer || !Number.isFinite(Number(ob.close)) || Number(ob.close) <= 0 || !Array.isArray(ob.bid) || !Array.isArray(ob.offer)) throw new Error('Struktur orderbook tidak valid');
  // Stockbit's orderbook volume is expressed in lots. Internally all depth is
  // normalized to shares so notional/slippage calculations cannot mix units.
  const toLevel = (row: { price: string; volume: string; que_num: string; change_percentage: string }) => ({ price: Number(row.price), volume: parseLot(row.volume) * 100, queues: parseLot(row.que_num), changePercentage: Number(row.change_percentage || 0) });
  const providerObservedAt = [ob.observed_at, ob.timestamp].find(value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value))) ?? null;
  const orderbook = { bid: (ob.bid ?? []).slice(0, 10).map(toLevel), offer: (ob.offer ?? []).slice(0, 10).map(toLevel), observedAt: providerObservedAt, volumeUnit: 'shares' as const };
  const lastPrice = Number(ob.close);
  // The top-buyer list can be empty even when price/orderbook/technical feeds are
  // valid. Keep legacy target fields safe without dropping the stock entirely.
  const brokerData = topBroker ?? { bandar: '-', barangBandar: 0, rataRataBandar: lastPrice };
  // Provider-labelled price limits only. Official per-session ARA evidence is a
  // separate contract; high/offer levels can never substitute for missing limits.
  const ara = providerPriceLimit(ob.ara);
  const arb = providerPriceLimit(ob.arb);
  const totalBid = parseLot(ob.total_bid_offer.bid.lot);
  const totalOffer = parseLot(ob.total_bid_offer.offer.lot);
  const targets = calculateTargets(brokerData.rataRataBandar, brokerData.barangBandar, ara, arb, totalBid / 100, totalOffer / 100, lastPrice);
  // Enforce the requested as-of date even if an upstream feed returns newer rows.
  const asOfHistory = filterCompletedDailyCandles(history, context);
  const asOfMarket = filterCompletedDailyCandles(fetchedBenchmark, context);
  const asOfSector = benchmarks.sectorHistory ? filterCompletedDailyCandles(benchmarks.sectorHistory, context) : undefined;
  // Provider ordering is not part of its contract. Never use `at(-1)` as a
  // freshness timestamp without sorting, otherwise the oldest candle can make
  // every symbol look stale.
  const latestDate = (rows: HistoricalSummaryItem[]) => rows.reduce<string | null>((latest, row) => !latest || row.date > latest ? row.date : latest, null);
  const historyLast = latestDate(asOfHistory);
  const benchmarkLast = latestDate(asOfMarket);
  const sourceProvenance: SourceProvenance[] = [
    makeSource('historical_price', { observedAt: historyLast ? completedDailyCandleAvailableAt(historyLast) : null, effectiveAt: historyLast ? `${historyLast}T16:00:00+07:00` : null, availableAt: historyLast ? fetchedAt : null, isHistoricalSnapshot: false }),
    makeSource('benchmark', { symbol: 'COMPOSITE', observedAt: benchmarkLast ? completedDailyCandleAvailableAt(benchmarkLast) : null, effectiveAt: benchmarkLast ? `${benchmarkLast}T16:00:00+07:00` : null, availableAt: benchmarkLast ? fetchedAt : null, isHistoricalSnapshot: false }),
    makeSource('orderbook', { observedAt: providerObservedAt }), makeSource('market_price', { observedAt: providerObservedAt }),
    makeSource('broker_summary', { periodStart: `${detectorStart}T00:00:00+07:00`, periodEnd: `${analysisDate}T16:00:00+07:00` }),
    makeSource('fundamental', { effectiveAt: null, availableAt: null, observedAt: null }),
    makeSource('ai_story', { source: 'database', observedAt: catalyst?.created_at ?? null, effectiveAt: null, availableAt: catalyst?.created_at ?? null }),
    makeSource('emiten_info'),
  ];
  const valid = (type: SourceProvenance['dataType']) => sourceProvenance.find((item) => item.dataType === type)?.temporalValidity === 'valid';
  const marketCap = valid('fundamental') ? marketCapFromKeyStats(keyStats) : null;
  const marketRegime = calculateMarketRegime(asOfMarket);
  const relativeStrength = calculateRelativeStrength(asOfHistory, asOfMarket, asOfSector);
  const analysis = buildComprehensiveAnalysis({ now: new Date(context.informationCutoffAt), informationCutoffAt: context.informationCutoffAt, brokerSummary: valid('broker_summary') ? brokerSummary : undefined, orderbook: valid('orderbook') ? orderbook : undefined, lastPrice, history: valid('historical_price') ? asOfHistory : [], keyStats: valid('fundamental') ? keyStats : undefined, benchmarkHistory: valid('benchmark') ? asOfMarket : [], brokerHistory: brokerHistory.filter(row => row.from_date <= analysisDate && row.to_date === row.from_date && typeof row.created_at === 'string' && Date.parse(row.created_at) <= Date.parse(context.informationCutoffAt) && Date.parse(completedDailyCandleAvailableAt(row.to_date)) <= Date.parse(context.informationCutoffAt)), sector: info?.data?.sector, ara, arb, catalyst: valid('ai_story') ? catalyst : null, sourceTimestamps: { orderbook: providerObservedAt, marketPrice: providerObservedAt, brokerSummary: fetchedAt, historicalPrice: historyLast ? completedDailyCandleAvailableAt(historyLast) : null, benchmark: benchmarkLast ? completedDailyCandleAvailableAt(benchmarkLast) : null } });
  analysis.marketRegime = marketRegime;
  analysis.relativeStrength = relativeStrength;
  return { symbol: emiten, sector: info?.data?.sector, marketCap, brokerData, brokerSummary, orderbook, history: asOfHistory, lastPrice, ara, arb, totalBid, totalOffer, targets, analysis, catalyst, marketRegime, relativeStrength, pointInTimeContext: context, sourceProvenance };
}
