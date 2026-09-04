import assert from 'node:assert/strict';
import test from 'node:test';
import { deriveFunnelSummary, safeProcessingError, validateFunnelSummary, type ScreeningFunnelItem } from '../lib/screener-observability';

const items: ScreeningFunnelItem[] = [
  { symbol: 'PASS', pre_screen_passed: true, selected_for_quantitative: true, quantitative_status: 'completed', eligibility_status: 'eligible', screening_status: 'passed', ranking_position: 1, selected_for_ai: true, ai_status: 'completed', ai_source: 'cache', terminal_status: 'completed' },
  { symbol: 'WATCH', pre_screen_passed: true, selected_for_quantitative: true, quantitative_status: 'completed', eligibility_status: 'needs_confirmation', screening_status: 'watch', selected_for_ai: false, ai_status: 'not_requested', terminal_status: 'completed' },
  { symbol: 'SKIP', pre_screen_passed: false, selected_for_quantitative: false, quantitative_status: 'skipped', eligibility_status: 'not_evaluated', screening_status: null, selected_for_ai: false, ai_status: 'not_requested', terminal_status: 'skipped' },
  { symbol: 'FAIL', pre_screen_passed: null, selected_for_quantitative: false, quantitative_status: 'not_started', eligibility_status: 'not_evaluated', screening_status: 'processing_error', selected_for_ai: false, ai_status: 'not_requested', terminal_status: 'processing_error', failure_stage: 'data_acquisition' },
];

test('summary keeps skipped, filtered outcomes, and processing errors distinct', () => {
  const summary = deriveFunnelSummary(items);
  assert.equal(summary.universe, 4); assert.equal(summary.dataAcquisitionFailed, 1);
  assert.equal(summary.quantitativeSkipped, 1); assert.equal(summary.rejected, 0);
  assert.equal(summary.eligibilityEvaluated, 2); assert.equal(summary.ranked, 1);
  assert.deepEqual(validateFunnelSummary(summary), []);
});

test('invariant validator catches inconsistent persisted counts', () => {
  const summary = deriveFunnelSummary(items); summary.ranked = 2;
  assert.match(validateFunnelSummary(summary).join(' '), /ranked/);
});

test('persisted errors redact credentials and retain symbol-independent taxonomy', () => {
  const error = safeProcessingError(new Error('Authorization: Bearer private-token'), 'HISTORY_FETCH_FAILED', 'data_acquisition');
  assert.equal(error.code, 'HISTORY_FETCH_FAILED'); assert.doesNotMatch(error.safe_message, /private-token/); assert.equal(error.stage, 'data_acquisition');
});
