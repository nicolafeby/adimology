import { getFraksi } from './calculations';
import type { ComprehensiveAnalysis, MarketRegimeLabel, PositionSizingOptions, StockAnalysisResult, TradingDecision, TrendSignal } from './types';
import { calculateAtrStop, calculatePositionSize, DEFAULT_ATR_MULTIPLIER, roundDownToValidTick, roundUpToValidTick } from './risk-management';

export const DECISION_MODEL_VERSION = 'decision-card-v1';
export const DECISION_THRESHOLDS = Object.freeze({ atrMultiplier: 1.5, maxRiskPercent: 8, minRr1Buy: 1.5, minRr2Adequate: 2, minCompleteness: 60, maxSpreadPercent: 1.5, severeSpreadPercent: 3, minLiquidityScore: 45, maxTargetDistanceAtr: 6, maxTarget1Percent: 12, maxTarget2Percent: 20, minMicrostructureVolatilityPercent: 1.5, validTradingSessions: 5, orderbookFreshMinutes: 20 });
const LOT_SIZE = 100;
export const DEFAULT_POSITION_SIZING: Readonly<PositionSizingOptions> = {};

export function roundIdxPrice(value: number | null, mode: 'down' | 'up' | 'nearest' = 'nearest'): number | null {
  if (value === null || !Number.isFinite(value) || value <= 0) return null;
  if (mode === 'down') return roundDownToValidTick(value);
  if (mode === 'up') return roundUpToValidTick(value);
  let rounded = value;
  for (let i = 0; i < 2; i++) { const tick = getFraksi(rounded); rounded = Math.round(value / tick) * tick; }
  return Math.max(getFraksi(rounded), rounded);
}
const finite = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) ? value : null;
const metric = (a: ComprehensiveAnalysis, key: string) => finite(a.components.flatMap((x) => x.metrics).find((x) => x.key === key)?.value);
const componentScore = (a: ComprehensiveAnalysis, key: string) => finite(a.components.find((x) => x.key === key)?.score);
const pct = (v: number) => Math.round(v * 100) / 100;
const ratio = (reward: number | null, risk: number | null) => reward !== null && risk !== null && reward > 0 && risk > 0 ? Math.round(reward / risk * 100) / 100 : null;

export interface DecisionInput {
  currentPrice: number | null; bestBid: number | null; bestOffer: number | null;
  targetRealistic: number | null; targetMaximum: number | null; ara: number | null;
  atrPercent: number | null; fallbackVolatilityPercent?: number | null; priceVsSma20Percent: number | null; relativeVolume: number | null;
  liquidityScore: number | null; brokerFlowScore: number | null; signal: TrendSignal;
  marketRegime: MarketRegimeLabel; marketGateBlocked: boolean; hardRiskFlags: string[];
  dataWarnings?: string[];
  historicalSnapshot?: boolean;
  confidence: number; dataCompleteness: number; generatedAt?: string; orderbookGeneratedAt?: string;
  aiStoryGeneratedAt?: string | null; sizing?: PositionSizingOptions; now?: Date;
  atrValue?: number | null; averageDailyVolumeShares?: number | null;
}

/** Pure deterministic calculation; catalyst/AI text is never used for numeric levels. */
export function calculateTradingDecision(input: DecisionInput): TradingDecision {
  const now = input.now ?? new Date();
  const generatedAt = input.generatedAt && Number.isFinite(new Date(input.generatedAt).getTime()) ? new Date(input.generatedAt).toISOString() : now.toISOString();
  const ageMinutes = Math.max(0, (now.getTime() - new Date(generatedAt).getTime()) / 60_000);
  const orderbookAge = input.orderbookGeneratedAt ? Math.max(0, (now.getTime() - new Date(input.orderbookGeneratedAt).getTime()) / 60_000) : ageMinutes;
  const aiStoryFresh = input.aiStoryGeneratedAt == null ? null : now.getTime() - new Date(input.aiStoryGeneratedAt).getTime() <= 86_400_000;
  const current = finite(input.currentPrice), bestBid = finite(input.bestBid), bestOffer = finite(input.bestOffer), atrPct = finite(input.atrPercent);
  const fallbackVolatilityPct = finite(input.fallbackVolatilityPercent);
  const orderbookFresh = Boolean(input.orderbookGeneratedAt) && bestBid !== null && bestOffer !== null && Number.isFinite(orderbookAge) && orderbookAge <= DECISION_THRESHOLDS.orderbookFreshMinutes;
  const executionDataStatus = orderbookFresh ? 'fresh' : input.historicalSnapshot ? 'historical_unavailable' : 'stale';
  const spreadPercent = bestBid !== null && bestOffer !== null && bestOffer >= bestBid ? (bestOffer - bestBid) / ((bestOffer + bestBid) / 2) * 100 : null;
  const tickPercent = current !== null && current > 0 ? getFraksi(current) / current * 100 : null;
  const microstructureVolatilityPct = bestBid !== null && bestOffer !== null
    ? Math.max(DECISION_THRESHOLDS.minMicrostructureVolatilityPercent, (spreadPercent ?? 0) * 3, (tickPercent ?? 0) * 4) : null;
  const effectiveVolatilityPct = atrPct !== null && atrPct > 0 ? atrPct : fallbackVolatilityPct !== null && fallbackVolatilityPct > 0 ? fallbackVolatilityPct : microstructureVolatilityPct;
  const volatilitySource = atrPct !== null && atrPct > 0 ? 'ATR' : fallbackVolatilityPct !== null && fallbackVolatilityPct > 0 ? 'volatilitas close-to-close' : microstructureVolatilityPct !== null ? 'struktur orderbook' : null;
  const suppliedAtrValue = finite(input.atrValue);
  const atrValue = suppliedAtrValue !== null && suppliedAtrValue > 0 ? suppliedAtrValue : current !== null && effectiveVolatilityPct !== null ? current * effectiveVolatilityPct / 100 : null;
  const sma20 = current !== null && input.priceVsSma20Percent !== null && input.priceVsSma20Percent > -99 ? current / (1 + input.priceVsSma20Percent / 100) : null;
  const anchor = sma20 ?? (atrValue !== null && current !== null ? current - atrValue * .75 : current);
  let lower = roundIdxPrice(anchor !== null && atrValue !== null ? anchor - atrValue * .25 : anchor, 'down');
  let upper = roundIdxPrice(anchor !== null && atrValue !== null ? anchor + atrValue * .25 : anchor, 'up');
  const reference = roundIdxPrice(input.signal === 'confirmed_uptrend' ? bestOffer ?? current : anchor, input.signal === 'confirmed_uptrend' ? 'up' : 'nearest');
  const rawTarget1 = finite(input.targetRealistic), rawTarget2 = finite(input.targetMaximum);
  const volatilityTarget1 = current !== null && effectiveVolatilityPct !== null ? current * (1 + Math.min(DECISION_THRESHOLDS.maxTarget1Percent, effectiveVolatilityPct * 3) / 100) : null;
  const volatilityTarget2 = current !== null && effectiveVolatilityPct !== null ? current * (1 + Math.min(DECISION_THRESHOLDS.maxTarget2Percent, effectiveVolatilityPct * 6) / 100) : null;
  const araCeiling = input.ara !== null && input.ara > 0 ? input.ara : Infinity;
  const target1Ceiling = Math.min(araCeiling, volatilityTarget1 ?? Infinity);
  const target2Ceiling = Math.min(araCeiling, volatilityTarget2 ?? Infinity);
  const target1Candidate = rawTarget1 !== null && current !== null && rawTarget1 > current ? Math.min(rawTarget1, target1Ceiling) : volatilityTarget1;
  const target1 = roundIdxPrice(target1Candidate, 'down');
  const target2Candidate = rawTarget2 !== null && target1 !== null && rawTarget2 >= target1 ? Math.min(rawTarget2, target2Ceiling) : volatilityTarget2 ?? target1;
  let target2 = roundIdxPrice(target2Candidate, 'down');
  if (target1 !== null && target2 !== null && target2 < target1) target2 = target1;
  if (target1 !== null && upper !== null && upper >= target1) upper = roundIdxPrice(target1 - getFraksi(target1), 'down');
  if (lower !== null && upper !== null && lower > upper) lower = upper;
  const supportStop = sma20 !== null ? sma20 - (atrValue ?? 0) * .25 : bestBid !== null && atrValue !== null ? bestBid - atrValue * .5 : null;
  const atrStopDetails = reference !== null && atrValue !== null && effectiveVolatilityPct !== null ? calculateAtrStop({ entryPrice: reference, atr: atrValue, atrPercent: effectiveVolatilityPct, multiplier: input.sizing?.atrMultiplier ?? DEFAULT_ATR_MULTIPLIER, structuralStop: supportStop }) : null;
  const stopPrice = atrStopDetails?.price ?? null;
  const risk = reference !== null && stopPrice !== null ? reference - stopPrice : null;
  const riskPercent = risk !== null && reference !== null && reference > 0 ? pct(risk / reference * 100) : null;
  const reward1 = target1 !== null && reference !== null ? target1 - reference : null;
  const reward2 = target2 !== null && reference !== null ? target2 - reference : null;
  const rr1 = ratio(reward1, risk), rr2 = ratio(reward2, risk);
  const requiredMissing = current === null || current <= 0 || reference === null || atrValue === null || target1 === null || target2 === null || stopPrice === null;
  const invalidLevels = risk === null || risk <= 0 || reward1 === null || reward1 <= 0 || reward2 === null || reward2 <= 0;
  const poorSpread = spreadPercent !== null && spreadPercent > DECISION_THRESHOLDS.maxSpreadPercent;
  const severeLiquidity = (spreadPercent !== null && spreadPercent > DECISION_THRESHOLDS.severeSpreadPercent) || (input.liquidityScore !== null && input.liquidityScore < DECISION_THRESHOLDS.minLiquidityScore);
  const tooRisky = riskPercent !== null && riskPercent > DECISION_THRESHOLDS.maxRiskPercent;
  const stale = executionDataStatus === 'stale', executionUnavailable = executionDataStatus === 'historical_unavailable';
  const pastTarget = current !== null && ((rawTarget1 !== null && rawTarget1 > 0 && current > rawTarget1) || (target1 !== null && current > target1));
  const targetTooFar = atrValue !== null && current !== null && target2 !== null && target2 - current > atrValue * DECISION_THRESHOLDS.maxTargetDistanceAtr;
  const warnings = [...input.hardRiskFlags, ...(input.dataWarnings ?? [])];
  if (input.signal === 'confirmed_uptrend' && bestOffer === null && current !== null) warnings.push('Best offer tidak tersedia; entry memakai last price sebagai fallback.');
  if (atrPct === null && fallbackVolatilityPct !== null) warnings.push('ATR OHLC tidak tersedia; stop memakai volatilitas close-to-close dari riwayat tersimpan.');
  if (atrPct === null && fallbackVolatilityPct === null && microstructureVolatilityPct !== null) warnings.push('Riwayat volatilitas tidak tersedia; stop konservatif memakai struktur best bid, spread, dan fraksi harga.');
  if (atrValue === null) warnings.push('ATR atau volatilitas historis tidak tersedia; stop-loss tidak dapat dihitung.');
  if (atrStopDetails) warnings.push(...atrStopDetails.warnings);
  if ((rawTarget1 !== null && rawTarget1 > target1Ceiling) || (rawTarget2 !== null && rawTarget2 > target2Ceiling)) warnings.push('Target formula broker-flow berada di luar envelope swing dan telah dibatasi ke level realistis.');
  if ((rawTarget1 !== null && current !== null && rawTarget1 <= current) || (rawTarget2 !== null && target1 !== null && rawTarget2 < target1)) warnings.push('Target formula broker-flow tidak valid terhadap harga eksekusi; target volatilitas digunakan sebagai pengganti.');
  if (bestBid === null || bestOffer === null) warnings.push(input.historicalSnapshot ? 'Snapshot historis tidak memiliki best bid/offer live; ARA/ARB tidak digunakan sebagai pengganti.' : 'Best bid/offer tidak tersedia; ARA/ARB tidak digunakan sebagai pengganti orderbook.');
  if (stale) warnings.push('Data orderbook kedaluwarsa; refresh diperlukan sebelum eksekusi.');
  if (poorSpread) warnings.push(`Spread ${pct(spreadPercent!)}% melewati batas ${DECISION_THRESHOLDS.maxSpreadPercent}%.`);
  if (tooRisky) warnings.push(`Jarak stop ${riskPercent}% melewati batas risiko ${DECISION_THRESHOLDS.maxRiskPercent}%.`);
  if (targetTooFar) warnings.push('Target maksimum jauh dibanding volatilitas saat ini dan perlu divalidasi ulang.');
  if (aiStoryFresh === false) warnings.push('AI Story kedaluwarsa; hanya konteks, bukan dasar angka keputusan.');
  let verdict: TradingDecision['verdict'] = 'watch';
  const positive = input.signal === 'confirmed_uptrend' || input.signal === 'early_uptrend';
  if (requiredMissing) verdict = 'insufficient_data';
  else if (input.signal === 'avoid' || input.marketGateBlocked || severeLiquidity || input.hardRiskFlags.length || pastTarget) verdict = 'avoid';
  else if (invalidLevels) verdict = 'insufficient_data';
  else if (positive && current! > upper!) verdict = 'wait_for_pullback';
  else if (tooRisky) verdict = 'wait_for_pullback';
  else if (executionUnavailable) verdict = 'watch';
  else if (!positive || input.dataCompleteness < DECISION_THRESHOLDS.minCompleteness || rr1 === null || rr1 < DECISION_THRESHOLDS.minRr1Buy) verdict = 'watch';
  else if (poorSpread || stale) verdict = 'wait_for_pullback';
  else if (input.signal === 'confirmed_uptrend' && current! >= lower! && current! <= upper!) verdict = 'buy_now';
  const reasons = [pastTarget ? 'Upside tersisa tidak memadai karena harga telah mencapai atau melewati target 1.' : verdict === 'buy_now' ? 'Sinyal terkonfirmasi, harga berada di zona entry, dan risk–reward memenuhi ambang.' : verdict === 'wait_for_pullback' ? 'Setup positif, tetapi entry saat ini tidak memenuhi harga, risiko, freshness, atau RR minimum.' : verdict === 'watch' ? 'Konfirmasi sinyal atau risk–reward belum memadai untuk rencana entry.' : verdict === 'avoid' ? (input.marketGateBlocked ? 'Market-regime gate memblokir setup.' : 'Negative gate mengalahkan bonus skor positif.') : 'Input wajib untuk entry, stop, dan target belum lengkap atau tidak valid.'];
  let positionSizing: TradingDecision['positionSizing'] = null;
  const accountSize = finite(input.sizing?.accountSize), availableCash = finite(input.sizing?.availableCash), maxRiskPct = finite(input.sizing?.riskPercent);
  if (accountSize !== null && availableCash !== null && maxRiskPct !== null && reference !== null && stopPrice !== null) {
    const liquidityPct = finite(input.sizing?.liquidityPercentOfAdv);
    const averageDailyVolumeShares = finite(input.averageDailyVolumeShares);
    const liquidityLimitLots = liquidityPct !== null && liquidityPct > 0 && averageDailyVolumeShares !== null ? Math.floor(averageDailyVolumeShares * liquidityPct / 100 / LOT_SIZE) : null;
    positionSizing = calculatePositionSize({ tradingCapital: accountSize, availableCash, maximumRiskPercent: maxRiskPct, entryPrice: reference, stopPrice, lotSize: LOT_SIZE, maxAllocationPercent: input.sizing?.maxAllocationPercent ?? 20, estimatedBuyFeePercent: input.sizing?.buyFeePercent ?? 0.15, estimatedSellFeePercent: input.sizing?.sellFeePercent ?? 0.25, liquidityLimitLots });
    if (positionSizing) warnings.push(...positionSizing.warnings);
  }
  const labels: Record<TradingDecision['verdict'], string> = { buy_now: 'BELI DI ZONA', wait_for_pullback: 'TUNGGU PULLBACK', watch: 'PANTAU', avoid: 'HINDARI', insufficient_data: 'DATA BELUM CUKUP' };
  return { verdict, verdictLabel: labels[verdict], entry: { lower, upper, reference, rationale: input.signal === 'confirmed_uptrend' ? 'Referensi memakai best offer; orderbook hanya konfirmasi minor.' : 'Zona pullback dibentuk di sekitar MA20/retracement volatilitas.' }, stop: { price: stopPrice, riskPercent, rationale: `Stop memakai struktur harga dan ${atrStopDetails?.multiplier ?? DEFAULT_ATR_MULTIPLIER}× ${volatilitySource ?? 'volatilitas'}.`, details: atrStopDetails }, targets: { target1, target2, rewardPercent1: reward1 !== null && reference ? pct(reward1 / reference * 100) : null, rewardPercent2: reward2 !== null && reference ? pct(reward2 / reference * 100) : null, rationale: 'Target lama divalidasi terhadap entry, envelope swing, ARA, volatilitas, dan fraksi IDX.' }, riskReward: { target1: rr1, target2: rr2 }, invalidations: [...(stopPrice === null ? [] : [{ kind: 'price' as const, condition: `Daily close di bawah Rp ${stopPrice.toLocaleString('id-ID')}.` }]), { kind: 'signal', condition: 'Broker flow menjadi distribusi, relative volume melemah, atau market regime menjadi bearish.' }, { kind: 'time', condition: `Zona entry tidak tersentuh dalam ${DECISION_THRESHOLDS.validTradingSessions} sesi perdagangan.` }], validUntil: { tradingSessions: DECISION_THRESHOLDS.validTradingSessions, date: null }, confidence: Math.max(0, Math.min(100, Math.round(input.confidence - warnings.length * 5))), dataCompleteness: input.dataCompleteness, reasons, warnings, generatedAt, modelVersion: DECISION_MODEL_VERSION, freshness: { dataAgeMinutes: Math.round(ageMinutes), orderbookFresh, aiStoryFresh, refreshRequired: stale, executionDataStatus }, inputs: { currentPrice: current, bestBid, bestOffer, spreadPercent: spreadPercent === null ? null : pct(spreadPercent), sma20: sma20 === null ? null : pct(sma20), atrPercent: atrPct, atrValue, fallbackVolatilityPercent: fallbackVolatilityPct, effectiveVolatilityPercent: effectiveVolatilityPct, volatilitySource, relativeVolume: input.relativeVolume, signal: input.signal, marketRegime: input.marketRegime, marketGateBlocked: input.marketGateBlocked, liquidityScore: input.liquidityScore, brokerFlowScore: input.brokerFlowScore, targetRealistic: rawTarget1, targetMaximum: rawTarget2 }, thresholds: { ...DECISION_THRESHOLDS }, atrPercent: atrPct, positionSizing };
}

export function buildTradeDecision(result: StockAnalysisResult, sizing: PositionSizingOptions = {}): TradingDecision {
  const a = result.comprehensiveAnalysis, context = result.decisionContext;
  const bestBid = finite(context?.bestBid) ?? result.orderbook?.bid.filter((x) => x.price > 0).reduce<number | null>((v, x) => v === null ? x.price : Math.max(v, x.price), null) ?? null;
  const bestOffer = finite(context?.bestOffer) ?? result.orderbook?.offer.filter((x) => x.price > 0).reduce<number | null>((v, x) => v === null ? x.price : Math.min(v, x.price), null) ?? null;
  return calculateTradingDecision({ currentPrice: finite(context?.executionPrice) ?? finite(result.marketData.harga), bestBid, bestOffer, targetRealistic: finite(result.calculated.targetRealistis1), targetMaximum: finite(result.calculated.targetMax), ara: context?.ara ?? null, atrPercent: a ? metric(a, 'atr') : null, atrValue: context?.atrValue, averageDailyVolumeShares: context?.averageDailyVolumeShares, fallbackVolatilityPercent: context?.fallbackVolatilityPercent, priceVsSma20Percent: a ? metric(a, 'sma20') : null, relativeVolume: a ? metric(a, 'volumeRatio') : null, liquidityScore: a ? componentScore(a, 'liquidity') : null, brokerFlowScore: a ? componentScore(a, 'brokerFlow') : null, signal: context?.signal ?? (a && a.score >= 70 ? 'confirmed_uptrend' : a && a.score >= 60 ? 'early_uptrend' : a && a.score < 45 ? 'avoid' : 'watch'), marketRegime: context?.marketRegime ?? 'unavailable', marketGateBlocked: context?.marketGateBlocked ?? false, hardRiskFlags: context?.hardRiskFlags ?? [], dataWarnings: context?.dataWarnings, historicalSnapshot: context?.historicalSnapshot, confidence: a?.confidence ?? 0, dataCompleteness: a?.dataCompleteness ?? 0, generatedAt: a?.generatedAt, orderbookGeneratedAt: context?.orderbookGeneratedAt, aiStoryGeneratedAt: context?.aiStoryGeneratedAt, sizing });
}
