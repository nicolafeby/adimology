import type { BacktestSummary } from './types';

const mean = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
const rate = (values: Array<boolean | null>) => {
  const known = values.filter((value): value is boolean => value !== null);
  return known.length ? known.filter(Boolean).length / known.length : null;
};

export function summarizeBacktest(rows: Array<Record<string, unknown>>): BacktestSummary {
  const numeric = (key: string) => rows.map((row) => row[key]).filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  const probabilityRows = rows.filter((row) => typeof row.model_probability === 'number' && typeof row.return_10d === 'number');
  return {
    sampleSize: rows.length,
    winRate5d: rate(rows.map((row) => typeof row.return_5d === 'number' ? row.return_5d > 0 : null)),
    winRate10d: rate(rows.map((row) => typeof row.return_10d === 'number' ? row.return_10d > 0 : null)),
    winRate20d: rate(rows.map((row) => typeof row.return_20d === 'number' ? row.return_20d > 0 : null)),
    averageReturn10d: mean(numeric('return_10d')),
    targetHitRate: rate(rows.map((row) => typeof row.target_hit === 'boolean' ? row.target_hit : null)),
    stopHitRate: rate(rows.map((row) => typeof row.stop_hit === 'boolean' ? row.stop_hit : null)),
    brierScore: probabilityRows.length ? mean(probabilityRows.map((row) => Math.pow(Number(row.model_probability) - (Number(row.return_10d) > 0 ? 1 : 0), 2))) : null,
  };
}
