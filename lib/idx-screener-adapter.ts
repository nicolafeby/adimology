import { completedDailyCandleAvailableAt } from './point-in-time';
import type { HistoricalSummaryItem } from './stockbit';
import type { BrokerSummaryData, KeyStatsData, OrderbookSnapshot } from './types';
import type { IdxScreenerCandidate } from './idx-strategy-filters';

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const average = (values: number[]): number | null => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;

function emaSeries(values: number[], period: number): Array<number | null> {
  const output: Array<number | null> = Array(values.length).fill(null);
  if (values.length < period || values.some((value) => !finite(value))) return output;
  let current = values.slice(0, period).reduce((sum, value) => sum + value, 0) / period;
  output[period - 1] = current;
  const multiplier = 2 / (period + 1);
  for (let index = period; index < values.length; index++) {
    current = (values[index] - current) * multiplier + current;
    output[index] = current;
  }
  return output;
}

function rsiSeries(values: number[], period = 14): Array<number | null> {
  const output: Array<number | null> = Array(values.length).fill(null);
  if (values.length <= period || values.some((value) => !finite(value))) return output;
  let gains = 0;
  let losses = 0;
  for (let index = 1; index <= period; index++) {
    const change = values[index] - values[index - 1];
    gains += Math.max(0, change);
    losses += Math.max(0, -change);
  }
  let averageGain = gains / period;
  let averageLoss = losses / period;
  const rsi = () => averageLoss === 0 ? 100 : averageGain === 0 ? 0 : 100 - 100 / (1 + averageGain / averageLoss);
  output[period] = rsi();
  for (let index = period + 1; index < values.length; index++) {
    const change = values[index] - values[index - 1];
    averageGain = (averageGain * (period - 1) + Math.max(0, change)) / period;
    averageLoss = (averageLoss * (period - 1) + Math.max(0, -change)) / period;
    output[index] = rsi();
  }
  return output;
}

function rollingAverage(values: Array<number | null>, period: number): Array<number | null> {
  return values.map((_, index) => {
    const window = values.slice(index - period + 1, index + 1);
    return window.length === period && window.every(finite) ? average(window) : null;
  });
}

function stochasticRsi(values: number[], period = 14, smoothK = 3, smoothD = 3) {
  const rsi = rsiSeries(values, period);
  const raw = rsi.map((current, index): number | null => {
    const window = rsi.slice(index - period + 1, index + 1);
    if (!finite(current) || window.length !== period || !window.every(finite)) return null;
    const low = Math.min(...window);
    const high = Math.max(...window);
    return high === low ? 0 : (current - low) / (high - low) * 100;
  });
  const k = rollingAverage(raw, smoothK);
  const d = rollingAverage(k, smoothD);
  return {
    k: k.at(-1) ?? null,
    d: d.at(-1) ?? null,
    previousK: k.at(-2) ?? null,
    previousD: d.at(-2) ?? null,
  };
}

/** Technical indicators are calculated once here and consumed by every rule. */
export function calculateIdxStrategyIndicators(history: HistoricalSummaryItem[]) {
  const rows = [...history]
    .filter((row) => row.date && finite(row.close) && row.close > 0)
    .sort((a, b) => a.date.localeCompare(b.date));
  const closes = rows.map((row) => row.close);
  const ema12 = emaSeries(closes, 12);
  const ema20 = emaSeries(closes, 20);
  const ema26 = emaSeries(closes, 26);
  const ema50 = emaSeries(closes, 50);
  const macd = closes.map((_, index) => finite(ema12[index]) && finite(ema26[index]) ? ema12[index]! - ema26[index]! : null);
  const macdValues = macd.filter(finite);
  const signalValues = emaSeries(macdValues, 9);
  const latestSignal = signalValues.at(-1) ?? null;
  const latest = rows.at(-1);
  const prior = rows.slice(0, -1);
  const volumeMa5 = average(prior.slice(-5).map((row) => row.volume).filter((value) => finite(value) && value > 0));
  const volumeMa20 = average(prior.slice(-20).map((row) => row.volume).filter((value) => finite(value) && value > 0));
  const stoch = stochasticRsi(closes);
  return {
    latest,
    volumeMa5: prior.length >= 5 ? volumeMa5 : null,
    volumeMa20: prior.length >= 20 ? volumeMa20 : null,
    ema20: ema20.at(-1) ?? null,
    ema50: rows.length >= 50 ? ema50.at(-1) ?? null : null,
    macdLine: macd.at(-1) ?? null,
    macdSignal: macdValues.length >= 9 ? latestSignal : null,
    rsi14: rsiSeries(closes).at(-1) ?? null,
    stochRsiK: stoch.k,
    stochRsiD: stoch.d,
    previousStochRsiK: stoch.previousK,
    previousStochRsiD: stoch.previousD,
  };
}

function providerNumber(raw: unknown): number | null {
  if (finite(raw)) return raw;
  if (typeof raw !== 'string' || !raw.trim()) return null;
  const cleaned = raw.replace(/,/g, '').replace(/[^0-9.+-]/g, '');
  if (!/\d/.test(cleaned)) return null;
  const number = Number(cleaned);
  return finite(number) ? number : null;
}

function topThreeValue(rows: Array<Record<string, unknown>> | undefined, field: string): number | null {
  if (!rows?.length) return null;
  const values = rows.map((row) => providerNumber(row[field])).filter(finite).sort((a, b) => b - a).slice(0, 3);
  return values.length === Math.min(3, rows.length) ? values.reduce((sum, value) => sum + value, 0) : null;
}

export function marketCapFromKeyStats(keyStats: KeyStatsData | undefined): number | null {
  const item = keyStats?.currentValuation.find((row) => /market\s*cap|kapitalisasi\s*pasar/i.test(row.name));
  if (!item) return null;
  const raw = item.value.trim().toUpperCase().replace(/\s+/g, '');
  const cleaned = raw.replace(/(?:IDR|RP)/g, '').replace(/[,]/g, '').replace(/[^0-9.+-]/g, '');
  if (!/\d/.test(cleaned)) return null;
  const parsed = Number(cleaned);
  if (!finite(parsed)) return null;
  const multiplier = raw.endsWith('T') ? 1_000_000_000_000
    : raw.endsWith('B') ? 1_000_000_000
      : raw.endsWith('M') ? 1_000_000
        : 1;
  return parsed * multiplier;
}

export interface IdxCandidateSource {
  ticker: string;
  history?: HistoricalSummaryItem[];
  marketCap?: number | null;
  /** Must be an IDR value; the historical `net_foreign` share field is not substituted. */
  foreignNetValue?: number | null;
  orderbook?: OrderbookSnapshot | null;
  brokerSummary?: BrokerSummaryData | null;
  marketDataUpdatedAt?: string | null;
  orderbookUpdatedAt?: string | null;
  brokerSummaryUpdatedAt?: string | null;
}

/** Normalize existing market/history/orderbook/broker sources into one typed row. */
export function buildIdxScreenerCandidate(source: IdxCandidateSource): IdxScreenerCandidate {
  const indicators = calculateIdxStrategyIndicators(source.history ?? []);
  const latest = indicators.latest;
  const bids = [...(source.orderbook?.bid ?? [])]
    .filter((level) => finite(level.price) && level.price > 0 && finite(level.volume) && level.volume >= 0)
    .sort((a, b) => b.price - a.price);
  const offers = [...(source.orderbook?.offer ?? [])]
    .filter((level) => finite(level.price) && level.price > 0 && finite(level.volume) && level.volume >= 0)
    .sort((a, b) => a.price - b.price);
  const hasBook = source.orderbook !== undefined && source.orderbook !== null;
  const broker = source.brokerSummary;
  const topBuy = topThreeValue(broker?.topBuyers as unknown as Array<Record<string, unknown>> | undefined, 'bval');
  const topSell = topThreeValue(broker?.topSellers as unknown as Array<Record<string, unknown>> | undefined, 'sval');
  return {
    ticker: source.ticker,
    close: latest?.close ?? null,
    high: latest?.high ?? null,
    open: latest?.open ?? null,
    change_percent: latest?.change_percentage ?? null,
    volume: latest?.volume ?? null,
    volume_ma_5: indicators.volumeMa5,
    volume_ma_20: indicators.volumeMa20,
    market_cap: source.marketCap ?? null,
    transaction_value: latest?.value ?? null,
    stoch_rsi_k: indicators.stochRsiK,
    stoch_rsi_d: indicators.stochRsiD,
    previous_stoch_rsi_k: indicators.previousStochRsiK,
    previous_stoch_rsi_d: indicators.previousStochRsiD,
    foreign_net_value: source.foreignNetValue ?? null,
    offer_depth_top_price: hasBook ? offers[0]?.volume ?? 0 : null,
    bid_depth_top_price: hasBook ? bids[0]?.volume ?? 0 : null,
    avg_bid_depth: hasBook && bids.length ? average(bids.map((level) => level.volume)) : null,
    ema_20: indicators.ema20,
    ema_50: indicators.ema50,
    macd_line: indicators.macdLine,
    macd_signal: indicators.macdSignal,
    rsi_14: indicators.rsi14,
    top3_broker_net_buy_value: topBuy,
    top3_broker_net_sell_value: topSell,
    market_data_updated_at: source.marketDataUpdatedAt ?? (latest ? completedDailyCandleAvailableAt(latest.date) : null),
    orderbook_updated_at: source.orderbookUpdatedAt ?? source.orderbook?.observedAt ?? null,
    broker_summary_updated_at: source.brokerSummaryUpdatedAt ?? null,
  };
}
