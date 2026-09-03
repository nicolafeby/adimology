import type { HistoricalSummaryItem } from './stockbit';
import type { MarketRegimeAnalysis, RelativeStrengthAnalysis, RelativeStrengthLabel, TrendSignal } from './types';

/** Central calibration knobs. Percent values use percentage points, not decimals. */
export const MARKET_REGIME_THRESHOLDS = {
  minimumSessions: 21, // Required for a true 20-session return.
  trendLookbackSessions: 5, // Compares today's SMA20 with SMA20 five sessions ago.
  bullishScore: 65,
  bearishScore: 40,
  positiveReturn5d: 0,
  strongReturn20d: 3,
  relativeVolumeConfirmation: 1.1,
} as const;

export const RELATIVE_STRENGTH_THRESHOLDS = {
  strong5d: 2,
  strong20d: 5,
  moderate5d: 0,
  moderate20d: 0,
  exceptional5d: 4,
  exceptional20d: 8,
  exceptionalRelativeVolume: 1.2,
  exceptionalBrokerFlow: 60,
  exceptionalCompleteness: 75,
} as const;

export interface HistoricalFeatures {
  sessions: number;
  latestClose: number | null;
  return5d: number | null;
  return20d: number | null;
  sma20: number | null;
  priceVsSma20: number | null;
  sma20Trend: number | null;
  relativeVolume: number | null;
}

const round = (value: number, digits = 2) => Number(value.toFixed(digits));
const sortedRows = (history: HistoricalSummaryItem[]) => [...history]
  .filter((row) => Number.isFinite(row.close) && row.close > 0)
  .sort((a, b) => a.date.localeCompare(b.date));

export function calculateHistoricalFeatures(history: HistoricalSummaryItem[]): HistoricalFeatures {
  const rows = sortedRows(history);
  const latest = rows.at(-1);
  if (!latest) return { sessions: 0, latestClose: null, return5d: null, return20d: null, sma20: null, priceVsSma20: null, sma20Trend: null, relativeVolume: null };
  const returnAt = (sessions: number) => rows.length > sessions
    ? round((latest.close / rows[rows.length - 1 - sessions].close - 1) * 100)
    : null;
  const sma = (endExclusive: number) => {
    if (endExclusive < 20) return null;
    const window = rows.slice(endExclusive - 20, endExclusive);
    return window.reduce((sum, row) => sum + row.close, 0) / 20;
  };
  const sma20 = sma(rows.length);
  const previousSma20 = sma(rows.length - MARKET_REGIME_THRESHOLDS.trendLookbackSessions);
  const volumes = rows.slice(-20).map((row) => row.volume).filter((value) => Number.isFinite(value) && value > 0);
  const averageVolume = volumes.length === 20 ? volumes.reduce((sum, value) => sum + value, 0) / 20 : null;
  return {
    sessions: rows.length,
    latestClose: latest.close,
    return5d: returnAt(5),
    return20d: returnAt(20),
    sma20: sma20 === null ? null : round(sma20),
    priceVsSma20: sma20 === null ? null : round((latest.close / sma20 - 1) * 100),
    sma20Trend: sma20 === null || previousSma20 === null ? null : round((sma20 / previousSma20 - 1) * 100),
    relativeVolume: averageVolume && latest.volume > 0 ? round(latest.volume / averageVolume) : null,
  };
}

export function calculateMarketRegime(history: HistoricalSummaryItem[]): MarketRegimeAnalysis {
  const features = calculateHistoricalFeatures(history);
  const values = [features.priceVsSma20, features.return5d, features.return20d, features.sma20Trend];
  const known = values.filter((value): value is number => value !== null);
  const completeness = Math.round(known.length / values.length * 100);
  if (features.sessions < MARKET_REGIME_THRESHOLDS.minimumSessions || features.priceVsSma20 === null || features.return20d === null) {
    return { label: 'unavailable', score: null, reasons: [`Histori IHSG hanya ${features.sessions} sesi; minimal ${MARKET_REGIME_THRESHOLDS.minimumSessions} sesi diperlukan.`], dataCompleteness: completeness, features };
  }
  let score = 50;
  score += features.priceVsSma20 >= 0 ? 15 : -15;
  score += (features.return5d ?? 0) > MARKET_REGIME_THRESHOLDS.positiveReturn5d ? 10 : -10;
  score += features.return20d >= MARKET_REGIME_THRESHOLDS.strongReturn20d ? 15 : features.return20d < 0 ? -15 : 0;
  if (features.sma20Trend !== null) score += features.sma20Trend > 0 ? 10 : features.sma20Trend < 0 ? -10 : 0;
  if (features.relativeVolume !== null && features.relativeVolume >= MARKET_REGIME_THRESHOLDS.relativeVolumeConfirmation) {
    score += Math.sign(features.return5d ?? 0) * 5;
  }
  score = Math.max(0, Math.min(100, Math.round(score)));
  const label = score >= MARKET_REGIME_THRESHOLDS.bullishScore ? 'bullish' : score <= MARKET_REGIME_THRESHOLDS.bearishScore ? 'bearish' : 'neutral';
  const reasons = [
    `IHSG ${features.priceVsSma20 >= 0 ? 'di atas' : 'di bawah'} SMA20 (${features.priceVsSma20 >= 0 ? '+' : ''}${features.priceVsSma20}%).`,
    `Return IHSG 5D ${features.return5d! >= 0 ? '+' : ''}${features.return5d}% dan 20D ${features.return20d >= 0 ? '+' : ''}${features.return20d}%.`,
    features.sma20Trend === null ? 'Tren SMA20 belum tersedia.' : `Tren SMA20 ${features.sma20Trend >= 0 ? 'naik' : 'turun'} ${Math.abs(features.sma20Trend)}%.`,
  ];
  return { label, score, reasons, dataCompleteness: completeness, features };
}

export function calculateRelativeStrength(stockHistory: HistoricalSummaryItem[], marketHistory: HistoricalSummaryItem[], sectorHistory?: HistoricalSummaryItem[]): RelativeStrengthAnalysis {
  const stock = calculateHistoricalFeatures(stockHistory);
  const market = calculateHistoricalFeatures(marketHistory);
  const sector = sectorHistory ? calculateHistoricalFeatures(sectorHistory) : null;
  const subtract = (left: number | null, right: number | null) => left === null || right === null ? null : round(left - right);
  const rs5d = subtract(stock.return5d, market.return5d);
  const rs20d = subtract(stock.return20d, market.return20d);
  const sectorRs5d = sector ? subtract(stock.return5d, sector.return5d) : null;
  const sectorRs20d = sector ? subtract(stock.return20d, sector.return20d) : null;
  let label: RelativeStrengthLabel = 'unavailable';
  if (rs5d !== null && rs20d !== null) {
    label = rs5d >= RELATIVE_STRENGTH_THRESHOLDS.strong5d && rs20d >= RELATIVE_STRENGTH_THRESHOLDS.strong20d
      ? 'strong'
      : rs5d >= RELATIVE_STRENGTH_THRESHOLDS.moderate5d && rs20d >= RELATIVE_STRENGTH_THRESHOLDS.moderate20d ? 'moderate' : 'weak';
  }
  return { label, rs5d, rs20d, sectorRs5d, sectorRs20d, stockReturn5d: stock.return5d, stockReturn20d: stock.return20d, marketReturn5d: market.return5d, marketReturn20d: market.return20d, sectorReturn5d: sector?.return5d ?? null, sectorReturn20d: sector?.return20d ?? null, dataCompleteness: Math.round([rs5d, rs20d].filter((value) => value !== null).length / 2 * 100) };
}

export function hasExceptionalRelativeStrength(input: { relativeStrength: RelativeStrengthAnalysis; relativeVolume: number | null; brokerFlowScore: number | null; dataCompleteness: number }): boolean {
  const { relativeStrength: rs } = input;
  return rs.rs5d !== null && rs.rs20d !== null
    && rs.rs5d >= RELATIVE_STRENGTH_THRESHOLDS.exceptional5d
    && rs.rs20d >= RELATIVE_STRENGTH_THRESHOLDS.exceptional20d
    && input.relativeVolume !== null && input.relativeVolume >= RELATIVE_STRENGTH_THRESHOLDS.exceptionalRelativeVolume
    && input.brokerFlowScore !== null && input.brokerFlowScore >= RELATIVE_STRENGTH_THRESHOLDS.exceptionalBrokerFlow
    && input.dataCompleteness >= RELATIVE_STRENGTH_THRESHOLDS.exceptionalCompleteness;
}

export function applyMarketRegimeGate(input: { signal: TrendSignal; marketRegime: MarketRegimeAnalysis; relativeStrength: RelativeStrengthAnalysis; relativeVolume: number | null; brokerFlowScore: number | null; dataCompleteness: number; confidence?: number }) {
  const exceptional = hasExceptionalRelativeStrength(input);
  let signalAfterGate = input.signal;
  let applied = false;
  let confidenceAdjustment = 0;
  let reason = 'Market regime hanya menjadi modifier; tidak menaikkan sinyal dasar.';
  const riskFlags: string[] = [];
  if (input.marketRegime.label === 'unavailable') {
    confidenceAdjustment = -15;
    riskFlags.push('Market regime IHSG tidak tersedia; confidence perlu diturunkan');
    reason = 'Market regime tidak tersedia; sinyal tidak dinaikkan dan diberi risk flag.';
  } else if (input.marketRegime.label === 'bearish' && input.signal === 'confirmed_uptrend' && !exceptional) {
    signalAfterGate = input.dataCompleteness >= 70 && input.relativeStrength.label !== 'weak' && input.relativeStrength.label !== 'unavailable' ? 'early_uptrend' : 'watch';
    applied = true;
    reason = input.relativeStrength.rs20d !== null && input.relativeStrength.rs20d > 0
      ? 'Saham mengungguli IHSG, tetapi belum memenuhi exceptional-strength gate.'
      : 'Regime IHSG bearish dan relative strength belum cukup untuk mempertahankan konfirmasi.';
    riskFlags.push('Confirmed Uptrend dibatasi oleh regime IHSG bearish');
  } else if (input.marketRegime.label === 'bearish' && input.signal === 'confirmed_uptrend' && exceptional) {
    reason = 'Exceptional relative strength terpenuhi; sinyal dasar dipertahankan meski IHSG bearish.';
  }
  const confidenceBefore = typeof input.confidence === 'number' ? input.confidence : null;
  const confidenceAfter = confidenceBefore === null ? null : Math.max(0, Math.min(100, confidenceBefore + confidenceAdjustment));
  return { applied, signalBeforeGate: input.signal, signalAfterGate, exceptionalStrength: exceptional, reason, confidenceAdjustment, confidenceBefore, confidenceAfter, riskFlags };
}
