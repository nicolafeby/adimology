import type { HistoricalSummaryItem } from './stockbit';
import type { OrderbookSnapshot } from './types';
import { BROKER_FLOW_POLICY, LIQUIDITY_POLICY, SECTOR_PEER_POLICY } from './screener-factor-config';

const clamp = (v: number, lo = 0, hi = 100) => Math.min(hi, Math.max(lo, v));
const round = (v: number, d = 2) => Math.round(v * 10 ** d) / 10 ** d;
const median = (xs: number[]) => { const a = [...xs].sort((x, y) => x - y); return a.length ? (a[Math.floor((a.length - 1) / 2)] + a[Math.floor(a.length / 2)]) / 2 : null; };

export interface ExecutionScenario { notional: number; requestedLots: number; estimatedBuySlippagePercent: number | null; estimatedSellSlippagePercent: number | null; averageDailyValueParticipationPercent: number | null; medianDailyValueParticipationPercent: number | null; depthCoveragePercent: number; executionStatus: 'acceptable' | 'high_impact' | 'insufficient_depth' | 'invalid_book' | 'stale'; warnings: string[] }
export interface ExecutionAssessment { available: boolean; score: number | null; spreadPercent: number | null; nearTouchImbalancePercent: number | null; observedAt: string | null; bookStatus: 'normal' | 'locked' | 'crossed' | 'empty' | 'stale' | 'limit_locked'; averageDailyValue20d: number | null; medianDailyValue20d: number | null; zeroVolumeDays: number; scenarios: ExecutionScenario[]; warnings: string[]; methodologyVersion: string }

function walk(levels: OrderbookSnapshot['bid'], shares: number, reference: number) {
  let remaining = shares, value = 0;
  for (const level of levels) { const take = Math.min(remaining, Math.max(0, level.volume)); value += take * level.price; remaining -= take; if (!remaining) break; }
  if (remaining > 0 || shares <= 0 || reference <= 0) return { slippage: null, coverage: shares > 0 ? round((shares - remaining) / shares * 100) : 0 };
  return { slippage: round(Math.abs(value / shares / reference - 1) * 100), coverage: 100 };
}

export function assessExecution(input: { orderbook?: OrderbookSnapshot; history?: HistoricalSummaryItem[]; lastPrice: number; observedAt?: string | null; now?: Date; ara?: number | null; arb?: number | null; notionals?: readonly number[] }): ExecutionAssessment {
  const warnings: string[] = [], observedAt = input.observedAt ?? null;
  const rows = [...(input.history ?? [])].filter(r => r.close > 0).sort((a, b) => a.date.localeCompare(b.date)).slice(-LIQUIDITY_POLICY.historySessions);
  const values = rows.map(r => Number(r.value) > 0 ? Number(r.value) : r.close * Math.max(0, r.volume));
  const average = values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
  const med = median(values);
  const zeroVolumeDays = rows.filter(r => r.volume <= 0 || (r.value ?? 0) <= 0).length;
  const bids = [...(input.orderbook?.bid ?? [])].filter(x => x.price > 0 && x.volume > 0).sort((a, b) => b.price - a.price);
  const offers = [...(input.orderbook?.offer ?? [])].filter(x => x.price > 0 && x.volume > 0).sort((a, b) => a.price - b.price);
  if (!bids.length || !offers.length) return { available: false, score: null, spreadPercent: null, nearTouchImbalancePercent: null, observedAt, bookStatus: 'empty', averageDailyValue20d: average, medianDailyValue20d: med, zeroVolumeDays, scenarios: [], warnings: ['Orderbook dua sisi tidak tersedia.'], methodologyVersion: LIQUIDITY_POLICY.version };
  const bid = bids[0].price, offer = offers[0].price, mid = (bid + offer) / 2;
  let bookStatus: ExecutionAssessment['bookStatus'] = bid === offer ? 'locked' : bid > offer ? 'crossed' : 'normal';
  if ((input.ara && bid >= input.ara) || (input.arb && offer <= input.arb)) bookStatus = 'limit_locked';
  const age = observedAt ? ((input.now ?? new Date()).getTime() - new Date(observedAt).getTime()) / 60_000 : Infinity;
  if (!Number.isFinite(age) || age > LIQUIDITY_POLICY.maximumOrderbookAgeMinutes) bookStatus = 'stale';
  if (bookStatus !== 'normal') warnings.push(`Orderbook ${bookStatus}; tidak execution-ready.`);
  const spread = mid > 0 ? round((offer - bid) / mid * 100) : null;
  const nearBid = bids.filter(x => x.price >= bid * .99).reduce((s, x) => s + x.volume, 0), nearOffer = offers.filter(x => x.price <= offer * 1.01).reduce((s, x) => s + x.volume, 0);
  const imbalance = nearBid + nearOffer ? round((nearBid - nearOffer) / (nearBid + nearOffer) * 100) : null;
  const scenarios = (input.notionals ?? LIQUIDITY_POLICY.referenceNotionalsIdr).map(notional => {
    const lots = Math.max(1, Math.ceil(notional / (offer * LIQUIDITY_POLICY.lotSizeShares))), shares = lots * LIQUIDITY_POLICY.lotSizeShares;
    const buy = walk(offers, shares, offer), sell = walk(bids, shares, bid), coverage = Math.min(buy.coverage, sell.coverage);
    const participation = average && average > 0 ? round(notional / average * 100) : null, medianParticipation = med && med > 0 ? round(notional / med * 100) : null;
    const ws: string[] = [];
    let status: ExecutionScenario['executionStatus'] = bookStatus === 'stale' ? 'stale' : bookStatus !== 'normal' ? 'invalid_book' : coverage < 100 ? 'insufficient_depth' : 'acceptable';
    if (coverage < 100) ws.push('Depth beli atau jual tidak cukup; slippage parsial tidak dilaporkan.');
    if ((participation ?? Infinity) > LIQUIDITY_POLICY.maximumParticipationPercent || (medianParticipation ?? Infinity) > LIQUIDITY_POLICY.maximumParticipationPercent || (buy.slippage ?? Infinity) > LIQUIDITY_POLICY.maximumSlippagePercentPerSide || (sell.slippage ?? Infinity) > LIQUIDITY_POLICY.maximumSlippagePercentPerSide) { if (status === 'acceptable') status = 'high_impact'; ws.push('Ukuran posisi melampaui batas impact konservatif.'); }
    return { notional, requestedLots: lots, estimatedBuySlippagePercent: buy.slippage, estimatedSellSlippagePercent: sell.slippage, averageDailyValueParticipationPercent: participation, medianDailyValueParticipationPercent: medianParticipation, depthCoveragePercent: coverage, executionStatus: status, warnings: ws };
  });
  const reference = scenarios.find(s => s.notional === 50_000_000) ?? scenarios[0];
  const score = bookStatus !== 'normal' || spread === null ? null : round(clamp(100 - spread * 20 - (reference?.estimatedBuySlippagePercent ?? 3) * 10 - (reference?.estimatedSellSlippagePercent ?? 3) * 10 - zeroVolumeDays * 3));
  return { available: score !== null, score, spreadPercent: spread, nearTouchImbalancePercent: imbalance, observedAt, bookStatus, averageDailyValue20d: average === null ? null : round(average), medianDailyValue20d: med === null ? null : round(med), zeroVolumeDays, scenarios, warnings, methodologyVersion: LIQUIDITY_POLICY.version };
}

export interface BrokerSession { date: string; broker?: string | null; netValue?: number | null; averagePrice?: number | null; tradedValue?: number | null }
export function assessBrokerPersistence(input: BrokerSession[]) {
  const byDate = new Map<string, BrokerSession>();
  for (const r of [...input].sort((a, b) => a.date.localeCompare(b.date))) if (r.date) byDate.set(r.date, r);
  const rows = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)).slice(-20), sampleSize = rows.length;
  if (sampleSize < BROKER_FLOW_POLICY.minimumSessions) return { available: false, score: null, sampleSize, missingSessions: Math.max(0, 20 - sampleSize), accumulationSessions: { d5: null, d10: null, d20: null }, persistence: null, acceleration: null, dominantBrokerConsistency: null, warnings: ['Sampel broker di bawah minimum.'], methodologyVersion: BROKER_FLOW_POLICY.version };
  const net = rows.map(r => typeof r.netValue === 'number' && Number.isFinite(r.netValue) ? r.netValue : 0), counts = (n: number) => net.slice(-n).filter(v => v > 0).length;
  const brokers = rows.map(r => r.broker).filter(Boolean) as string[], dominant = brokers.length ? [...new Set(brokers)].sort((a,b) => brokers.filter(x=>x===b).length-brokers.filter(x=>x===a).length)[0] : null;
  const consistency = dominant ? brokers.filter(x => x === dominant).length / rows.length : null;
  const recent = net.slice(-5).reduce((a,b)=>a+b,0)/Math.min(5,net.length), priorRows = net.slice(-10,-5), prior = priorRows.length ? priorRows.reduce((a,b)=>a+b,0)/priorRows.length : null;
  const persistence = counts(Math.min(10, sampleSize)) / Math.min(10, sampleSize), acceleration = prior === null ? null : recent - prior;
  const score = round(clamp(35 + persistence * 45 + (consistency ?? 0) * 20));
  return { available: true, score, sampleSize, missingSessions: Math.max(0, 20 - sampleSize), accumulationSessions: { d5: counts(5), d10: counts(10), d20: counts(20) }, persistence: round(persistence * 100), acceleration: acceleration === null ? null : round(acceleration), dominantBrokerConsistency: consistency === null ? null : round(consistency * 100), warnings: sampleSize < BROKER_FLOW_POLICY.reliableSessions ? ['Broker persistence tersedia dengan reliability rendah.'] : [], methodologyVersion: BROKER_FLOW_POLICY.version };
}

export type PeerMetric = 'roe' | 'netMargin' | 'revenueGrowth' | 'earningsGrowth' | 'debtToEquity' | 'per' | 'pbv' | 'dividendYield' | 'operatingCashFlow';
export interface PeerObservation { symbol: string; sector?: string | null; subsector?: string | null; compatibleIndustry?: string | null; availableAt: string; metrics: Partial<Record<PeerMetric, number | null>> }
export function sectorRelativeMetric(input: { symbol: string; metric: PeerMetric; value: number | null; sector?: string | null; subsector?: string | null; compatibleIndustry?: string | null; cutoff: string; peers: PeerObservation[]; lowerIsBetter?: boolean }) {
  if (input.value === null || !Number.isFinite(input.value) || (input.metric === 'per' && input.value <= 0)) return { available: false, score: null, percentile: null, peerSampleSize: 0, benchmarkScope: null, fallbackLevel: 'unavailable' as const, median: null, mad: null, warnings: [input.metric === 'per' && (input.value ?? 1) <= 0 ? 'PER negatif bukan valuasi murah.' : 'Nilai tidak tersedia.'], methodologyVersion: SECTOR_PEER_POLICY.version };
  const eligible = input.peers.filter(p => p.symbol !== input.symbol && new Date(p.availableAt).getTime() <= new Date(input.cutoff).getTime());
  const levels = [['subsector', (p: PeerObservation) => Boolean(input.subsector && p.subsector === input.subsector)], ['sector', (p: PeerObservation) => Boolean(input.sector && p.sector === input.sector)], ['compatible_industry', (p: PeerObservation) => Boolean(input.compatibleIndustry && p.compatibleIndustry === input.compatibleIndustry)], ['market', () => true]] as const;
  for (const [level, predicate] of levels) {
    const values = eligible.filter(predicate).map(p => p.metrics[input.metric]).filter((v): v is number => typeof v === 'number' && Number.isFinite(v) && !(input.metric === 'per' && v <= 0));
    if (values.length < SECTOR_PEER_POLICY.minimumPeerSample) continue;
    const sorted = [...values].sort((a,b)=>a-b), lo = sorted[Math.floor((sorted.length-1)*.05)], hi = sorted[Math.ceil((sorted.length-1)*.95)], winsor = sorted.map(v=>Math.min(hi,Math.max(lo,v))), med = median(winsor)!;
    const mad = median(winsor.map(v=>Math.abs(v-med)))!;
    const below = winsor.filter(v=>v<input.value!).length, equal = winsor.filter(v=>v===input.value).length, percentile = (below + equal*.5) / winsor.length * 100;
    const score = input.lowerIsBetter ? 100-percentile : percentile;
    return { available: true, score: round(score), percentile: round(percentile), peerSampleSize: values.length, benchmarkScope: level === 'market' ? 'IDX market' : (level === 'sector' ? input.sector : level === 'subsector' ? input.subsector : input.compatibleIndustry) ?? level, fallbackLevel: level, median: round(med), mad: round(mad), warnings: level === 'subsector' ? [] : [`Fallback peer: ${level}.`], methodologyVersion: SECTOR_PEER_POLICY.version };
  }
  return { available: false, score: null, percentile: null, peerSampleSize: 0, benchmarkScope: null, fallbackLevel: 'unavailable' as const, median: null, mad: null, warnings: ['Peer point-in-time tidak mencapai minimum sample.'], methodologyVersion: SECTOR_PEER_POLICY.version };
}

export function sectorFamily(sector?: string | null) { const s=(sector??'').toLowerCase(); return SECTOR_PEER_POLICY.sectorFamilies.financials.some(x=>s.includes(x)) ? 'financials' : 'general'; }
