import { jakartaClock } from './market-calendar';

/**
 * Source-of-truth rules for the unified IDX screener.
 *
 * Values use provider boundary units: percentages are percentage points
 * (`3` means 3%), prices are IDR, volume/depth are shares, and value fields
 * are IDR. All fields are optional because unavailable production data must
 * stay unavailable instead of being coerced to zero.
 */
export interface IdxScreenerCandidate {
  ticker: string;
  close?: number | null;
  high?: number | null;
  open?: number | null;
  change_percent?: number | null;
  volume?: number | null;
  volume_ma_5?: number | null;
  volume_ma_20?: number | null;
  market_cap?: number | null;
  transaction_value?: number | null;
  /** @deprecated Provider-boundary alias retained for existing callers. */
  value_transaksi?: number | null;
  stoch_rsi_k?: number | null;
  stoch_rsi_d?: number | null;
  previous_stoch_rsi_k?: number | null;
  previous_stoch_rsi_d?: number | null;
  /** @deprecated Provider-boundary aliases retained for existing callers. */
  stochastic_rsi_k?: number | null;
  stochastic_rsi_d?: number | null;
  previous_stochastic_rsi_k?: number | null;
  previous_stochastic_rsi_d?: number | null;
  foreign_net_value?: number | null;
  /** @deprecated Provider-boundary alias retained for existing callers. */
  foreign_net_val?: number | null;
  offer_depth_top_price?: number | null;
  bid_depth_top_price?: number | null;
  avg_bid_depth?: number | null;
  ema_20?: number | null;
  ema_50?: number | null;
  macd_line?: number | null;
  macd_signal?: number | null;
  /** @deprecated Provider-boundary alias retained for existing callers. */
  macd_signal_line?: number | null;
  rsi_14?: number | null;
  top3_broker_net_buy_value?: number | null;
  top3_broker_net_sell_value?: number | null;
  /** @deprecated Provider-boundary aliases retained for existing callers. */
  top3_broker_net_buy_val?: number | null;
  top3_broker_net_sell_val?: number | null;
  market_data_updated_at?: string | null;
  orderbook_updated_at?: string | null;
  broker_summary_updated_at?: string | null;
}

export const CORE_STRATEGY_IDS = ['BPJS', 'BSJP', 'ARA_HUNTER', 'SWING'] as const;
export const STRATEGY_IDS = [...CORE_STRATEGY_IDS, 'CLOSING_PRIORITY'] as const;
export type CoreStrategyId = typeof CORE_STRATEGY_IDS[number];
export type StrategyId = typeof STRATEGY_IDS[number];
/** @deprecated Use the stable uppercase StrategyId contract. */
export type IdxStrategy = 'bpjs' | 'bsjp' | 'ara_hunter' | 'swing';

export interface StrategyWindowStatus {
  strategy_id: StrategyId;
  label: string;
  window_label: string;
  is_in_window: boolean;
}

export const IDX_STRATEGY_WINDOWS = Object.freeze({
  BPJS: { startMinute: 9 * 60, endMinuteExclusive: 9 * 60 + 16, label: '09:00–09:15 WIB' },
  BSJP: { startMinute: 15 * 60 + 40, endMinuteExclusive: 15 * 60 + 51, label: '15:40–15:50 WIB' },
  ARA_HUNTER: { startMinute: 9 * 60, endMinuteExclusive: 15 * 60 + 51, label: 'Intraday / pra-penutupan' },
  SWING: { startMinute: 16 * 60, endMinuteExclusive: 24 * 60, label: 'Post-market / after close' },
  CLOSING_PRIORITY: { startMinute: 15 * 60 + 40, endMinuteExclusive: 15 * 60 + 51, label: '15:40–15:50 WIB' },
} satisfies Record<StrategyId, { startMinute: number; endMinuteExclusive: number; label: string }>);

const STRATEGY_LABELS: Record<StrategyId, string> = {
  BPJS: 'BPJS',
  BSJP: 'BSJP',
  ARA_HUNTER: 'ARA Hunter',
  SWING: 'Swing Trading',
  CLOSING_PRIORITY: 'Closing Priority',
};

export interface StrategyRuleResult {
  key: string;
  label: string;
  passed: boolean;
  reason: string;
  actual: number | string | null;
  expected: string;
  missing_fields: string[];
}

export interface StrategyEvaluation {
  strategy_id: CoreStrategyId;
  passed: boolean;
  is_in_window: boolean;
  window_label: string;
  rules: StrategyRuleResult[];
  passed_reasons: string[];
  failed_reasons: string[];
  missing_fields: string[];
}

export type ConfidenceLevel = 'HIGH' | 'MEDIUM' | 'LOW';
export type CandidateAction = 'STRONG BUY / HAKA' | 'SPECULATIVE BUY' | 'SKIP / WAIT AND SEE';

export interface ScoreBreakdown {
  reason: string;
  points: number;
}

export interface TopPriorityCandidate {
  ticker: string;
  close: number;
  change_percent: number;
  matched_strategies: StrategyId[];
  confidence_score: number;
  confidence_level: ConfidenceLevel;
  action: CandidateAction;
  score_reasons: string;
  score_breakdown: ScoreBreakdown[];
  missing_fields: string[];
}

export interface UnifiedScreenerResult {
  ticker: string;
  close: number | null;
  change_percent: number | null;
  matched_strategies: StrategyId[];
  strategy_evaluations: Record<CoreStrategyId, StrategyEvaluation>;
  confidence_score: number | null;
  confidence_level: ConfidenceLevel | null;
  action: CandidateAction | null;
  score_reasons: string;
  score_breakdown: ScoreBreakdown[];
  missing_fields: string[];
  data_quality: 'COMPLETE' | 'PARTIAL' | 'INSUFFICIENT';
  evaluated_at: string;
  evaluated_at_wib: string;
}

export interface UnifiedScreenerOutput {
  pipeline_version: typeof IDX_UNIFIED_PIPELINE_VERSION;
  timezone: 'Asia/Jakarta';
  evaluated_at: string;
  evaluated_at_wib: string;
  windows: StrategyWindowStatus[];
  results: UnifiedScreenerResult[];
  top_priority_candidates: TopPriorityCandidate[];
}

export const IDX_UNIFIED_PIPELINE_VERSION = 'idx-unified-screener-v1' as const;

interface NormalizedCandidate {
  ticker: string;
  close: number | null;
  high: number | null;
  open: number | null;
  change_percent: number | null;
  volume: number | null;
  volume_ma_5: number | null;
  volume_ma_20: number | null;
  market_cap: number | null;
  transaction_value: number | null;
  stoch_rsi_k: number | null;
  stoch_rsi_d: number | null;
  previous_stoch_rsi_k: number | null;
  previous_stoch_rsi_d: number | null;
  foreign_net_value: number | null;
  offer_depth_top_price: number | null;
  bid_depth_top_price: number | null;
  avg_bid_depth: number | null;
  ema_20: number | null;
  ema_50: number | null;
  macd_line: number | null;
  macd_signal: number | null;
  rsi_14: number | null;
  top3_broker_net_buy_value: number | null;
  top3_broker_net_sell_value: number | null;
  market_data_updated_at: string | null;
  orderbook_updated_at: string | null;
  broker_summary_updated_at: string | null;
}

export interface EvaluationOptions {
  evaluatedAt?: string | Date;
  /** Production adapters enable this; pure filter/backtest callers can supply already-validated snapshots. */
  enforceFreshness?: boolean;
  marketMaxAgeSeconds?: Partial<Record<CoreStrategyId, number>>;
  orderbookMaxAgeSeconds?: number;
  brokerSummaryMaxAgeSeconds?: number;
}

const DEFAULT_MARKET_MAX_AGE: Record<CoreStrategyId, number> = {
  BPJS: 15 * 60,
  BSJP: 5 * 60,
  ARA_HUNTER: 5 * 60,
  SWING: 36 * 60 * 60,
};

const finite = (candidateValue: unknown): candidateValue is number => typeof candidateValue === 'number' && Number.isFinite(candidateValue);
const firstValue = (...values: unknown[]): number | null => values.find(finite) as number | undefined ?? null;
const timestamp = (raw: unknown): string | null => typeof raw === 'string' && Number.isFinite(Date.parse(raw)) ? new Date(raw).toISOString() : null;
const uniqueSorted = (values: string[]) => [...new Set(values)].sort((a, b) => a.localeCompare(b));

function normalizeCandidate(candidate: IdxScreenerCandidate): NormalizedCandidate {
  return {
    ticker: candidate.ticker.trim().toUpperCase(),
    close: firstValue(candidate.close),
    high: firstValue(candidate.high),
    open: firstValue(candidate.open),
    change_percent: firstValue(candidate.change_percent),
    volume: firstValue(candidate.volume),
    volume_ma_5: firstValue(candidate.volume_ma_5),
    volume_ma_20: firstValue(candidate.volume_ma_20),
    market_cap: firstValue(candidate.market_cap),
    transaction_value: firstValue(candidate.transaction_value, candidate.value_transaksi),
    stoch_rsi_k: firstValue(candidate.stoch_rsi_k, candidate.stochastic_rsi_k),
    stoch_rsi_d: firstValue(candidate.stoch_rsi_d, candidate.stochastic_rsi_d),
    previous_stoch_rsi_k: firstValue(candidate.previous_stoch_rsi_k, candidate.previous_stochastic_rsi_k),
    previous_stoch_rsi_d: firstValue(candidate.previous_stoch_rsi_d, candidate.previous_stochastic_rsi_d),
    foreign_net_value: firstValue(candidate.foreign_net_value, candidate.foreign_net_val),
    offer_depth_top_price: firstValue(candidate.offer_depth_top_price),
    bid_depth_top_price: firstValue(candidate.bid_depth_top_price),
    avg_bid_depth: firstValue(candidate.avg_bid_depth),
    ema_20: firstValue(candidate.ema_20),
    ema_50: firstValue(candidate.ema_50),
    macd_line: firstValue(candidate.macd_line),
    macd_signal: firstValue(candidate.macd_signal, candidate.macd_signal_line),
    rsi_14: firstValue(candidate.rsi_14),
    top3_broker_net_buy_value: firstValue(candidate.top3_broker_net_buy_value, candidate.top3_broker_net_buy_val),
    top3_broker_net_sell_value: firstValue(candidate.top3_broker_net_sell_value, candidate.top3_broker_net_sell_val),
    market_data_updated_at: timestamp(candidate.market_data_updated_at),
    orderbook_updated_at: timestamp(candidate.orderbook_updated_at),
    broker_summary_updated_at: timestamp(candidate.broker_summary_updated_at),
  };
}

function evaluationTime(raw: string | Date | undefined): { iso: string; millis: number } {
  const date = raw === undefined ? new Date() : new Date(raw);
  if (!Number.isFinite(date.getTime())) throw new RangeError('evaluatedAt harus timestamp yang valid.');
  return { iso: date.toISOString(), millis: date.getTime() };
}

export function getStrategyWindowStatuses(at: string | Date): StrategyWindowStatus[] {
  const clock = jakartaClock(at);
  return STRATEGY_IDS.map((strategyId) => {
    const window = IDX_STRATEGY_WINDOWS[strategyId];
    return {
      strategy_id: strategyId,
      label: STRATEGY_LABELS[strategyId],
      window_label: window.label,
      is_in_window: clock.minute >= window.startMinute && clock.minute < window.endMinuteExclusive,
    };
  });
}

const inWindow = (strategyId: StrategyId, at: string | Date) =>
  getStrategyWindowStatuses(at).find((item) => item.strategy_id === strategyId)!.is_in_window;

function createRule(
  key: string,
  label: string,
  actual: number | string | null,
  expected: string,
  passed: boolean,
  missingFields: string[] = [],
): StrategyRuleResult {
  const missing = uniqueSorted(missingFields);
  const reason = missing.length
    ? `${label}: data tidak tersedia (${missing.join(', ')})`
    : `${label}: ${passed ? 'lolos' : 'gagal'}; aktual ${String(actual)}, syarat ${expected}`;
  return { key, label, passed: missing.length === 0 && passed, reason, actual, expected, missing_fields: missing };
}

function numberRule(
  candidate: NormalizedCandidate,
  key: keyof NormalizedCandidate,
  label: string,
  expected: string,
  predicate: (actual: number) => boolean,
): StrategyRuleResult {
  const actual = candidate[key];
  return finite(actual)
    ? createRule(String(key), label, actual, expected, predicate(actual))
    : createRule(String(key), label, null, expected, false, [String(key)]);
}

function freshnessRule(
  candidate: NormalizedCandidate,
  source: 'market_data_updated_at' | 'orderbook_updated_at',
  evaluatedAt: number,
  maximumAgeSeconds: number,
  enforce: boolean,
  requireSameJakartaDate = false,
): StrategyRuleResult | null {
  if (!enforce) return null;
  const observed = candidate[source];
  if (!observed) return createRule(`${source}_freshness`, 'Freshness data', null, `timestamp valid, usia <= ${maximumAgeSeconds} detik`, false, [source]);
  const ageSeconds = (evaluatedAt - Date.parse(observed)) / 1000;
  const sameSessionDate = !requireSameJakartaDate
    || jakartaClock(observed).date === jakartaClock(new Date(evaluatedAt)).date;
  const valid = ageSeconds >= 0 && ageSeconds <= maximumAgeSeconds && sameSessionDate;
  return createRule(`${source}_freshness`, 'Freshness data', Math.round(ageSeconds), `0–${maximumAgeSeconds} detik`, valid, valid ? [] : [`stale:${source}`]);
}

function finishEvaluation(
  strategyId: CoreStrategyId,
  rules: Array<StrategyRuleResult | null>,
  evaluatedAt: string,
): StrategyEvaluation {
  const resolved = rules.filter((rule): rule is StrategyRuleResult => rule !== null);
  const missingFields = uniqueSorted(resolved.flatMap((rule) => rule.missing_fields));
  return {
    strategy_id: strategyId,
    passed: resolved.length > 0 && resolved.every((rule) => rule.passed),
    is_in_window: inWindow(strategyId, evaluatedAt),
    window_label: IDX_STRATEGY_WINDOWS[strategyId].label,
    rules: resolved,
    passed_reasons: resolved.filter((rule) => rule.passed).map((rule) => rule.reason),
    failed_reasons: resolved.filter((rule) => !rule.passed).map((rule) => rule.reason),
    missing_fields: missingFields,
  };
}

function evaluateBpjs(candidate: NormalizedCandidate, time: { iso: string; millis: number }, options: EvaluationOptions): StrategyEvaluation {
  const stochasticFields = ['previous_stoch_rsi_k', 'previous_stoch_rsi_d', 'stoch_rsi_k', 'stoch_rsi_d'] as const;
  const stochasticMissing = stochasticFields.filter((key) => !finite(candidate[key]));
  const stochasticValid = stochasticMissing.length === 0
    && stochasticFields.every((key) => candidate[key]! >= 0 && candidate[key]! <= 100);
  const crossover = stochasticValid
    && candidate.previous_stoch_rsi_k! <= candidate.previous_stoch_rsi_d!
    && candidate.stoch_rsi_k! > candidate.stoch_rsi_d!
    && candidate.stoch_rsi_k! < 50
    && candidate.stoch_rsi_d! < 50;
  return finishEvaluation('BPJS', [
    freshnessRule(candidate, 'market_data_updated_at', time.millis, options.marketMaxAgeSeconds?.BPJS ?? DEFAULT_MARKET_MAX_AGE.BPJS, options.enforceFreshness === true),
    numberRule(candidate, 'change_percent', 'Change di atas 2%', '> 2.0', (actual) => actual > 2),
    numberRule(candidate, 'change_percent', 'Change di bawah 8%', '< 8.0', (actual) => actual < 8),
    createRule('relative_volume_20', 'Volume di atas 2x MA20', finite(candidate.volume) && finite(candidate.volume_ma_20) && candidate.volume_ma_20 > 0 ? candidate.volume / candidate.volume_ma_20 : null, '> 2.0x', finite(candidate.volume) && finite(candidate.volume_ma_20) && candidate.volume_ma_20 > 0 && candidate.volume > 2 * candidate.volume_ma_20, [!finite(candidate.volume) ? 'volume' : '', !finite(candidate.volume_ma_20) ? 'volume_ma_20' : ''].filter(Boolean)),
    numberRule(candidate, 'transaction_value', 'Nilai transaksi', '>= Rp5.000.000.000', (actual) => actual >= 5_000_000_000),
    numberRule(candidate, 'market_cap', 'Kapitalisasi pasar', '>= Rp500.000.000.000', (actual) => actual >= 500_000_000_000),
    createRule('stoch_rsi_bullish_crossover', 'Bullish crossover Stochastic RSI baru di bawah 50', stochasticValid ? `prev K/D ${candidate.previous_stoch_rsi_k}/${candidate.previous_stoch_rsi_d}; now K/D ${candidate.stoch_rsi_k}/${candidate.stoch_rsi_d}` : null, 'prev K <= D; now K > D; K dan D < 50', crossover, stochasticMissing),
  ], time.iso);
}

function evaluateBsjp(candidate: NormalizedCandidate, time: { iso: string; millis: number }, options: EvaluationOptions): StrategyEvaluation {
  const priceMissing = ['high', 'close'].filter((key) => !finite(candidate[key as 'high' | 'close']));
  const candleValid = priceMissing.length === 0 && candidate.close! > 0 && candidate.high! >= candidate.close!;
  const distance = candleValid ? candidate.high! - candidate.close! : null;
  return finishEvaluation('BSJP', [
    freshnessRule(candidate, 'market_data_updated_at', time.millis, options.marketMaxAgeSeconds?.BSJP ?? DEFAULT_MARKET_MAX_AGE.BSJP, options.enforceFreshness === true),
    numberRule(candidate, 'change_percent', 'Change minimum', '>= 3.0', (actual) => actual >= 3),
    numberRule(candidate, 'change_percent', 'Change maksimum', '<= 15.0', (actual) => actual <= 15),
    createRule('relative_volume_5', 'Volume di atas MA5', finite(candidate.volume) && finite(candidate.volume_ma_5) && candidate.volume_ma_5 > 0 ? candidate.volume / candidate.volume_ma_5 : null, '> 1.0x', finite(candidate.volume) && finite(candidate.volume_ma_5) && candidate.volume_ma_5 > 0 && candidate.volume > candidate.volume_ma_5, [!finite(candidate.volume) ? 'volume' : '', !finite(candidate.volume_ma_5) ? 'volume_ma_5' : ''].filter(Boolean)),
    createRule('valid_close_and_high', 'Validasi harga close/high', candleValid ? `${candidate.close}/${candidate.high}` : null, 'close > 0 dan high >= close', candleValid, priceMissing),
    createRule('close_near_high', 'Close maksimal 1% dari high', distance, '<= 0.01 * close', candleValid && distance! <= 0.01 * candidate.close!, priceMissing),
    numberRule(candidate, 'foreign_net_value', 'Foreign net accumulation', '> 0', (actual) => actual > 0),
  ], time.iso);
}

function evaluateAraHunter(candidate: NormalizedCandidate, time: { iso: string; millis: number }, options: EvaluationOptions): StrategyEvaluation {
  const offerAvailable = finite(candidate.offer_depth_top_price) && candidate.offer_depth_top_price >= 0;
  const bidAvailable = finite(candidate.bid_depth_top_price) && candidate.bid_depth_top_price >= 0;
  const averageAvailable = finite(candidate.avg_bid_depth) && candidate.avg_bid_depth > 0;
  const locked = offerAvailable && candidate.offer_depth_top_price === 0;
  const thickBid = bidAvailable && averageAvailable && candidate.bid_depth_top_price! > 5 * candidate.avg_bid_depth!;
  const missing = [!offerAvailable ? 'offer_depth_top_price' : '', !bidAvailable ? 'bid_depth_top_price' : '', !averageAvailable ? 'avg_bid_depth' : ''].filter(Boolean);
  return finishEvaluation('ARA_HUNTER', [
    freshnessRule(candidate, 'market_data_updated_at', time.millis, options.marketMaxAgeSeconds?.ARA_HUNTER ?? DEFAULT_MARKET_MAX_AGE.ARA_HUNTER, options.enforceFreshness === true),
    freshnessRule(candidate, 'orderbook_updated_at', time.millis, options.orderbookMaxAgeSeconds ?? 60, options.enforceFreshness === true),
    numberRule(candidate, 'change_percent', 'Change menuju ARA', '>= 15.0', (actual) => actual >= 15),
    createRule('relative_volume_20', 'Volume di atas 3x MA20', finite(candidate.volume) && finite(candidate.volume_ma_20) && candidate.volume_ma_20 > 0 ? candidate.volume / candidate.volume_ma_20 : null, '> 3.0x', finite(candidate.volume) && finite(candidate.volume_ma_20) && candidate.volume_ma_20 > 0 && candidate.volume > 3 * candidate.volume_ma_20, [!finite(candidate.volume) ? 'volume' : '', !finite(candidate.volume_ma_20) ? 'volume_ma_20' : ''].filter(Boolean)),
    createRule('orderbook_confirmation', 'Konfirmasi orderbook', locked ? 'Locked ARA' : thickBid ? 'Bid > 5x average' : null, 'offer depth = 0 atau bid depth > 5x average', locked || thickBid, locked || thickBid ? [] : missing),
  ], time.iso);
}

function evaluateSwing(candidate: NormalizedCandidate, time: { iso: string; millis: number }, options: EvaluationOptions): StrategyEvaluation {
  const priceFields = ['close', 'ema_20', 'ema_50'] as const;
  const trendMissing = priceFields.filter((key) => !finite(candidate[key]));
  const macdMissing = ['macd_line', 'macd_signal'].filter((key) => !finite(candidate[key as 'macd_line' | 'macd_signal']));
  const candleMissing = ['open', 'close'].filter((key) => !finite(candidate[key as 'open' | 'close']));
  return finishEvaluation('SWING', [
    freshnessRule(candidate, 'market_data_updated_at', time.millis, options.marketMaxAgeSeconds?.SWING ?? DEFAULT_MARKET_MAX_AGE.SWING, options.enforceFreshness === true, true),
    createRule('ema_trend', 'Close di atas EMA20 dan EMA50', finite(candidate.close) ? candidate.close : null, '> EMA20 dan > EMA50', trendMissing.length === 0 && candidate.close! > 0 && candidate.close! > candidate.ema_20! && candidate.close! > candidate.ema_50!, trendMissing),
    createRule('macd_bullish', 'MACD line di atas signal', finite(candidate.macd_line) ? candidate.macd_line : null, '> MACD signal', macdMissing.length === 0 && candidate.macd_line! > candidate.macd_signal!, macdMissing),
    numberRule(candidate, 'rsi_14', 'RSI minimum', '>= 45.0', (actual) => actual >= 45),
    numberRule(candidate, 'rsi_14', 'RSI maksimum', '<= 65.0', (actual) => actual <= 65),
    createRule('green_candle', 'Candle hijau', finite(candidate.close) ? candidate.close : null, 'close > open', candleMissing.length === 0 && candidate.close! > candidate.open!, candleMissing),
    createRule('relative_volume_20', 'Volume di atas MA20', finite(candidate.volume) && finite(candidate.volume_ma_20) && candidate.volume_ma_20 > 0 ? candidate.volume / candidate.volume_ma_20 : null, '> 1.0x', finite(candidate.volume) && finite(candidate.volume_ma_20) && candidate.volume_ma_20 > 0 && candidate.volume > candidate.volume_ma_20, [!finite(candidate.volume) ? 'volume' : '', !finite(candidate.volume_ma_20) ? 'volume_ma_20' : ''].filter(Boolean)),
  ], time.iso);
}

export function evaluateBpjsStrategy(candidate: IdxScreenerCandidate, options: EvaluationOptions = {}) {
  return evaluateBpjs(normalizeCandidate(candidate), evaluationTime(options.evaluatedAt), options);
}

export function evaluateBsjpStrategy(candidate: IdxScreenerCandidate, options: EvaluationOptions = {}) {
  return evaluateBsjp(normalizeCandidate(candidate), evaluationTime(options.evaluatedAt), options);
}

export function evaluateAraHunterStrategy(candidate: IdxScreenerCandidate, options: EvaluationOptions = {}) {
  return evaluateAraHunter(normalizeCandidate(candidate), evaluationTime(options.evaluatedAt), options);
}

export function evaluateSwingStrategy(candidate: IdxScreenerCandidate, options: EvaluationOptions = {}) {
  return evaluateSwing(normalizeCandidate(candidate), evaluationTime(options.evaluatedAt), options);
}

export const passesBpjsFilter = (candidate: IdxScreenerCandidate) => evaluateBpjsStrategy(candidate).passed;
export const passesBsjpFilter = (candidate: IdxScreenerCandidate) => evaluateBsjpStrategy(candidate).passed;
export const passesAraHunterFilter = (candidate: IdxScreenerCandidate) => evaluateAraHunterStrategy(candidate).passed;
export const passesSwingFilter = (candidate: IdxScreenerCandidate) => evaluateSwingStrategy(candidate).passed;

export const CORE_STRATEGY_FILTERS = Object.freeze({
  bpjs: passesBpjsFilter,
  bsjp: passesBsjpFilter,
  ara_hunter: passesAraHunterFilter,
  swing: passesSwingFilter,
});

export function filterByStrategy<T extends IdxScreenerCandidate>(candidates: readonly T[], strategy: IdxStrategy): T[] {
  return candidates.filter(CORE_STRATEGY_FILTERS[strategy]);
}

const confidence = (score: number): { level: ConfidenceLevel; action: CandidateAction } => {
  if (score >= 80) return { level: 'HIGH', action: 'STRONG BUY / HAKA' };
  if (score >= 60) return { level: 'MEDIUM', action: 'SPECULATIVE BUY' };
  return { level: 'LOW', action: 'SKIP / WAIT AND SEE' };
};

function scoreClosingCandidate(
  candidate: NormalizedCandidate,
  time: { millis: number },
  options: EvaluationOptions,
): TopPriorityCandidate {
  const breakdown: ScoreBreakdown[] = [{ reason: 'Intersection ARA Hunter + BSJP (+50)', points: 50 }];
  const missingFields: string[] = [];
  const offer = candidate.offer_depth_top_price;
  const bid = candidate.bid_depth_top_price;
  const averageBid = candidate.avg_bid_depth;

  if (finite(offer) && offer >= 0 && offer === 0) {
    breakdown.push({ reason: 'Locked ARA (+30)', points: 30 });
  } else if (finite(offer) && offer >= 0 && finite(bid) && bid > 0 && offer < 0.1 * bid) {
    breakdown.push({ reason: 'Offer sangat tipis (+15)', points: 15 });
  }
  if (finite(bid) && bid > 0 && finite(averageBid) && averageBid > 0 && bid > 3 * averageBid) {
    breakdown.push({ reason: 'Bid tebal (+10)', points: 10 });
  }

  const buy = candidate.top3_broker_net_buy_value;
  const sell = candidate.top3_broker_net_sell_value;
  const brokerTimestamp = candidate.broker_summary_updated_at;
  const brokerAge = brokerTimestamp ? (time.millis - Date.parse(brokerTimestamp)) / 1000 : null;
  const brokerFresh = options.enforceFreshness !== true
    || brokerAge !== null && brokerAge >= 0 && brokerAge <= (options.brokerSummaryMaxAgeSeconds ?? 24 * 60 * 60);
  if (options.enforceFreshness === true && !brokerFresh) missingFields.push(brokerTimestamp ? 'stale:broker_summary_updated_at' : 'broker_summary_updated_at');
  if (!finite(buy) || buy < 0) missingFields.push('top3_broker_net_buy_value');
  if (!finite(sell) || sell < 0) missingFields.push('top3_broker_net_sell_value');
  if (brokerFresh && finite(buy) && buy >= 0 && finite(sell) && sell >= 0) {
    if (buy > 2 * sell) breakdown.push({ reason: 'Akumulasi top 3 broker (+20)', points: 20 });
    if (sell > buy) breakdown.push({ reason: 'Indikasi distribusi broker (-30)', points: -30 });
  }

  const rawScore = breakdown.reduce((sum, item) => sum + item.points, 0);
  const score = Math.max(0, Math.min(100, rawScore));
  const result = confidence(score);
  return {
    ticker: candidate.ticker,
    close: candidate.close!,
    change_percent: candidate.change_percent!,
    matched_strategies: ['BSJP', 'ARA_HUNTER', 'CLOSING_PRIORITY'],
    confidence_score: score,
    confidence_level: result.level,
    action: result.action,
    score_reasons: breakdown.map((item) => item.reason).join('; '),
    score_breakdown: breakdown,
    missing_fields: uniqueSorted(missingFields),
  };
}

/**
 * Closing evaluator contract. Rule evaluation is independent from the clock;
 * evaluatedAt is accepted for deterministic test/backtest orchestration.
 */
export function get_top_priority_candidates<T extends IdxScreenerCandidate>(
  candidates: readonly T[],
  options: EvaluationOptions = {},
): TopPriorityCandidate[] {
  const time = evaluationTime(options.evaluatedAt);
  return candidates.flatMap((raw) => {
    const candidate = normalizeCandidate(raw);
    const bsjp = evaluateBsjp(candidate, time, options);
    const ara = evaluateAraHunter(candidate, time, options);
    if (!bsjp.passed || !ara.passed || candidate.close === null || candidate.change_percent === null) return [];
    return [scoreClosingCandidate(candidate, time, options)];
  }).sort((a, b) => b.confidence_score - a.confidence_score
    || b.change_percent - a.change_percent
    || a.ticker.localeCompare(b.ticker));
}

export const getTopPriorityCandidates = get_top_priority_candidates;

function rowSort(a: UnifiedScreenerResult, b: UnifiedScreenerResult): number {
  const aPriority = a.matched_strategies.includes('CLOSING_PRIORITY');
  const bPriority = b.matched_strategies.includes('CLOSING_PRIORITY');
  if (aPriority !== bPriority) return aPriority ? -1 : 1;
  if ((a.confidence_score ?? -1) !== (b.confidence_score ?? -1)) return (b.confidence_score ?? -1) - (a.confidence_score ?? -1);
  if (a.matched_strategies.length !== b.matched_strategies.length) return b.matched_strategies.length - a.matched_strategies.length;
  if ((a.change_percent ?? -Infinity) !== (b.change_percent ?? -Infinity)) return (b.change_percent ?? -Infinity) - (a.change_percent ?? -Infinity);
  return a.ticker.localeCompare(b.ticker);
}

/** Evaluate every candidate once against every strategy and one closing pass. */
export function evaluateUnifiedIdxScreener(
  candidates: readonly IdxScreenerCandidate[],
  options: EvaluationOptions = {},
): UnifiedScreenerOutput {
  const time = evaluationTime(options.evaluatedAt);
  const normalized = candidates.map(normalizeCandidate);
  const topPriority = get_top_priority_candidates(candidates, { ...options, evaluatedAt: time.iso });
  const priorityByTicker = new Map(topPriority.map((candidate) => [candidate.ticker, candidate]));
  const results = normalized.map((candidate): UnifiedScreenerResult => {
    const evaluations = {
      BPJS: evaluateBpjs(candidate, time, options),
      BSJP: evaluateBsjp(candidate, time, options),
      ARA_HUNTER: evaluateAraHunter(candidate, time, options),
      SWING: evaluateSwing(candidate, time, options),
    } satisfies Record<CoreStrategyId, StrategyEvaluation>;
    const matched: StrategyId[] = CORE_STRATEGY_IDS.filter((strategyId) => evaluations[strategyId].passed);
    const priority = priorityByTicker.get(candidate.ticker);
    if (priority) matched.push('CLOSING_PRIORITY');
    const missing = uniqueSorted([
      ...Object.values(evaluations).flatMap((evaluation) => evaluation.missing_fields),
      ...(priority?.missing_fields ?? []),
    ]);
    const evaluatedStrategies = Object.values(evaluations).filter((evaluation) => evaluation.missing_fields.length === 0).length;
    const clock = jakartaClock(time.iso);
    return {
      ticker: candidate.ticker,
      close: candidate.close,
      change_percent: candidate.change_percent,
      matched_strategies: matched,
      strategy_evaluations: evaluations,
      confidence_score: priority?.confidence_score ?? null,
      confidence_level: priority?.confidence_level ?? null,
      action: priority?.action ?? null,
      score_reasons: priority?.score_reasons ?? '',
      score_breakdown: priority?.score_breakdown ?? [],
      missing_fields: missing,
      data_quality: evaluatedStrategies === CORE_STRATEGY_IDS.length ? 'COMPLETE' : evaluatedStrategies > 0 ? 'PARTIAL' : 'INSUFFICIENT',
      evaluated_at: time.iso,
      evaluated_at_wib: `${clock.date} ${clock.time} WIB`,
    };
  }).sort(rowSort);
  const clock = jakartaClock(time.iso);
  return {
    pipeline_version: IDX_UNIFIED_PIPELINE_VERSION,
    timezone: 'Asia/Jakarta',
    evaluated_at: time.iso,
    evaluated_at_wib: `${clock.date} ${clock.time} WIB`,
    windows: getStrategyWindowStatuses(time.iso),
    results,
    top_priority_candidates: topPriority,
  };
}

export function isUnifiedScreenerResult(candidateValue: unknown): candidateValue is UnifiedScreenerResult {
  if (!candidateValue || typeof candidateValue !== 'object') return false;
  const row = candidateValue as Partial<UnifiedScreenerResult>;
  return typeof row.ticker === 'string'
    && Array.isArray(row.matched_strategies)
    && !!row.strategy_evaluations
    && typeof row.evaluated_at === 'string';
}
