export const DEFAULT_ATR_PERIOD = 14;
export const ATR_SMOOTHING_METHOD = 'wilder' as const;
export const DEFAULT_ATR_MULTIPLIER = 1.5;
export const MIN_STOP_ATR_DISTANCE = 1;
export const MAX_STOP_PERCENT = 8;
export const MAX_ATR_PERCENT = 7;
export const IDX_LOT_SIZE = 100;

export interface PriceCandle { date: string; high: number; low: number; close: number }
export interface AtrResult { atr: number; atrPercent: number; period: number; validCandles: number; method: typeof ATR_SMOOTHING_METHOD }
export interface AtrStopResult { price: number | null; rawPrice: number | null; atr: number; atrPercent: number; multiplier: number; riskPerShare: number | null; riskPercent: number | null; basis: 'atr' | 'atr_and_structure'; structuralStop: number | null; warnings: string[]; valid: boolean }
export interface PositionSizingInput { tradingCapital?: number; availableCash?: number; maximumRiskPercent: number; entryPrice: number; stopPrice: number; lotSize?: number; maxAllocationPercent: number; estimatedBuyFeePercent: number; estimatedSellFeePercent: number; liquidityLimitLots?: number | null }
export interface PositionSizingResult { riskBudget: number; riskPerShare: number; rawShares: number; recommendedShares: number; recommendedLots: number; positionValue: number; capitalAllocationPercent: number; estimatedBuyFee: number; estimatedSellFeeAtStop: number; estimatedLossBeforeFees: number; estimatedLossAfterFees: number; actualRiskPercent: number; limitingFactors: string[]; warnings: string[]; valid: boolean }

const finitePositive = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0;
const tickFor = (price: number) => price < 200 ? 1 : price < 500 ? 2 : price < 2000 ? 5 : price < 5000 ? 10 : 25;

function roundToValidTick(value: number, direction: 'down' | 'up'): number | null {
  if (!finitePositive(value)) return null;
  let rounded = value;
  for (let i = 0; i < 4; i++) {
    const tick = tickFor(rounded);
    const next = (direction === 'down' ? Math.floor(value / tick) : Math.ceil(value / tick)) * tick;
    if (next === rounded && next % tickFor(next) === 0) break;
    rounded = next;
  }
  return finitePositive(rounded) ? rounded : null;
}
export const roundDownToValidTick = (value: number) => roundToValidTick(value, 'down');
export const roundUpToValidTick = (value: number) => roundToValidTick(value, 'up');

export function trueRange(current: Pick<PriceCandle, 'high' | 'low'>, previousClose: number): number | null {
  if (![current.high, current.low, previousClose].every(Number.isFinite) || current.high < current.low || current.low <= 0 || previousClose <= 0) return null;
  const result = Math.max(current.high - current.low, Math.abs(current.high - previousClose), Math.abs(current.low - previousClose));
  return Number.isFinite(result) ? result : null;
}

export function calculateWilderAtr(history: PriceCandle[], referencePrice: number, period = DEFAULT_ATR_PERIOD): AtrResult | null {
  if (!Number.isInteger(period) || period < 1 || !finitePositive(referencePrice)) return null;
  const rows = history.filter((row) => row.date && [row.high, row.low, row.close].every(Number.isFinite) && row.high >= row.low && row.low > 0 && row.close > 0).sort((a, b) => a.date.localeCompare(b.date));
  if (rows.length < period + 1) return null;
  const ranges = rows.slice(1).map((row, index) => trueRange(row, rows[index].close)).filter((value): value is number => value !== null);
  if (ranges.length < period) return null;
  let atr = ranges.slice(0, period).reduce((sum, value) => sum + value, 0) / period;
  for (const range of ranges.slice(period)) atr = ((atr * (period - 1)) + range) / period;
  const atrPercent = atr / referencePrice * 100;
  return Number.isFinite(atr) && Number.isFinite(atrPercent) ? { atr, atrPercent, period, validCandles: rows.length, method: ATR_SMOOTHING_METHOD } : null;
}

export function calculateAtrStop(input: { entryPrice: number; atr: number; atrPercent: number; multiplier?: number; structuralStop?: number | null; minAtrDistance?: number; maxStopPercent?: number; maxAtrPercent?: number }): AtrStopResult {
  const multiplier = finitePositive(input.multiplier) ? input.multiplier : DEFAULT_ATR_MULTIPLIER;
  const warnings: string[] = [];
  const structuralStop = finitePositive(input.structuralStop) && input.structuralStop < input.entryPrice ? input.structuralStop : null;
  if (![input.entryPrice, input.atr, input.atrPercent].every(finitePositive)) return { price: null, rawPrice: null, atr: input.atr, atrPercent: input.atrPercent, multiplier, riskPerShare: null, riskPercent: null, basis: structuralStop ? 'atr_and_structure' : 'atr', structuralStop, warnings: ['Entry atau ATR tidak valid.'], valid: false };
  const rawAtrStop = input.entryPrice - input.atr * multiplier;
  const rawPrice = structuralStop === null ? rawAtrStop : Math.min(rawAtrStop, structuralStop);
  const price = roundDownToValidTick(rawPrice);
  const riskPerShare = price === null ? null : input.entryPrice - price;
  const riskPercent = riskPerShare === null ? null : riskPerShare / input.entryPrice * 100;
  if (riskPerShare !== null && riskPerShare < input.atr * (input.minAtrDistance ?? MIN_STOP_ATR_DISTANCE)) warnings.push('Stop terlalu dekat dan berisiko terkena noise harian.');
  if (riskPercent !== null && riskPercent > (input.maxStopPercent ?? MAX_STOP_PERCENT)) warnings.push(`Jarak stop ${riskPercent.toFixed(2)}% melewati batas maksimum.`);
  if (input.atrPercent > (input.maxAtrPercent ?? MAX_ATR_PERCENT)) warnings.push(`ATR ${input.atrPercent.toFixed(2)}% tergolong tinggi.`);
  const valid = price !== null && price > 0 && price < input.entryPrice && riskPercent !== null && riskPercent <= (input.maxStopPercent ?? MAX_STOP_PERCENT);
  return { price, rawPrice, atr: input.atr, atrPercent: input.atrPercent, multiplier, riskPerShare, riskPercent, basis: structuralStop ? 'atr_and_structure' : 'atr', structuralStop, warnings, valid };
}

export function calculatePositionSize(input: PositionSizingInput): PositionSizingResult | null {
  if (!finitePositive(input.tradingCapital) || !finitePositive(input.availableCash)) return null;
  const lotSize = finitePositive(input.lotSize) ? Math.floor(input.lotSize) : IDX_LOT_SIZE;
  if (![input.maximumRiskPercent, input.entryPrice, input.stopPrice, input.maxAllocationPercent].every(finitePositive) || input.stopPrice >= input.entryPrice || lotSize < 1) return null;
  const riskBudget = input.tradingCapital * input.maximumRiskPercent / 100;
  const riskPerShare = input.entryPrice - input.stopPrice;
  const buyFeeRate = Math.max(0, input.estimatedBuyFeePercent) / 100;
  const sellFeeRate = Math.max(0, input.estimatedSellFeePercent) / 100;
  const lossPerShareAfterFees = riskPerShare + input.entryPrice * buyFeeRate + input.stopPrice * sellFeeRate;
  const caps = [
    { name: 'risk_budget', lots: Math.floor(riskBudget / lossPerShareAfterFees / lotSize) },
    { name: 'available_cash', lots: Math.floor(input.availableCash / (input.entryPrice * (1 + buyFeeRate)) / lotSize) },
    { name: 'max_allocation', lots: Math.floor((input.tradingCapital * input.maxAllocationPercent / 100) / (input.entryPrice * (1 + buyFeeRate)) / lotSize) },
  ];
  if (finitePositive(input.liquidityLimitLots)) caps.push({ name: 'liquidity', lots: Math.floor(input.liquidityLimitLots) });
  const recommendedLots = Math.max(0, Math.min(...caps.map((cap) => cap.lots)));
  const recommendedShares = recommendedLots * lotSize;
  const positionValue = recommendedShares * input.entryPrice;
  const estimatedBuyFee = positionValue * buyFeeRate;
  const estimatedSellFeeAtStop = recommendedShares * input.stopPrice * sellFeeRate;
  const estimatedLossBeforeFees = recommendedShares * riskPerShare;
  const estimatedLossAfterFees = estimatedLossBeforeFees + estimatedBuyFee + estimatedSellFeeAtStop;
  const limitingFactors = caps.filter((cap) => cap.lots === recommendedLots).map((cap) => cap.name);
  const warnings = input.liquidityLimitLots == null ? ['Batas likuiditas belum diterapkan karena data volume tidak tersedia.'] : [];
  if (recommendedLots === 0) warnings.push('Batas risiko/modal tidak cukup untuk membeli satu lot.');
  return { riskBudget, riskPerShare, rawShares: Math.floor(riskBudget / riskPerShare), recommendedShares, recommendedLots, positionValue, capitalAllocationPercent: positionValue / input.tradingCapital * 100, estimatedBuyFee, estimatedSellFeeAtStop, estimatedLossBeforeFees, estimatedLossAfterFees, actualRiskPercent: estimatedLossAfterFees / input.tradingCapital * 100, limitingFactors, warnings, valid: recommendedLots > 0 && estimatedLossAfterFees <= riskBudget + 0.01 };
}
