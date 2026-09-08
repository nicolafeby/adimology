import test from 'node:test';
import assert from 'node:assert/strict';
import { buildComprehensiveAnalysis } from '../lib/analysis';
import { classifyTrend, calculateRankingScore } from '../lib/ranking';
import { calculateTradingDecision, type DecisionInput } from '../lib/decision';

test('AI score, freshness and confidence cannot change quantitative analysis, ranking or eligibility inputs', () => {
  const now = new Date('2026-09-07T09:00:00Z');
  const input = { now, lastPrice: 1000, orderbook: { observedAt: now.toISOString(), bid: [{ price: 995, volume: 100000, queues: 10, changePercentage: 0 }], offer: [{ price: 1000, volume: 100000, queues: 10, changePercentage: 0 }] } };
  const base = buildComprehensiveAnalysis(input);
  for (const score of [0, 100]) {
    const enriched = buildComprehensiveAnalysis({ ...input, catalyst: { created_at: '2026-09-01T01:00:00Z', matriks_story: [{}], swot_analysis: { ai_scoring: { score, confidence: score, sentiment: score ? 'positive' : 'negative', rationale: 'Fixture', positive_catalysts: [], negative_risks: [] } } } });
    assert.equal(enriched.components.find(c => c.key === 'catalyst')?.role, 'informational');
    assert.deepEqual(enriched.quality, base.quality);
    assert.equal(enriched.score, base.score);
    assert.deepEqual(classifyTrend(enriched), classifyTrend(base));
    const ranking = (a: typeof base) => calculateRankingScore({ momentumScore: 60, relativeStrength20d: 5, brokerFlowScore: 70, liquidityScore: null, signalAgreement: a.agreement, confidence: a.confidence, probability: null });
    assert.deepEqual(ranking(enriched), ranking(base));
  }
});
test('AI age cannot reduce decision confidence or change verdict', () => {
  const input: DecisionInput = { currentPrice: 1000, bestBid: 995, bestOffer: 1000, targetRealistic: 1100, targetMaximum: 1150, ara: 1200, atrPercent: 2, priceVsSma20Percent: 0, relativeVolume: 2, liquidityScore: 80, brokerFlowScore: 80, signal: 'confirmed_uptrend', marketRegime: 'bullish', marketGateBlocked: false, hardRiskFlags: [], confidence: 80, dataCompleteness: 90, generatedAt: '2026-09-07T03:00:00Z', orderbookGeneratedAt: '2026-09-07T03:00:00Z', now: new Date('2026-09-07T03:00:00Z') };
  const base = calculateTradingDecision(input), oldNews = calculateTradingDecision({ ...input, aiStoryGeneratedAt: '2025-01-01T00:00:00Z' });
  assert.equal(oldNews.confidence, base.confidence); assert.equal(oldNews.verdict, base.verdict);
});
