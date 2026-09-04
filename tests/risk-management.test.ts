import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateAtrStop, calculatePositionSize, calculateWilderAtr, IDX_LOT_SIZE, roundDownToValidTick, roundUpToValidTick, trueRange } from '../lib/risk-management';

test('true range includes overnight gaps', () => assert.equal(trueRange({ high: 110, low: 105 }, 100), 10));
test('Wilder ATR sorts dates and requires period plus one valid candles', () => {
  const rows = Array.from({ length: 15 }, (_, index) => ({ date: `2026-01-${String(15 - index).padStart(2, '0')}`, high: 102 + index, low: 98 + index, close: 100 + index }));
  const result = calculateWilderAtr(rows, 100);
  assert.equal(result?.period, 14); assert.equal(result?.validCandles, 15); assert.ok(Number.isFinite(result!.atr));
  assert.equal(calculateWilderAtr(rows.slice(0, 14), 100), null);
});
test('IDX rounding revalidates tick after crossing a price band', () => { assert.equal(roundDownToValidTick(500.9), 500); assert.equal(roundUpToValidTick(499.1), 500); });
test('ATR stop rounds downward and remains below entry', () => { const stop = calculateAtrStop({ entryPrice: 1000, atr: 30, atrPercent: 3, structuralStop: 960 }); assert.equal(stop.price, 955); assert.equal(stop.valid, true); });
test('position sizing is lot-based, fee-aware, and never exceeds risk budget', () => {
  const result = calculatePositionSize({ tradingCapital: 100_000_000, availableCash: 50_000_000, maximumRiskPercent: 1, entryPrice: 1000, stopPrice: 950, lotSize: IDX_LOT_SIZE, maxAllocationPercent: 20, estimatedBuyFeePercent: 0.15, estimatedSellFeePercent: 0.25, liquidityLimitLots: 500 });
  assert.ok(result); assert.equal(result!.recommendedShares, result!.recommendedLots * 100); assert.ok(result!.estimatedLossAfterFees <= result!.riskBudget); assert.ok(result!.recommendedLots < 200);
});
test('position sizing refuses to assume capital or cash', () => assert.equal(calculatePositionSize({ maximumRiskPercent: 1, entryPrice: 1000, stopPrice: 950, maxAllocationPercent: 20, estimatedBuyFeePercent: 0.15, estimatedSellFeePercent: 0.25 }), null));
