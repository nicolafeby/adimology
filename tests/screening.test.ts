import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyScreening, groupScreeningResults, type ScreeningClassifierInput, type ScreeningResult } from '../lib/screening';

const valid: ScreeningClassifierInput = { preScreenPassed: true, completeness: 80, confidence: 70, signal: 'confirmed_uptrend', analysisValid: true, confirmationComplete: true };
test('all hard gates pass', () => assert.equal(classifyScreening(valid).status, 'passed'));
test('pre-screen failure never passes', () => assert.equal(classifyScreening({ ...valid, preScreenPassed: false }).status, 'rejected'));
test('valid analysis without confirmation is watch', () => assert.equal(classifyScreening({ ...valid, confirmationComplete: false, signal: 'early_uptrend' }).status, 'watch'));
test('hard risk is rejected', () => assert.equal(classifyScreening({ ...valid, hasHardRisk: true }).status, 'rejected'));
test('fetch failure is processing_error', () => assert.equal(classifyScreening({ ...valid, processingError: 'timeout' }).status, 'processing_error'));
test('classifier is deterministic', () => assert.deepEqual(classifyScreening(valid), classifyScreening(valid)));
test('AI lifecycle cannot change quantitative screening status', () => {
  const before = classifyScreening(valid).status;
  for (const aiStatus of ['not_requested', 'pending', 'processing', 'completed', 'failed', 'stale']) {
    assert.equal(classifyScreening(valid).status, before, aiStatus);
  }
});
test('empty passed and summary counts are valid', () => {
  const make = (screening_status: ScreeningResult['screening_status'], symbol: string): ScreeningResult => ({ symbol, screening_status, analysis_date: '2026-01-01', passed_rules: [], failed_rules: [], selection_stage: 'pre_screen', data_quality: { completeness: null, confidence: null, valid: screening_status !== 'processing_error' }, evaluated_at: '2026-01-01T00:00:00Z', run_id: 'run' });
  const grouped = groupScreeningResults([make('watch', 'AAAA'), make('rejected', 'BBBB'), make('processing_error', 'CCCC')], 3);
  assert.equal(grouped.results.passed.length, 0); assert.deepEqual(grouped.summary, { universe: 3, evaluated: 0, passed: 0, watch: 1, rejected: 1, processingError: 1, aiRequested: 0, aiCompleted: 0, aiFailed: 0 });
});
test('AI coverage is reported independently', () => {
  const make = (symbol: string, ai_status: ScreeningResult['ai_status']): ScreeningResult => ({ symbol, ai_status, screening_status: 'watch', analysis_date: '2026-01-01', passed_rules: [], failed_rules: [], selection_stage: 'quantitative_analysis', data_quality: { completeness: 70, confidence: 60, valid: true }, evaluated_at: '2026-01-01T00:00:00Z', run_id: 'run' });
  const { summary } = groupScreeningResults([make('AAAA', 'completed'), make('BBBB', 'failed'), make('CCCC', 'not_requested')], 3);
  assert.equal(summary.watch, 3); assert.equal(summary.aiRequested, 2); assert.equal(summary.aiCompleted, 1); assert.equal(summary.aiFailed, 1);
});
