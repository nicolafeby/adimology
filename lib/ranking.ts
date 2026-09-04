import type { AnalysisComponent, ComprehensiveAnalysis, RankingReason, TrendSignal } from './types';
import type { HistoricalSummaryItem } from './stockbit';
import { applyMarketRegimeGate } from './market-regime';
import type { MarketRegimeAnalysis, RelativeStrengthAnalysis } from './types';

export const RANKING_QUALITY_THRESHOLDS = Object.freeze({ minimumCompleteness: 60, preferredCompleteness: 70, minimumConfidence: 45, confirmedConfidence: 65 });

const metricNumber = (components: AnalysisComponent[], key: string) => {
  for (const component of components) {
    const value = component.metrics.find((item) => item.key === key)?.value;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return null;
};

export interface PreScreenResult {
  passed: boolean;
  score: number;
  lastPrice: number;
  averageValue20d: number;
  return5d: number | null;
  relativeVolume: number;
  aboveSma20: boolean;
  atrPercent: number;
  reasons: string[];
}

export function preScreenHistory(history: HistoricalSummaryItem[]): PreScreenResult {
  const rows = [...history].filter((row) => row.close > 0).sort((a, b) => a.date.localeCompare(b.date));
  if (rows.length < 20) return { passed: false, score: 0, lastPrice: rows.at(-1)?.close ?? 0, averageValue20d: 0, return5d: null, relativeVolume: 0, aboveSma20: false, atrPercent: 0, reasons: ['Data historis kurang dari 20 sesi'] };
  const latest = rows.at(-1)!;
  const window20 = rows.slice(-20);
  const sma20 = window20.reduce((sum, row) => sum + row.close, 0) / 20;
  const averageVolume = window20.reduce((sum, row) => sum + row.volume, 0) / 20;
  const averageValue20d = window20.reduce((sum, row) => sum + (row.value || row.close * row.volume), 0) / 20;
  const relativeVolume = averageVolume > 0 ? latest.volume / averageVolume : 0;
  const return5d = rows.length > 5 ? (latest.close / rows[rows.length - 6].close - 1) * 100 : null;
  const atrRanges = rows.slice(-15).slice(1).map((row, index) => {
    const previous = rows.slice(-15)[index];
    return Math.max(row.high - row.low, Math.abs(row.high - previous.close), Math.abs(row.low - previous.close));
  });
  const atrPercent = atrRanges.length ? atrRanges.reduce((a, b) => a + b, 0) / atrRanges.length / latest.close * 100 : 0;
  const aboveSma20 = latest.close >= sma20;
  const reasons = [
    aboveSma20 ? 'Harga di atas MA20' : 'Harga di bawah MA20',
    `Relative volume ${relativeVolume.toFixed(2)}x`,
    `Return 5 hari ${(return5d ?? 0).toFixed(1)}%`,
  ];
  let score = 0;
  if (aboveSma20) score += 35;
  if ((return5d ?? -1) > 0) score += 25;
  score += Math.min(25, relativeVolume * 12.5);
  if (averageValue20d >= 1_000_000_000) score += 15;
  const passed = averageValue20d >= 1_000_000_000 && aboveSma20 && (return5d ?? 0) > 0 && relativeVolume >= 1.2 && atrPercent <= 8;
  return { passed, score: Math.round(score), lastPrice: latest.close, averageValue20d, return5d, relativeVolume, aboveSma20, atrPercent, reasons };
}

export function classifyTrend(analysis: ComprehensiveAnalysis): { signal: TrendSignal; reasons: RankingReason[]; riskFlags: string[] } {
  const volume = metricNumber(analysis.components, 'volumeRatio');
  const r5 = metricNumber(analysis.components, 'return5d');
  const imbalance = metricNumber(analysis.components, 'nearImbalance');
  const atr = metricNumber(analysis.components, 'atr');
  const broker = analysis.components.find((item) => item.key === 'brokerFlow')?.score ?? null;
  const liquidity = analysis.components.find((item) => item.key === 'liquidity')?.score ?? null;
  const reasons: RankingReason[] = [];
  if (r5 !== null) reasons.push({ label: 'Momentum 5 hari', value: `${r5.toFixed(1)}%`, positive: r5 > 0 });
  if (volume !== null) reasons.push({ label: 'Relative volume', value: `${volume.toFixed(2)}x`, positive: volume >= 1.2 });
  if (broker !== null) reasons.push({ label: 'Broker flow', value: `${broker}/100`, positive: broker >= 60 });
  if (imbalance !== null) reasons.push({ label: 'Orderbook imbalance', value: `${imbalance.toFixed(1)}%`, positive: imbalance >= 15 });
  const riskFlags: string[] = [];
  if (atr !== null && atr > 8) riskFlags.push(`Volatilitas tinggi (${atr.toFixed(1)}%)`);
  if (liquidity !== null && liquidity < 50) riskFlags.push('Likuiditas/orderbook lemah');
  if (analysis.dataCompleteness < 70) riskFlags.push('Data belum cukup lengkap');
  if (analysis.confidence < RANKING_QUALITY_THRESHOLDS.minimumConfidence) riskFlags.push('Confidence analisis rendah');
  for (const conflict of analysis.quality?.conflicts ?? []) if (conflict.severity === 'high') riskFlags.push(conflict.message);
  let signal: TrendSignal = 'watch';
  if (analysis.quality?.dominantDirection === 'bearish' || analysis.dataCompleteness < RANKING_QUALITY_THRESHOLDS.minimumCompleteness || analysis.score < 45 || riskFlags.length >= 2) signal = 'avoid';
  else if (analysis.score >= 70 && analysis.confidence >= RANKING_QUALITY_THRESHOLDS.confirmedConfidence && !(analysis.quality?.conflicts.some((conflict) => conflict.severity === 'high')) && (volume ?? 0) >= 1.2 && (broker ?? 0) >= 60) signal = 'confirmed_uptrend';
  else if (analysis.score >= 60 && (r5 ?? 0) > 0) signal = 'early_uptrend';
  return { signal, reasons: reasons.slice(0, 4), riskFlags };
}

export function classifyTrendWithMarketGate(analysis: ComprehensiveAnalysis, marketRegime: MarketRegimeAnalysis, relativeStrength: RelativeStrengthAnalysis) {
  const base = classifyTrend(analysis);
  const gate = applyMarketRegimeGate({
    signal: base.signal,
    marketRegime,
    relativeStrength,
    relativeVolume: metricNumber(analysis.components, 'volumeRatio'),
    brokerFlowScore: analysis.components.find((item) => item.key === 'brokerFlow')?.score ?? null,
    liquidityScore: analysis.components.find((item) => item.key === 'liquidity')?.score ?? null,
    stockReturn5d: metricNumber(analysis.components, 'return5d'),
    distanceFromSma20: metricNumber(analysis.components, 'sma20'),
    dataCompleteness: analysis.dataCompleteness,
    hardRiskFlags: base.riskFlags,
    confidence: analysis.confidence,
  });
  const reasons = [...base.reasons];
  if (relativeStrength.rs20d !== null) reasons.push({ label: 'RS vs IHSG 20D', value: `${relativeStrength.rs20d >= 0 ? '+' : ''}${relativeStrength.rs20d.toFixed(1)}%`, positive: relativeStrength.rs20d > 0 });
  return { signal: gate.signalAfterGate, reasons: reasons.slice(0, 5), riskFlags: [...base.riskFlags, ...gate.riskFlags], gate };
}

export function rankingScore(analysis: ComprehensiveAnalysis, probability: number | null): number {
  return probability === null ? analysis.score : analysis.score * 0.7 + probability * 100 * 0.3;
}
