import assert from 'node:assert/strict';
import test from 'node:test';
import { screeningDiagnostics } from '../lib/screening';
import { evaluateStrategyScreening } from '../lib/strategy-screening';
import { screeningFixture } from './strategy-fixtures';

test('missing BPJS archives produce zero available data and expose cutoff reason without false momentum failures', () => {
  const assessment = evaluateStrategyScreening({ strategyId: 'bpjs', cutoffAt: '2026-09-08T06:28:21+07:00' });
  const row = { screening_status: assessment.screeningStatus, eligibility_rules: assessment.rules, data_quality: { valid: false }, quantitative_status: 'skipped' };
  const result = screeningDiagnostics(Array.from({ length: 966 }, () => row));
  assert.equal(result.dataAvailable, 0); assert.equal(result.missingRequiredData, 966); assert.equal(result.outsideEntryWindow, 966); assert.equal(result.quantitativeSkipped, 966);
  assert.ok(result.reasons.some(item => /jendela entry/.test(item.reason) && item.count === 966));
  assert.ok(result.reasons.some(item => /Candle intraday/.test(item.reason) && item.count === 966));
  assert.ok(result.reasons.every(item => !/positive_momentum|positive momentum|Momentum sesi/.test(item.reason)));
});

test('complete data can be counted even when a price rule fails; errors never count as available', () => {
  const data = screeningFixture(); data.candles[1].close = 101; data.candles[1].low = 101;
  const base = evaluateStrategyScreening({ strategyId: 'bpjs', cutoffAt: '2026-09-04T09:20:00+07:00', data });
  assert.equal(base.screeningStatus, 'rejected'); assert.equal(base.support.level, 'ready');
  const result = screeningDiagnostics([{ screening_status: base.screeningStatus, eligibility_rules: base.rules }, { screening_status: 'processing_error', data_quality: { valid: true } }]);
  assert.equal(result.dataAvailable, 1); assert.equal(result.missingRequiredData, 0);
});
