import { ANALYSIS_QUALITY_VERSION } from './analysis-quality';
import { DEFAULT_BACKTEST_CONFIG } from './backtest';
import type { CalibrationContext, MarketRegime } from './probability-calibration';
export const ACTIVE_MODEL_VERSION = 'multifactor-regime-rs-v6';
export const ACTIVE_METHODOLOGY_VERSION = ANALYSIS_QUALITY_VERSION;
export const ACTIVE_CALIBRATION_VERSION = 'probability-net-10d-v3';
export const ACTIVE_EXECUTION_MODEL = 'entry_zone_conservative';
export const ACTIVE_OUTCOME_DEFINITION = 'net_return_10d_positive' as const;
export const ACTIVE_BACKTEST_CONFIG_VERSION = DEFAULT_BACKTEST_CONFIG.configVersion;
export const ACTIVE_REGIME_METHODOLOGY_VERSION = 'ihsg-regime-v1';
export const ACTIVE_RELATIVE_STRENGTH_METHODOLOGY_VERSION = 'relative-return-v1';
export const ACTIVE_SELECTION_SCOPE = 'quantitative_evaluated';
export const ALERT_CALIBRATION_POLICY = Object.freeze({ minimumSampleSize: 50, minimumIntervalLowerBound: 0.5 });
export function buildCalibrationContext(input: { score: number; marketRegime: MarketRegime; analysisDate: string; calibrationCutoff?: string; methodologyVersion?: string; minimumSampleSize?: number }): CalibrationContext { const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()); const temporalCutoff = input.calibrationCutoff ?? (input.analysisDate === today ? new Date().toISOString() : `${input.analysisDate}T23:59:59.999Z`); return { score: input.score, modelVersion: ACTIVE_MODEL_VERSION, methodologyVersion: input.methodologyVersion ?? ACTIVE_METHODOLOGY_VERSION, calibrationVersion: ACTIVE_CALIBRATION_VERSION, marketRegime: input.marketRegime, executionModel: ACTIVE_EXECUTION_MODEL, outcomeDefinition: ACTIVE_OUTCOME_DEFINITION, selectionScope: ACTIVE_SELECTION_SCOPE, analysisDate: input.analysisDate, calibrationCutoff: temporalCutoff, minimumSampleSize: input.minimumSampleSize }; }
