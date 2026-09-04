import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateRankingScore } from '../lib/ranking';
import { evaluateEligibility, type EligibilityInput } from '../lib/screening';
import type { CalibratedProbability } from '../lib/probability-calibration';

const eligible: EligibilityInput = { analysisValid: true, preScreenPassed: true, completeness: 85, confidence: 75, criticalDataAvailable: true, criticalDataStale: false, averageTradedValue: 2_000_000_000, spreadPercent: 0.5, atrPercent: 4, dominantDirection: 'bullish', hasHighSeverityConflict: false, signal: 'confirmed_uptrend', marketGateAvoid: false, aboveSma20: true, return5d: 4, relativeVolume: 1.5, brokerFlowScore: 70, relativeStrength20d: 3, signalAgreement: 80, riskReward: 2 };
const probability = (overrides: Partial<CalibratedProbability> = {}): CalibratedProbability => ({ probability: .65, rawProbability: .64, sampleSize: 60, successes: 38, failures: 22, scoreBucket: { low: 70, high: 80 }, requestedRegime: 'bullish', usedRegime: 'bullish', modelVersion: 'v', methodologyVersion: 'm', calibrationVersion: 'c', executionModel: 'e', outcomeDefinition: 'net_return_10d_positive', confidenceInterval: { lower: .5, upper: .75, level: .95, method: 'wilson' }, prior: { alpha: 1, beta: 1 }, sourceLevel: 'exact_regime', isFallback: false, warnings: [], calibrationCutoff: '2026-01-01', latestOutcomeDateUsed: '2025-12-01', calculatedAt: '2026-01-01', ...overrides });

test('high analysis score cannot compensate for liquidity, confidence, or pre-screen hard failures', () => {
  for (const changed of [{ averageTradedValue: 100_000_000 }, { confidence: 20 }, { preScreenPassed: false }]) assert.equal(evaluateEligibility({ ...eligible, ...changed }).screeningStatus, 'rejected');
});
test('confirmation shortage is watch while complete eligibility passes deterministically', () => {
  const weak = { ...eligible, aboveSma20: false, return5d: -1, relativeVolume: .8, brokerFlowScore: 20, relativeStrength20d: -2, signalAgreement: 30, riskReward: null };
  assert.equal(evaluateEligibility(weak).screeningStatus, 'watch');
  assert.deepEqual(evaluateEligibility(eligible), evaluateEligibility(eligible));
  assert.equal(evaluateEligibility(eligible).screeningStatus, 'passed');
});
test('ranking ignores insufficient probability instead of substituting zero', () => {
  const base = { momentumScore: 80, relativeStrength20d: 4, brokerFlowScore: 70, liquidityScore: 80, signalAgreement: 75, confidence: 80 };
  const missing = calculateRankingScore({ ...base, probability: null });
  const insufficient = calculateRankingScore({ ...base, probability: probability({ sourceLevel: 'insufficient_data', probability: null, sampleSize: 10, confidenceInterval: { lower: null, upper: null, level: .95, method: 'wilson' } }) });
  assert.equal(missing.score, insufficient.score);
  assert.equal(insufficient.factors.find((f) => f.key === 'calibrated_probability')?.available, false);
});
test('valid probability affects ranking and all scores are finite and bounded', () => {
  const input = { momentumScore: 80, relativeStrength20d: 4, brokerFlowScore: 70, liquidityScore: 80, signalAgreement: 75, confidence: 80 };
  const without = calculateRankingScore({ ...input, probability: null });
  const withProbability = calculateRankingScore({ ...input, probability: probability() });
  assert.notEqual(withProbability.score, without.score);
  for (const result of [without, withProbability, calculateRankingScore({ momentumScore: null, relativeStrength20d: null, brokerFlowScore: null, liquidityScore: null, signalAgreement: null, confidence: null, probability: null })]) assert.ok(Number.isFinite(result.score) && result.score >= 0 && result.score <= 100);
});
test('missing components receive a coverage penalty and cannot inflate ranking', () => {
  const complete = calculateRankingScore({ momentumScore: 80, relativeStrength20d: 6, brokerFlowScore: 80, liquidityScore: 80, signalAgreement: 80, confidence: 80, probability: null });
  const sparse = calculateRankingScore({ momentumScore: 80, relativeStrength20d: null, brokerFlowScore: null, liquidityScore: null, signalAgreement: null, confidence: null, probability: null });
  assert.ok(sparse.score < complete.score);
});
