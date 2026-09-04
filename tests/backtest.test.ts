import assert from 'node:assert/strict';
import test from 'node:test';
import { applyExecutionCost, applySlippage, buildEquityCurve, calculateMaximumDrawdown, calculateTradeOutcome, DEFAULT_BACKTEST_CONFIG, resolveSlippage, summarizeBacktest, validateBacktestConfig } from '../lib/backtest';

const noCost = { ...DEFAULT_BACKTEST_CONFIG, buyFeePercent: 0, sellFeePercent: 0, fixedSlippagePercent: 0, slippageModel: 'none' as const };
const candles = Array.from({ length: 20 }, (_, i) => ({ date: `2026-02-${String(i + 1).padStart(2, '0')}`, open: 100, high: i === 3 ? 112 : 105, low: 98, close: 102 }));

test('fees apply once and minimum fee is respected', () => {
  const result = applyExecutionCost({ executedEntryPrice: 100, executedExitPrice: 110, shares: 100 }, { ...DEFAULT_BACKTEST_CONFIG, minimumFee: 100 });
  assert.equal(result.buyFee, 100); assert.equal(result.sellFee, 100); assert.equal(result.netPnl, result.grossPnl - 200); assert.ok(result.netReturnPercent < result.grossReturnPercent);
});
test('long slippage worsens prices and follows conservative IDX ticks', () => { assert.equal(applySlippage(199, 'buy', 1), 202); assert.equal(applySlippage(501, 'sell', 1), 494); });
test('spread fallback is explicitly labelled', () => { assert.equal(resolveSlippage({ ...DEFAULT_BACKTEST_CONFIG, slippageModel: 'half_spread' }, null).source, 'configured_fallback'); });
test('entry zone triggers and target exits after entry', () => {
  const result = calculateTradeOutcome(candles, { signalDate: '2026-01-31', entryLow: 99, entryHigh: 101, stopPrice: 95, target1: 110, validSessions: 5, horizon: 20 }, noCost);
  assert.equal(result.entryTriggered, true); assert.equal(result.exitReason, 'target_1'); assert.equal(result.holdingSessions, 4); assert.ok((result.mfePercent ?? 0) > 0); assert.ok((result.maePercent ?? 0) < 0); assert.ok(result.rMultiple !== null);
});
test('untouched entry becomes no_entry and is excluded from win rate', () => {
  const result = calculateTradeOutcome(candles, { signalDate: '2026-01-31', entryLow: 80, entryHigh: 90, stopPrice: 75, target1: 110, validSessions: 5, horizon: 20 }, noCost);
  assert.equal(result.exitReason, 'no_entry'); const summary = summarizeBacktest([{ entry_triggered: false, exit_reason: 'no_entry' }], noCost); assert.equal(summary.winRate10d, null); assert.equal(summary.noEntryCount, 1);
});
test('same candle target and stop is ambiguous by default', () => {
  const rows = candles.map((x, i) => i ? x : { ...x, high: 120, low: 90 }); const result = calculateTradeOutcome(rows, { signalDate: '2026-01-31', entryLow: 99, entryHigh: 101, stopPrice: 95, target1: 110, validSessions: 5, horizon: 20 }, noCost);
  assert.equal(result.exitReason, 'ambiguous'); assert.equal(result.targetHit, true); assert.equal(result.stopHit, true); assert.match(result.ambiguityReason ?? '', /entry/);
});
test('insufficient history and invalid config are explicit', () => { assert.equal(calculateTradeOutcome(candles.slice(0, 5), { signalDate: '2026-01-31', entryLow: 99, entryHigh: 101, stopPrice: 95, target1: 110, validSessions: 5, horizon: 20 }, noCost).exitReason, 'insufficient_data'); assert.throws(() => validateBacktestConfig({ ...DEFAULT_BACKTEST_CONFIG, lotSize: 0 }), /integer positif/); });
test('equity drawdown is finite and zero-loss profit factor is null', () => { assert.ok((calculateMaximumDrawdown(buildEquityCurve([{ exitDate: '2026-01-01', netReturnPercent: 10 }, { exitDate: '2026-01-02', netReturnPercent: -20 }])) ?? 0) < 0); assert.equal(summarizeBacktest([{ entry_triggered: true, net_return_percent: 2, exit_date: '2026-01-01' }], noCost).profitFactor, null); });
test('empty metrics are null rather than NaN', () => { const summary = summarizeBacktest([], noCost); assert.equal(summary.averageReturn10d, null); assert.equal(summary.maxDrawdown10d, null); });
