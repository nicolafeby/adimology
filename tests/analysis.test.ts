import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateTargets, getFraksi } from '../lib/calculations';
import { buildComprehensiveAnalysis } from '../lib/analysis';

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
