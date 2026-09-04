import type { AnalysisComponent, AnalysisQuality, FreshnessAssessment, FreshnessSource, ReliabilityAssessment, SignalAgreement, SignalConflict, SignalDirection } from './types';

export const ANALYSIS_QUALITY_VERSION = 'quality-v1';
export const DIRECTION_THRESHOLDS = Object.freeze({ bullish: 65, bearish: 45 });
export const AGREEMENT_THRESHOLDS = Object.freeze({ strong: 75, moderate: 55, mixed: 35, minimumComponents: 2 });
export const CONFIDENCE_WEIGHTS = Object.freeze({ completeness: 0.30, agreement: 0.25, freshness: 0.20, reliability: 0.25 });
export const CONFIDENCE_PENALTIES = Object.freeze({ highConflict: 15, hardRisk: 20, fallback: 10, smallCalibrationSample: 10 });
export const CONFIDENCE_CAPS = Object.freeze({ missingTechnical: 35, tooFewComponents: 45, highConflict: 55, staleRealtime: 55, unknownCriticalFreshness: 65, fallback: 65, lowCompleteness: 60 });
export const FRESHNESS_WEIGHTS: Record<FreshnessSource, number> = Object.freeze({ orderbook: 20, marketPrice: 20, brokerSummary: 15, historicalPrice: 15, fundamental: 10, catalyst: 10, benchmark: 10 });

const clamp = (value: number, min = 0, max = 100) => Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : min;
const round = (value: number) => Math.round(clamp(value));

export function calculateComponentCoverage(requiredMetrics: string[], values: Record<string, unknown>) {
  const availableMetrics = requiredMetrics.filter((key) => values[key] !== null && values[key] !== undefined && !(typeof values[key] === 'number' && !Number.isFinite(values[key] as number)));
  const missingMetrics = requiredMetrics.filter((key) => !availableMetrics.includes(key));
  return { coverage: requiredMetrics.length ? round(availableMetrics.length / requiredMetrics.length * 100) : 0, requiredMetrics, availableMetrics, missingMetrics };
}

export function normalizeComponentDirection(score: number | null, hardNegative = false): { direction: SignalDirection; directionalValue: number | null } {
  if (score === null || !Number.isFinite(score)) return { direction: 'unavailable', directionalValue: null };
  const value = Math.max(-1, Math.min(1, (score - 50) / 50));
  if (hardNegative) return { direction: 'bearish', directionalValue: Math.min(-0.5, value) };
  return { direction: score >= DIRECTION_THRESHOLDS.bullish ? 'bullish' : score < DIRECTION_THRESHOLDS.bearish ? 'bearish' : 'neutral', directionalValue: score >= DIRECTION_THRESHOLDS.bullish || score < DIRECTION_THRESHOLDS.bearish ? value : 0 };
}

export function detectSignalConflicts(components: AnalysisComponent[], hardRiskFlags: string[] = []): SignalConflict[] {
  const byKey = new Map(components.map((component) => [component.key, component]));
  const conflicts: SignalConflict[] = [];
  const opposed = (a: AnalysisComponent['key'], b: AnalysisComponent['key'], key: string, message: string, severity: SignalConflict['severity'] = 'high') => {
    const left = byKey.get(a)?.direction, right = byKey.get(b)?.direction;
    if ((left === 'bullish' && right === 'bearish') || (left === 'bearish' && right === 'bullish')) conflicts.push({ key, severity, components: [a, b], message });
  };
  opposed('technical', 'brokerFlow', 'technical-broker-opposition', 'Teknikal dan broker flow menunjukkan arah yang berlawanan.');
  opposed('technical', 'marketRegime', 'technical-market-opposition', 'Teknikal saham berlawanan dengan market regime.');
  opposed('catalyst', 'fundamental', 'catalyst-fundamental-opposition', 'Katalis dan fundamental menunjukkan arah yang berlawanan.', 'medium');
  opposed('liquidity', 'technical', 'orderbook-trend-opposition', 'Orderbook dan tren menengah menunjukkan arah yang berlawanan.', 'medium');
  const technical = byKey.get('technical');
  const r5 = technical?.metrics.find((metric) => metric.key === 'return5d')?.value;
  const volume = technical?.metrics.find((metric) => metric.key === 'volumeRatio')?.value;
  if (typeof r5 === 'number' && r5 > 0 && typeof volume === 'number' && volume < 0.8) conflicts.push({ key: 'momentum-without-volume', severity: 'medium', components: ['technical'], message: 'Momentum harga bullish tidak dikonfirmasi volume.' });
  if (hardRiskFlags.length) conflicts.push({ key: 'hard-risk-active', severity: 'high', components: [], message: `Hard risk aktif: ${hardRiskFlags.join('; ')}` });
  return conflicts;
}

export function calculateSignalAgreement(components: AnalysisComponent[], conflicts: SignalConflict[] = []): SignalAgreement {
  const comparable = components.filter((component) => component.available && component.direction !== 'unavailable' && component.directionalValue !== null && Number.isFinite(component.directionalValue));
  const effective = comparable.map((component) => ({ ...component, effectiveWeight: component.weight * clamp(component.coverage ?? 100) / 100 }));
  const total = effective.reduce((sum, component) => sum + component.effectiveWeight, 0);
  const weightFor = (direction: SignalDirection) => effective.filter((component) => component.direction === direction).reduce((sum, component) => sum + component.effectiveWeight, 0);
  const bullishWeight = weightFor('bullish'), neutralWeight = weightFor('neutral'), bearishWeight = weightFor('bearish');
  const activeDirectionalWeight = bullishWeight + bearishWeight;
  if (comparable.length < AGREEMENT_THRESHOLDS.minimumComponents || total <= 0) return { score: null, label: 'unavailable', dominantDirection: comparable[0]?.direction ?? 'unavailable', bullishWeight: round(bullishWeight), neutralWeight: round(neutralWeight), bearishWeight: round(bearishWeight), activeDirectionalWeight: round(activeDirectionalWeight), conflicts, explanation: 'Minimal dua komponen diperlukan untuk membandingkan arah sinyal.' };
  const directionalSum = effective.reduce((sum, component) => sum + component.effectiveWeight * (component.directionalValue ?? 0), 0);
  const directionalStrength = activeDirectionalWeight / total;
  const score = round(Math.abs(directionalSum) / total * 100 * directionalStrength);
  const dominantDirection: SignalDirection = activeDirectionalWeight === 0 ? 'neutral' : directionalSum > 0 ? 'bullish' : directionalSum < 0 ? 'bearish' : 'neutral';
  const label: SignalAgreement['label'] = score >= AGREEMENT_THRESHOLDS.strong ? 'strong' : score >= AGREEMENT_THRESHOLDS.moderate ? 'moderate' : score >= AGREEMENT_THRESHOLDS.mixed ? 'mixed' : 'conflicting';
  return { score, label, dominantDirection, bullishWeight: round(bullishWeight), neutralWeight: round(neutralWeight), bearishWeight: round(bearishWeight), activeDirectionalWeight: round(activeDirectionalWeight), conflicts, explanation: activeDirectionalWeight === 0 ? 'Semua komponen netral; tidak ada kekuatan arah aktif.' : `Konsensus ${dominantDirection} dihitung dari bobot efektif dan coverage komponen.` };
}

export const FRESHNESS_THRESHOLDS: Record<FreshnessSource, { fresh: number; stale: number }> = Object.freeze({
  orderbook: { fresh: 300, stale: 900 }, marketPrice: { fresh: 300, stale: 1800 }, brokerSummary: { fresh: 86400, stale: 259200 }, historicalPrice: { fresh: 172800, stale: 604800 }, fundamental: { fresh: 2592000, stale: 10368000 }, catalyst: { fresh: 86400, stale: 259200 }, benchmark: { fresh: 172800, stale: 604800 },
});

export function calculateFreshness(source: FreshnessSource, observedAt: string | null | undefined, now: Date): FreshnessAssessment {
  const timestamp = observedAt ? new Date(observedAt).getTime() : NaN;
  if (!Number.isFinite(timestamp)) return { source, observedAt: null, ageSeconds: null, ageDays: null, freshnessScore: null, status: 'unknown' };
  const ageSeconds = Math.max(0, (now.getTime() - timestamp) / 1000);
  const { fresh, stale } = FRESHNESS_THRESHOLDS[source];
  const status = ageSeconds <= fresh ? 'fresh' : ageSeconds <= stale ? 'aging' : 'stale';
  const freshnessScore = ageSeconds <= fresh ? 100 : ageSeconds >= stale ? 0 : round(100 * (stale - ageSeconds) / (stale - fresh));
  return { source, observedAt: new Date(timestamp).toISOString(), ageSeconds: Math.round(ageSeconds), ageDays: Math.round(ageSeconds / 864) / 100, freshnessScore, status };
}

export function calculateReliability(input: { components: AnalysisComponent[]; historySamples: number; brokerHistorySamples: number; catalystConfidence?: number | null; fallbackUsed?: boolean }): ReliabilityAssessment {
  const issues: string[] = [];
  const componentValidity = input.components.length ? input.components.reduce((sum, component) => sum + (component.reliability?.score ?? component.coverage ?? 0) * component.weight, 0) / input.components.reduce((sum, component) => sum + component.weight, 0) : 0;
  const historyQuality = clamp(input.historySamples / 30 * 100);
  const brokerQuality = clamp(input.brokerHistorySamples / 10 * 100);
  if (input.historySamples < 20) issues.push('Sampel harga historis kurang dari 20 sesi.');
  if (input.brokerHistorySamples < 5) issues.push('Sampel persistensi broker terbatas.');
  if (input.fallbackUsed) issues.push('Sebagian kalkulasi menggunakan fallback.');
  const catalystQuality = input.catalystConfidence == null ? null : clamp(input.catalystConfidence);
  const factors = [componentValidity, historyQuality, brokerQuality, ...(catalystQuality === null ? [] : [catalystQuality])];
  return { score: round(factors.reduce((sum, value) => sum + value, 0) / factors.length), issues, fallbackUsed: Boolean(input.fallbackUsed), sampleSizes: { historicalPrice: input.historySamples, brokerHistory: input.brokerHistorySamples } };
}

export function calculateAnalysisConfidence(input: { completeness: number; agreement: SignalAgreement; freshness: number | null; reliability: ReliabilityAssessment; components: AnalysisComponent[]; conflicts: SignalConflict[]; hardRiskFlag?: boolean; calibrationSampleSize?: number }): number {
  const agreement = input.agreement.score ?? 0, freshness = input.freshness ?? 0;
  let result = input.completeness * CONFIDENCE_WEIGHTS.completeness + agreement * CONFIDENCE_WEIGHTS.agreement + freshness * CONFIDENCE_WEIGHTS.freshness + input.reliability.score * CONFIDENCE_WEIGHTS.reliability;
  const highConflict = input.conflicts.some((conflict) => conflict.severity === 'high');
  if (highConflict) result -= CONFIDENCE_PENALTIES.highConflict;
  if (input.hardRiskFlag) result -= CONFIDENCE_PENALTIES.hardRisk;
  if (input.reliability.fallbackUsed) result -= CONFIDENCE_PENALTIES.fallback;
  if (input.calibrationSampleSize !== undefined && input.calibrationSampleSize < 30) result -= CONFIDENCE_PENALTIES.smallCalibrationSample;
  const active = input.components.filter((component) => component.available).length;
  const caps = [100];
  if (!input.components.find((component) => component.key === 'technical')?.available) caps.push(CONFIDENCE_CAPS.missingTechnical);
  if (active < 2) caps.push(CONFIDENCE_CAPS.tooFewComponents);
  if (highConflict) caps.push(CONFIDENCE_CAPS.highConflict);
  if (input.components.some((component) => ['technical', 'liquidity'].includes(component.key) && component.freshness?.status === 'stale')) caps.push(CONFIDENCE_CAPS.staleRealtime);
  if (input.components.some((component) => component.available && ['technical', 'liquidity'].includes(component.key) && component.freshness?.status === 'unknown')) caps.push(CONFIDENCE_CAPS.unknownCriticalFreshness);
  if (input.reliability.fallbackUsed) caps.push(CONFIDENCE_CAPS.fallback);
  if (input.completeness < 50) caps.push(CONFIDENCE_CAPS.lowCompleteness);
  return round(Math.min(result, ...caps));
}

export function buildAnalysisQuality(input: { components: AnalysisComponent[]; now: Date; freshness: FreshnessAssessment[]; historySamples: number; brokerHistorySamples: number; catalystConfidence?: number | null; hardRiskFlags?: string[]; fallbackUsed?: boolean; calibrationSampleSize?: number }): AnalysisQuality {
  const totalWeight = input.components.reduce((sum, component) => sum + component.weight, 0);
  const completeness = totalWeight ? round(input.components.reduce((sum, component) => sum + component.weight * clamp(component.coverage ?? (component.available ? 100 : 0)), 0) / totalWeight) : 0;
  const conflicts = detectSignalConflicts(input.components, input.hardRiskFlags);
  const agreement = calculateSignalAgreement(input.components, conflicts);
  const knownFreshness = input.freshness.filter((item) => item.freshnessScore !== null);
  const freshnessWeight = knownFreshness.reduce((sum, item) => sum + FRESHNESS_WEIGHTS[item.source], 0);
  const freshnessScore = freshnessWeight ? round(knownFreshness.reduce((sum, item) => sum + item.freshnessScore! * FRESHNESS_WEIGHTS[item.source], 0) / freshnessWeight) : null;
  const reliability = calculateReliability({ components: input.components, historySamples: input.historySamples, brokerHistorySamples: input.brokerHistorySamples, catalystConfidence: input.catalystConfidence, fallbackUsed: input.fallbackUsed });
  const confidence = calculateAnalysisConfidence({ completeness, agreement, freshness: freshnessScore, reliability, components: input.components, conflicts, hardRiskFlag: Boolean(input.hardRiskFlags?.length), calibrationSampleSize: input.calibrationSampleSize });
  const warnings = [...reliability.issues, ...input.freshness.filter((item) => item.status === 'unknown').map((item) => `Freshness ${item.source} tidak diketahui.`)];
  return { completeness, agreement, confidence, freshness: { score: freshnessScore, sources: input.freshness }, reliability, dominantDirection: agreement.dominantDirection, activeComponentCount: input.components.filter((component) => component.available).length, conflicts, warnings, calculatedAt: input.now.toISOString(), methodologyVersion: ANALYSIS_QUALITY_VERSION };
}
