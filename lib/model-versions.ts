import { strategyIdentity, type StrategyId } from './strategies';
import type { ScreeningExecutionMode } from './point-in-time';
import { ANALYSIS_QUALITY_VERSION } from './analysis-quality';
import { DEFAULT_BACKTEST_CONFIG } from './backtest';
import type { CalibrationContext, MarketRegime } from './probability-calibration';
export const ACTIVE_MODEL_VERSION = 'multifactor-swing-v8';
export const ACTIVE_RANKING_MODEL_VERSION = 'eligible-ranking-swing-v2';
export const ACTIVE_ELIGIBILITY_CONFIG_VERSION = 'eligibility-execution-v2';
const LEGACY_RANKING_MODEL_VERSIONS = [
  'multifactor-swing-v7',
  'multifactor-ai-v2',
  'multifactor-regime-rs-v3',
  'multifactor-decision-v4',
  'multifactor-quality-v5',
  'multifactor-regime-rs-v6',
] as const;

export function isSupportedRankingModelVersion(value: unknown): value is string {
  return typeof value === 'string'
    && (value === ACTIVE_MODEL_VERSION || LEGACY_RANKING_MODEL_VERSIONS.includes(value as (typeof LEGACY_RANKING_MODEL_VERSIONS)[number]));
}

export function rankingModelBadge(value: unknown) {
  if (!isSupportedRankingModelVersion(value)) return null;
  const version = value.match(/v\d+$/)?.[0];
  return version ? `Regime + RS · ${version}` : 'AI validated';
}
export const ACTIVE_METHODOLOGY_VERSION = ANALYSIS_QUALITY_VERSION;
export const ACTIVE_CALIBRATION_VERSION = 'probability-net-10d-v3';
export const ACTIVE_EXECUTION_MODEL = 'entry_zone_conservative';
export const ACTIVE_OUTCOME_DEFINITION = 'net_return_10d_positive' as const;
export const ACTIVE_BACKTEST_CONFIG_VERSION = DEFAULT_BACKTEST_CONFIG.configVersion;
export const ACTIVE_REGIME_METHODOLOGY_VERSION = 'ihsg-regime-v1';
export const ACTIVE_RELATIVE_STRENGTH_METHODOLOGY_VERSION = 'relative-return-v1';
export const ACTIVE_SELECTION_SCOPE = 'quantitative_evaluated';
export const ALERT_CALIBRATION_POLICY = Object.freeze({ minimumSampleSize: 50, minimumIntervalLowerBound: 0.5 });
export function buildCalibrationContext(input: { score: number; marketRegime: MarketRegime; analysisDate: string; calibrationCutoff?: string; methodologyVersion?: string; minimumSampleSize?: number; strategyId?: StrategyId; executionMode?: ScreeningExecutionMode }): CalibrationContext { const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()); const temporalCutoff = input.calibrationCutoff ?? (input.analysisDate === today ? new Date().toISOString() : `${input.analysisDate}T23:59:59.999Z`); const identity = strategyIdentity(input.strategyId ?? 'swing'); return { strategyId: identity.strategy_id, strategyVersion: identity.strategy_version, configurationVersion: identity.configuration_version, executionMode: input.executionMode ?? 'live', score: input.score, modelVersion: ACTIVE_MODEL_VERSION, methodologyVersion: input.methodologyVersion ?? ACTIVE_METHODOLOGY_VERSION, calibrationVersion: ACTIVE_CALIBRATION_VERSION, marketRegime: input.marketRegime, executionModel: identity.execution_model, outcomeDefinition: identity.outcome_definition, selectionScope: ACTIVE_SELECTION_SCOPE, analysisDate: input.analysisDate, calibrationCutoff: temporalCutoff, minimumSampleSize: input.minimumSampleSize }; }
