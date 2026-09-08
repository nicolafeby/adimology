import assert from 'node:assert/strict';
import test from 'node:test';
import { buildIdxScreenerCandidate, calculateIdxStrategyIndicators, marketCapFromKeyStats } from '../lib/idx-screener-adapter';
import type { HistoricalSummaryItem } from '../lib/stockbit';

const history = Array.from({ length: 60 }, (_, index): HistoricalSummaryItem => {
  const close = 100 + index + (index % 3);
  return {
    date: `2026-${index < 31 ? '07' : '08'}-${String(index < 31 ? index + 1 : index - 30).padStart(2, '0')}`,
    open: close - 1,
    high: close + 1,
    low: close - 2,
    close,
    volume: 1_000 + index * 20,
    value: (1_000 + index * 20) * close,
    change: 1,
    change_percentage: 1,
    average: close,
    frequency: 100,
    foreign_buy: 10,
    foreign_sell: 5,
    net_foreign: 5,
  };
});

test('adapter calculates shared indicators once from sorted completed history', () => {
  const indicators = calculateIdxStrategyIndicators([...history].reverse());
  assert.ok(indicators.ema20 !== null);
  assert.ok(indicators.ema50 !== null);
  assert.ok(indicators.macdLine !== null);
  assert.ok(indicators.macdSignal !== null);
  assert.ok(indicators.rsi14 !== null);
  assert.equal(indicators.latest?.date, '2026-08-29');
});

test('adapter maps top-price share depth and does not substitute net_foreign shares for IDR foreign value', () => {
  const candidate = buildIdxScreenerCandidate({
    ticker: 'test',
    history,
    orderbook: {
      observedAt: '2026-08-29T09:00:00+07:00',
      volumeUnit: 'shares',
      bid: [{ price: 158, volume: 1_000, queues: 2, changePercentage: 0 }, { price: 157, volume: 500, queues: 1, changePercentage: 0 }],
      offer: [],
    },
  });
  assert.equal(candidate.offer_depth_top_price, 0);
  assert.equal(candidate.bid_depth_top_price, 1_000);
  assert.equal(candidate.avg_bid_depth, 750);
  assert.equal(candidate.foreign_net_value, null);
});

test('market-cap parser preserves IDR magnitude and missing values', () => {
  assert.equal(marketCapFromKeyStats({ currentValuation: [{ id: '1', name: 'Market Cap', value: '1.25 T' }], incomeStatement: [], balanceSheet: [], profitability: [], growth: [] }), 1_250_000_000_000);
  assert.equal(marketCapFromKeyStats({ currentValuation: [], incomeStatement: [], balanceSheet: [], profitability: [], growth: [] }), null);
});
