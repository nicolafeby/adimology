import { getLatestScreeningRun } from './supabase';
import { runMarketScreener } from './screener-service';
import {
  CORE_STRATEGY_IDS,
  IDX_UNIFIED_PIPELINE_VERSION,
  getStrategyWindowStatuses,
  isUnifiedScreenerResult,
  type UnifiedScreenerResult,
} from './idx-strategy-filters';
import type { ScreeningExecutionMode } from './point-in-time';

export interface UnifiedRunOptions {
  analysisDate?: string;
  informationCutoffAt?: string;
  executionMode?: ScreeningExecutionMode;
  universeLimit?: number;
  deepLimit?: number;
  aiLimit?: number;
  concurrency?: number;
  triggerSource?: string;
  requestedBy?: string;
  idempotencyKey?: string;
}

const sortResults = (a: UnifiedScreenerResult, b: UnifiedScreenerResult) => {
  const aPriority = a.matched_strategies.includes('CLOSING_PRIORITY');
  const bPriority = b.matched_strategies.includes('CLOSING_PRIORITY');
  return Number(bPriority) - Number(aPriority)
    || (b.confidence_score ?? -1) - (a.confidence_score ?? -1)
    || b.matched_strategies.length - a.matched_strategies.length
    || (b.change_percent ?? -Infinity) - (a.change_percent ?? -Infinity)
    || a.ticker.localeCompare(b.ticker);
};

/** The existing swing acquisition run is reused; its one snapshot stores all four rule assessments. */
export async function runUnifiedScreener(options: UnifiedRunOptions = {}) {
  return runMarketScreener({ ...options, strategyId: 'swing' });
}

export async function getUnifiedScreenerSnapshot(options: { date?: string; runId?: string } = {}) {
  const snapshot = await getLatestScreeningRun(options.date, 'swing', { runId: options.runId, includeRunning: true });
  const fallbackTime = snapshot?.run?.information_cutoff_at ?? new Date().toISOString();
  if (!snapshot) {
    return {
      pipeline_version: IDX_UNIFIED_PIPELINE_VERSION,
      timezone: 'Asia/Jakarta' as const,
      run: null,
      evaluated_at: fallbackTime,
      windows: getStrategyWindowStatuses(fallbackTime),
      data: [] as UnifiedScreenerResult[],
      summary: { universe: 0, evaluated: 0, matched: 0, topPriority: 0, partialData: 0 },
    };
  }
  const data = snapshot.results.flatMap((row: { strategy_assessment?: unknown }) =>
    isUnifiedScreenerResult(row.strategy_assessment) ? [row.strategy_assessment] : [],
  ).sort(sortResults);
  const evaluatedAt = data[0]?.evaluated_at ?? fallbackTime;
  const counts = Object.fromEntries(CORE_STRATEGY_IDS.map((id) => [id, data.filter((row) => row.matched_strategies.includes(id)).length]));
  return {
    pipeline_version: IDX_UNIFIED_PIPELINE_VERSION,
    timezone: 'Asia/Jakarta' as const,
    run: snapshot.run,
    evaluated_at: evaluatedAt,
    windows: getStrategyWindowStatuses(evaluatedAt),
    data,
    summary: {
      universe: Number(snapshot.run.universe_count ?? snapshot.results.length),
      evaluated: data.length,
      matched: data.filter((row) => row.matched_strategies.some((id) => id !== 'CLOSING_PRIORITY')).length,
      topPriority: data.filter((row) => row.matched_strategies.includes('CLOSING_PRIORITY')).length,
      partialData: data.filter((row) => row.data_quality !== 'COMPLETE').length,
      strategies: counts,
    },
  };
}
