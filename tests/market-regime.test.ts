import assert from 'node:assert/strict';
import test from 'node:test';
import { applyMarketRegimeGate, calculateMarketRegime, calculateRelativeStrength } from '../lib/market-regime';
import type { HistoricalSummaryItem } from '../lib/stockbit';
import type { MarketRegimeAnalysis, RelativeStrengthAnalysis } from '../lib/types';

const history = (dailyGrowth: number, sessions = 30, finalVolumeRatio = 1.3): HistoricalSummaryItem[] => Array.from({ length: sessions }, (_, index) => {
  const close = 100 * Math.pow(1 + dailyGrowth, index);
  const date = new Date(Date.UTC(2026, 0, index + 1)).toISOString().slice(0, 10);
  return { date, close, open: close, high: close * 1.01, low: close * 0.99, change: 0, value: 2_000_000_000, volume: index === sessions - 1 ? 1_000_000 * finalVolumeRatio : 1_000_000, frequency: 100, foreign_buy: 0, foreign_sell: 0, net_foreign: 0, average: close, change_percentage: dailyGrowth * 100 };
});

const regime = (label: MarketRegimeAnalysis['label']): MarketRegimeAnalysis => ({ label, score: label === 'unavailable' ? null : 30, reasons: [], dataCompleteness: label === 'unavailable' ? 0 : 100, features: { sessions: 30, latestClose: 100, return5d: -3, return20d: -8, sma20: 105, priceVsSma20: -5, sma20Trend: -2, relativeVolume: 1 } });
const rs = (rs5d: number | null, rs20d: number | null): RelativeStrengthAnalysis => ({ label: rs5d === null || rs20d === null ? 'unavailable' : rs5d >= 2 && rs20d >= 5 ? 'strong' : rs5d >= 0 && rs20d >= 0 ? 'moderate' : 'weak', rs5d, rs20d, sectorRs5d: null, sectorRs20d: null, stockReturn5d: null, stockReturn20d: null, marketReturn5d: null, marketReturn20d: null, sectorReturn5d: null, sectorReturn20d: null, dataCompleteness: rs5d === null || rs20d === null ? 0 : 100 });

test('IHSG bullish and a stronger stock produce strong relative strength', () => {
  const market = history(0.003);
  const stock = history(0.01);
  assert.equal(calculateMarketRegime(market).label, 'bullish');
  assert.equal(calculateRelativeStrength(stock, market).label, 'strong');
});

test('bearish IHSG downgrades an ordinary confirmed signal', () => {
  const result = applyMarketRegimeGate({ signal: 'confirmed_uptrend', marketRegime: regime('bearish'), relativeStrength: rs(1, 2), relativeVolume: 1.3, brokerFlowScore: 65, dataCompleteness: 80 });
  assert.equal(result.applied, true);
  assert.equal(result.signalAfterGate, 'early_uptrend');
});

test('exceptional relative strength can retain confirmation in a bearish market', () => {
  const result = applyMarketRegimeGate({ signal: 'confirmed_uptrend', marketRegime: regime('bearish'), relativeStrength: { ...rs(5, 10), stockReturn5d: 4 }, stockReturn5d: 4, distanceFromSma20: 3, relativeVolume: 1.3, brokerFlowScore: 70, liquidityScore: 60, hardRiskFlags: [], dataCompleteness: 80 });
  assert.equal(result.exceptionalStrength, true);
  assert.equal(result.signalAfterGate, 'confirmed_uptrend');
  assert.equal(result.gateAction, 'retain_exceptional');
});

test('missing benchmark remains unavailable and never becomes zero', () => {
  const result = calculateRelativeStrength(history(0.005), []);
  assert.equal(result.label, 'unavailable');
  assert.equal(result.rs5d, null);
  assert.equal(result.rs20d, null);
  assert.equal(result.sectorRs20d, null);
});

test('fewer than 20 completed lookback sessions makes regime unavailable', () => {
  const result = calculateMarketRegime(history(0.005, 20));
  assert.equal(result.label, 'unavailable');
  assert.equal(result.features.return20d, null);
});

test('positive stock return can still have weak relative strength versus IHSG', () => {
  const result = calculateRelativeStrength(history(0.002), history(0.006));
  assert.ok((result.stockReturn20d ?? 0) > 0);
  assert.ok((result.rs20d ?? 0) < 0);
  assert.equal(result.label, 'weak');
});

test('bullish market never upgrades a weak base signal', () => {
  const result = applyMarketRegimeGate({ signal: 'watch', marketRegime: regime('bullish'), relativeStrength: rs(5, 10), relativeVolume: 1.5, brokerFlowScore: 80, dataCompleteness: 90 });
  assert.equal(result.signalAfterGate, 'watch');
  assert.equal(result.applied, false);
});

test('unavailable market adds risk without treating it as neutral', () => {
  const result = applyMarketRegimeGate({ signal: 'confirmed_uptrend', marketRegime: regime('unavailable'), relativeStrength: rs(null, null), relativeVolume: null, brokerFlowScore: null, dataCompleteness: 80, confidence: 72 });
  assert.equal(result.signalAfterGate, 'early_uptrend');
  assert.equal(result.gateAction, 'block_unavailable');
  assert.ok(result.riskFlags.some((flag) => flag.includes('tidak tersedia')));
  assert.equal(result.exceptionalStrength, false);
  assert.equal(result.confidenceAfter, 57);
});
