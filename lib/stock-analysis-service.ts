import { buildComprehensiveAnalysis } from './analysis';
import { calculateTargets } from './calculations';
import { getLatestCompletedAgentStory, getRecentStockQueries } from './supabase';
import { fetchEmitenInfo, fetchHistoricalSummary, fetchKeyStats, fetchMarketDetector, fetchOrderbook, getBrokerSummary, getTopBroker, parseLot } from './stockbit';
import { calculateMarketRegime, calculateRelativeStrength } from './market-regime';
import type { HistoricalSummaryItem } from './stockbit';

export async function analyzeSymbol(symbol: string, analysisDate: string, benchmarks: { marketHistory?: HistoricalSummaryItem[]; sectorHistory?: HistoricalSummaryItem[] } = {}) {
  const emiten = symbol.trim().toUpperCase();
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
    fetchHistoricalSummary(emiten, historyStart, analysisDate, 100).catch(() => []),
    fetchKeyStats(emiten).catch(() => undefined),
    benchmarks.marketHistory ? Promise.resolve(benchmarks.marketHistory) : fetchHistoricalSummary('COMPOSITE', historyStart, analysisDate, 100).catch(() => []),
    getRecentStockQueries(emiten).catch(() => []),
    getLatestCompletedAgentStory(emiten).catch(() => null),
  ]);
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
  const asOfHistory = history.filter((row) => row.date <= analysisDate);
  const asOfMarket = fetchedBenchmark.filter((row) => row.date <= analysisDate);
  const asOfSector = benchmarks.sectorHistory?.filter((row) => row.date <= analysisDate);
  const marketRegime = calculateMarketRegime(asOfMarket);
  const relativeStrength = calculateRelativeStrength(asOfHistory, asOfMarket, asOfSector);
  const analysis = buildComprehensiveAnalysis({ brokerSummary, orderbook, lastPrice, history: asOfHistory, keyStats, benchmarkHistory: asOfMarket, brokerHistory, catalyst });
  analysis.marketRegime = marketRegime;
  analysis.relativeStrength = relativeStrength;
  return { symbol: emiten, sector: info?.data?.sector, brokerData, brokerSummary, orderbook, history: asOfHistory, lastPrice, ara, arb, totalBid, totalOffer, targets, analysis, catalyst, marketRegime, relativeStrength };
}
