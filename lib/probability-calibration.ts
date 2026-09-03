/** Legacy breadth labels remain accepted so historical v2 cohorts stay readable. */
export type MarketRegime = 'bull' | 'sideways' | 'bear' | 'bullish' | 'neutral' | 'bearish' | 'unavailable';

export interface CalibrationObservation {
  score: number;
  modelVersion: string;
  marketRegime: MarketRegime;
  return10d: number;
}

export interface CalibratedProbability {
  probability: number;
  sampleSize: number;
  modelVersion: string;
  marketRegime: MarketRegime;
  scoreBucket: { low: number; high: number };
}

export const scoreBucket = (score: number) => {
  const bounded = Math.min(100, Math.max(0, score));
  const low = Math.min(90, Math.floor(bounded / 10) * 10);
  return { low, high: low === 90 ? 101 : low + 10 };
};

export function calibrateProbability(
  observations: CalibrationObservation[],
  score: number,
  modelVersion: string,
  marketRegime: MarketRegime,
  minimumSampleSize = 30,
): CalibratedProbability | null {
  const bucket = scoreBucket(score);
  const cohort = observations.filter((row) =>
    row.modelVersion === modelVersion
    && row.marketRegime === marketRegime
    && row.score >= bucket.low
    && row.score < bucket.high
    && Number.isFinite(row.return10d),
  );
  if (cohort.length < minimumSampleSize) return null;
  return {
    probability: cohort.filter((row) => row.return10d > 0).length / cohort.length,
    sampleSize: cohort.length,
    modelVersion,
    marketRegime,
    scoreBucket: bucket,
  };
}

export function classifyMarketRegime(rows: Array<{ aboveSma20: boolean; return5d: number | null }>): MarketRegime {
  if (!rows.length) return 'sideways';
  const aboveSmaBreadth = rows.filter((row) => row.aboveSma20).length / rows.length;
  const knownMomentum = rows.filter((row): row is { aboveSma20: boolean; return5d: number } => row.return5d !== null && Number.isFinite(row.return5d));
  const positiveMomentumBreadth = knownMomentum.length
    ? knownMomentum.filter((row) => row.return5d > 0).length / knownMomentum.length
    : 0.5;
  const breadth = (aboveSmaBreadth + positiveMomentumBreadth) / 2;
  if (breadth >= 0.6) return 'bull';
  if (breadth <= 0.4) return 'bear';
  return 'sideways';
}
