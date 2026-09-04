import assert from 'node:assert/strict';
import test from 'node:test';
import { buildComprehensiveAnalysis } from '../lib/analysis';
import { calculateAnalysisConfidence, calculateComponentCoverage, calculateFreshness, calculateSignalAgreement, normalizeComponentDirection } from '../lib/analysis-quality';
import type { AnalysisComponent, ReliabilityAssessment } from '../lib/types';
import { classifyTrend } from '../lib/ranking';

const component = (key: AnalysisComponent['key'], score: number | null, weight = 20, coverage = 100): AnalysisComponent => ({ key, label: key, weight, score, available: score !== null, coverage, metrics: [], ...normalizeComponentDirection(score) });

test('component coverage treats zero as available, null as missing, and stays finite', () => {
  assert.deepEqual(calculateComponentCoverage(['zero', 'missing'], { zero: 0, missing: null }), { coverage: 50, requiredMetrics: ['zero', 'missing'], availableMetrics: ['zero'], missingMetrics: ['missing'] });
  assert.equal(calculateComponentCoverage([], {}).coverage, 0);
});

test('agreement is directional, excludes unavailable, and requires two components', () => {
  assert.equal(calculateSignalAgreement([component('technical', 80)]).score, null);
  const bullish = calculateSignalAgreement([component('technical', 90), component('brokerFlow', 80), component('catalyst', null)]);
  assert.equal(bullish.dominantDirection, 'bullish');
  assert.ok((bullish.score ?? 0) >= 55);
  const bearish = calculateSignalAgreement([component('technical', 10), component('brokerFlow', 20)]);
  assert.equal(bearish.dominantDirection, 'bearish');
  assert.ok((bearish.score ?? 0) >= 55);
  const balanced = calculateSignalAgreement([component('technical', 100), component('brokerFlow', 0)]);
  assert.equal(balanced.score, 0);
  assert.equal(balanced.dominantDirection, 'neutral');
  const neutral = calculateSignalAgreement([component('technical', 50), component('brokerFlow', 50)]);
  assert.equal(neutral.score, 0);
});

test('freshness uses source-specific expiry and unknown is not fresh', () => {
  const now = new Date('2026-01-02T00:00:00Z');
  assert.equal(calculateFreshness('orderbook', '2026-01-01T23:59:00Z', now).status, 'fresh');
  assert.equal(calculateFreshness('orderbook', '2026-01-01T23:50:00Z', now).status, 'aging');
  assert.equal(calculateFreshness('orderbook', '2026-01-01T22:00:00Z', now).status, 'stale');
  assert.deepEqual(calculateFreshness('fundamental', null, now).status, 'unknown');
});

test('confidence differs from completeness and applies conflict/missing caps', () => {
  const components = [component('technical', 80), component('brokerFlow', 80)];
  const agreement = calculateSignalAgreement(components);
  const reliability: ReliabilityAssessment = { score: 90, issues: [], fallbackUsed: false, sampleSizes: {} };
  const good = calculateAnalysisConfidence({ completeness: 100, agreement, freshness: 100, reliability, components, conflicts: [] });
  const conflict = calculateAnalysisConfidence({ completeness: 100, agreement, freshness: 100, reliability, components, conflicts: [{ key: 'x', severity: 'high', components: ['technical', 'brokerFlow'], message: 'conflict' }] });
  const incomplete = calculateAnalysisConfidence({ completeness: 35, agreement, freshness: 100, reliability, components, conflicts: [] });
  const staleComponents = components.map((item) => ({ ...item, freshness: calculateFreshness('historicalPrice', '2025-01-01', new Date('2026-01-01')) }));
  const stale = calculateAnalysisConfidence({ completeness: 100, agreement, freshness: 0, reliability, components: staleComponents, conflicts: [] });
  assert.ok(good < 100 && good > 70);
  assert.ok(conflict <= 55);
  assert.ok(incomplete <= 60);
  assert.ok(stale <= 55);
});

test('source to component to global quality is deterministic and serializable', () => {
  const input = { lastPrice: 1000, now: new Date('2026-01-02T00:00:00Z'), orderbook: { bid: [{ price: 995, volume: 10_000, queues: 2, changePercentage: 0 }], offer: [{ price: 1000, volume: 10_000, queues: 2, changePercentage: 0 }] } };
  const first = buildComprehensiveAnalysis(input), second = buildComprehensiveAnalysis(input);
  assert.deepEqual(first, second);
  assert.ok(first.quality);
  assert.equal(JSON.stringify(first).includes('NaN'), false);
  assert.equal(JSON.stringify(first).includes('Infinity'), false);
});

test('ranking separates confidence gate and never promotes dominant bearish agreement', () => {
  const bullish = buildComprehensiveAnalysis({ lastPrice: 1000, now: new Date('2026-01-02T00:00:00Z') });
  bullish.score = 85;
  bullish.dataCompleteness = 90;
  bullish.confidence = 40;
  bullish.components = [component('technical', 85), component('brokerFlow', 85)];
  assert.notEqual(classifyTrend(bullish).signal, 'confirmed_uptrend');
  bullish.confidence = 90;
  if (bullish.quality) bullish.quality.dominantDirection = 'bearish';
  assert.equal(classifyTrend(bullish).signal, 'avoid');
});
