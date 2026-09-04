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
test('empty passed and summary counts are valid', () => {
  const make = (screening_status: ScreeningResult['screening_status'], symbol: string): ScreeningResult => ({ symbol, screening_status, analysis_date: '2026-01-01', passed_rules: [], failed_rules: [], selection_stage: 'pre_screen', data_quality: { completeness: null, confidence: null, valid: screening_status !== 'processing_error' }, evaluated_at: '2026-01-01T00:00:00Z', run_id: 'run' });
  const grouped = groupScreeningResults([make('watch', 'AAAA'), make('rejected', 'BBBB'), make('processing_error', 'CCCC')], 3);
  assert.equal(grouped.results.passed.length, 0); assert.deepEqual(grouped.summary, { universe: 3, evaluated: 0, passed: 0, watch: 1, rejected: 1, processingError: 1 });
});
