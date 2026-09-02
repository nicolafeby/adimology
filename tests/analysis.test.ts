import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateTargets, getFraksi } from '../lib/calculations';
import { buildComprehensiveAnalysis } from '../lib/analysis';
import { preScreenHistory, classifyTrend } from '../lib/ranking';
import { summarizeBacktest } from '../lib/backtest';

test('legacy target calculation remains stable for valid inputs', () => {
  const result = calculateTargets(1000, 5000, 1200, 800, 10000, 10000, 1000);
  assert.deepEqual(result, {
    fraksi: 5,
    totalPapan: 80,
    rataRataBidOfer: 250,
    a: 50,
    p: 20,
    targetRealistis1: 1100,
    targetMax: 1150,
  });
});

test('pre-screen requires liquid momentum with volume confirmation', () => {
  const history = Array.from({ length: 25 }, (_, index) => ({
    date: `2026-01-${String(index + 1).padStart(2, '0')}`,
    close: 100 + index, open: 99 + index, high: 102 + index, low: 98 + index,
    change: 1, value: 2_000_000_000, volume: index === 24 ? 3_000_000 : 1_000_000,
    frequency: 100, foreign_buy: 0, foreign_sell: 0, net_foreign: 0, average: 100,
    change_percentage: 1,
  }));
  const result = preScreenHistory(history);
  assert.equal(result.passed, true);
  assert.ok(result.relativeVolume >= 1.2);
});

test('trend classifier does not confirm incomplete analysis', () => {
  const analysis = buildComprehensiveAnalysis({ lastPrice: 1000 });
  assert.equal(classifyTrend(analysis).signal, 'avoid');
  assert.equal(analysis.dataCompleteness, analysis.confidence);
});

test('backtest summary calculates objective ten-day win rate', () => {
  const summary = summarizeBacktest([{ return_10d: 5, target_hit: true, stop_hit: false }, { return_10d: -2, target_hit: false, stop_hit: true }]);
  assert.equal(summary.sampleSize, 2);
  assert.equal(summary.winRate10d, 0.5);
  assert.equal(summary.averageReturn10d, 1.5);
});

test('catalyst component uses structured AI score without keyword heuristics', () => {
  const result = buildComprehensiveAnalysis({
    lastPrice: 1000,
    catalyst: {
      kesimpulan: 'Teks ini sengaja memuat kata positif positif positif tetapi bukan sumber skor.',
      swot_analysis: { ai_scoring: { score: 37, confidence: 82, sentiment: 'negative', rationale: 'Risiko lebih besar daripada katalis.', positive_catalysts: [], negative_risks: ['Tekanan margin'] } },
    },
  });
  const catalyst = result.components.find((component) => component.key === 'catalyst');
  assert.equal(catalyst?.score, 37);
  assert.equal(catalyst?.metrics.find((metric) => metric.key === 'aiStoryConfidence')?.value, 82);
});

test('target calculation never emits NaN or Infinity for incomplete orderbook', () => {
  const result = calculateTargets(1000, 0, 0, 0, 0, 0, 1000);
  for (const value of Object.values(result)) assert.equal(Number.isFinite(value), true);
});

test('IDX price fractions retain existing boundaries', () => {
  assert.deepEqual([getFraksi(199), getFraksi(200), getFraksi(500), getFraksi(2000), getFraksi(5000)], [1, 2, 5, 10, 25]);
});

test('comprehensive score excludes unavailable components and reports coverage', () => {
  const result = buildComprehensiveAnalysis({ lastPrice: 1000 });
  assert.equal(result.score, 50);
  assert.equal(result.confidence, 0);
  assert.equal(result.components.length, 7);
  assert.ok(result.warnings.length > 0);
});

test('liquidity metrics use best prices and near-touch depth', () => {
  const result = buildComprehensiveAnalysis({
    lastPrice: 1000,
    orderbook: {
      bid: [{ price: 995, volume: 20_000, queues: 10, changePercentage: 0 }],
      offer: [{ price: 1000, volume: 10_000, queues: 8, changePercentage: 0 }],
    },
  });
  const liquidity = result.components.find((item) => item.key === 'liquidity');
  assert.equal(liquidity?.available, true);
  assert.ok(liquidity?.metrics.some((item) => item.key === 'spread'));
  assert.ok((liquidity?.score ?? 0) >= 0 && (liquidity?.score ?? 0) <= 100);
});
