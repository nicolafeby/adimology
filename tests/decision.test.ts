import assert from 'node:assert/strict';
import test from 'node:test';
import { buildTradeDecision } from '../lib/decision';
import type { StockAnalysisResult } from '../lib/types';

const result = (score: number, completeness = 80, target = 1150): StockAnalysisResult => ({
  input: { emiten: 'TEST', fromDate: '2026-01-01', toDate: '2026-01-31' },
  stockbitData: { bandar: 'XX', barangBandar: 1000, rataRataBandar: 1000 },
  marketData: { harga: 1000, offerTeratas: 1005, bidTerbawah: 995, fraksi: 5, totalBid: 100, totalOffer: 100 },
  calculated: { totalPapan: 10, rataRataBidOfer: 10, a: 50, p: 10, targetRealistis1: target, targetMax: target + 50 },
  orderbook: { bid: [{ price: 995, volume: 1000, queues: 1, changePercentage: 0 }], offer: [{ price: 1005, volume: 1000, queues: 1, changePercentage: 0 }] },
  comprehensiveAnalysis: { score, dataCompleteness: completeness, confidence: 80, agreement: 80, label: 'Positif', horizon: 'Swing 5–20 hari', generatedAt: '', warnings: [], components: [
    { key: 'technical', label: 'Tren', weight: 20, score: 70, available: true, metrics: [{ key: 'atr', label: 'ATR', value: 3, unit: '%', signal: 'neutral', description: '' }] },
  ] },
});

test('decision exposes a complete actionable trade plan', () => {
  const decision = buildTradeDecision(result(70));
  assert.equal(decision?.verdict, 'ACTIONABLE');
  assert.deepEqual([decision?.entryLow, decision?.entryHigh, decision?.stop, decision?.target], [1000, 1005, 955, 1150]);
  assert.ok((decision?.riskReward ?? 0) >= 1.5);
  assert.equal(decision?.atrPercent, 3);
  assert.equal(decision?.positionLots, 200);
  assert.equal(decision?.positionShares, 20_000);
  assert.equal(decision?.riskBudget, 1_000_000);
  assert.equal(decision?.positionValue, 20_100_000);
  assert.equal(decision?.positionRisk, 1_000_000);
  assert.match(decision?.invalidation ?? '', /955/);
});

test('position sizing is capped by buying power and rounded to IDX lots', () => {
  const decision = buildTradeDecision(result(70), { accountSize: 1_000_000, riskPercent: 50, atrMultiplier: 2 });
  assert.equal(decision?.stop, 940);
  assert.equal(decision?.positionLots, 9);
  assert.equal(decision?.positionShares, 900);
  assert.equal(decision?.positionValue, 904_500);
});

test('position sizing returns zero when risk budget cannot buy one lot', () => {
  const decision = buildTradeDecision(result(70), { accountSize: 100_000, riskPercent: 1 });
  assert.equal(decision?.positionLots, 0);
  assert.equal(decision?.positionValue, 0);
});

test('decision avoids a setup whose target is below entry', () => {
  const decision = buildTradeDecision(result(70, 80, 990));
  assert.equal(decision?.verdict, 'AVOID');
  assert.equal(decision?.riskReward, null);
});

test('decision waits when supporting data is incomplete', () => {
  assert.equal(buildTradeDecision(result(70, 40))?.verdict, 'WAIT');
});
