import type { BacktestSummary } from './types';

export interface BacktestCostOptions {
  buyFeePercent?: number;
  sellFeePercent?: number;
  slippagePercentPerSide?: number;
}

// Conservative defaults for an IDX retail trade. All values are percentages.
export const DEFAULT_BACKTEST_COSTS = {
  buyFeePercent: 0.15,
  sellFeePercent: 0.25,
  slippagePercentPerSide: 0.1,
} as const;

const mean = (values: number[]) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
const rate = (values: Array<boolean | null>) => {
  const known = values.filter((value): value is boolean => value !== null);
  return known.length ? known.filter(Boolean).length / known.length : null;
};

const finiteNonNegative = (value: number | undefined, fallback: number) =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback;

export function netReturnPercent(grossReturnPercent: number, options: BacktestCostOptions = {}): number {
  const buyFee = finiteNonNegative(options.buyFeePercent, DEFAULT_BACKTEST_COSTS.buyFeePercent) / 100;
  const sellFee = finiteNonNegative(options.sellFeePercent, DEFAULT_BACKTEST_COSTS.sellFeePercent) / 100;
  const slippage = finiteNonNegative(options.slippagePercentPerSide, DEFAULT_BACKTEST_COSTS.slippagePercentPerSide) / 100;
  if (buyFee === 0 && sellFee === 0 && slippage === 0) return grossReturnPercent;
  // Entry is paid above the reference price; exit is received below it.
  return (((1 + grossReturnPercent / 100) * (1 - slippage) * (1 - sellFee)) / ((1 + slippage) * (1 + buyFee)) - 1) * 100;
}

const maximumDrawdown = (returns: number[]) => {
  if (!returns.length) return null;
  let equity = 1;
  let peak = 1;
  let worst = 0;
  for (const value of returns) {
    equity *= Math.max(0, 1 + value / 100);
    peak = Math.max(peak, equity);
    worst = Math.max(worst, (peak - equity) / peak);
  }
  return worst * 100;
};

export function summarizeBacktest(rows: Array<Record<string, unknown>>, options: BacktestCostOptions = {}): BacktestSummary {
  const numeric = (key: string) => rows.map((row) => row[key]).filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  const costs = {
    buyFeePercent: finiteNonNegative(options.buyFeePercent, DEFAULT_BACKTEST_COSTS.buyFeePercent),
    sellFeePercent: finiteNonNegative(options.sellFeePercent, DEFAULT_BACKTEST_COSTS.sellFeePercent),
    slippagePercentPerSide: finiteNonNegative(options.slippagePercentPerSide, DEFAULT_BACKTEST_COSTS.slippagePercentPerSide),
  };
  const withNetReturn = (key: string) => numeric(key).map((value) => netReturnPercent(value, costs));
  const net5d = withNetReturn('return_5d');
  const net10d = withNetReturn('return_10d');
  const net20d = withNetReturn('return_20d');
  const chronologicalNet10d = rows
    .filter((row) => typeof row.return_10d === 'number' && Number.isFinite(row.return_10d))
    .sort((a, b) => String(a.signal_date ?? a.evaluated_at ?? '').localeCompare(String(b.signal_date ?? b.evaluated_at ?? '')))
    .map((row) => netReturnPercent(Number(row.return_10d), costs));
  const probabilityRows = rows.filter((row) => typeof row.model_probability === 'number' && typeof row.return_10d === 'number');
  return {
    sampleSize: rows.length,
    winRate5d: rate(net5d.map((value) => value > 0)),
    winRate10d: rate(net10d.map((value) => value > 0)),
    winRate20d: rate(net20d.map((value) => value > 0)),
    averageReturn10d: mean(net10d),
    grossAverageReturn10d: mean(numeric('return_10d')),
    expectancy10d: mean(net10d),
    maxDrawdown10d: maximumDrawdown(chronologicalNet10d),
    costAssumptions: costs,
    targetHitRate: rate(rows.map((row) => typeof row.target_hit === 'boolean' ? row.target_hit : null)),
    stopHitRate: rate(rows.map((row) => typeof row.stop_hit === 'boolean' ? row.stop_hit : null)),
    brierScore: probabilityRows.length ? mean(probabilityRows.map((row) => Math.pow(Number(row.model_probability) - (netReturnPercent(Number(row.return_10d), costs) > 0 ? 1 : 0), 2))) : null,
  };
}
