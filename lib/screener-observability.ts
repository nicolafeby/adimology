export type ScreeningRunStatus = 'running' | 'completed' | 'partial' | 'failed';
export type QuantitativeRunStatus = 'not_started' | 'processing' | 'completed' | 'partial' | 'failed';
export type EnrichmentRunStatus = 'not_started' | 'processing' | 'completed' | 'partial' | 'failed' | 'skipped';
export type FunnelStage = 'universe' | 'data_acquisition' | 'pre_screen' | 'quantitative_selection' | 'quantitative_analysis' | 'eligibility' | 'ranking' | 'persisted' | 'ai_enrichment' | 'completed';
export type FunnelTerminalStatus = 'completed' | 'filtered_out' | 'processing_error' | 'skipped' | 'pending';
export type FunnelErrorCode = 'UNIVERSE_FETCH_FAILED' | 'HISTORY_FETCH_FAILED' | 'ORDERBOOK_FETCH_FAILED' | 'BROKER_DATA_FAILED' | 'INVALID_PROVIDER_RESPONSE' | 'INSUFFICIENT_HISTORY' | 'QUANTITATIVE_ANALYSIS_FAILED' | 'PERSISTENCE_FAILED' | 'AI_TIMEOUT' | 'AI_INVALID_RESPONSE' | 'AI_PROVIDER_FAILED' | 'UNKNOWN_PROCESSING_ERROR';

export interface ScreeningFunnelItem {
  symbol: string;
  pre_screen_passed?: boolean | null;
  selected_for_quantitative?: boolean;
  quantitative_status?: 'not_started' | 'processing' | 'completed' | 'failed' | 'skipped';
  eligibility_status?: string | null;
  screening_status?: 'passed' | 'watch' | 'rejected' | 'processing_error' | null;
  ranking_position?: number | null;
  selected_for_ai?: boolean;
  ai_status?: string;
  ai_source?: string | null;
  terminal_status?: FunnelTerminalStatus;
  failure_stage?: FunnelStage | null;
}

export interface ScreeningFunnelSummary {
  universe: number; dataAcquisitionSucceeded: number; dataAcquisitionFailed: number;
  preScreenPassed: number; preScreenFailed: number; quantitativeSelected: number; quantitativeSkipped: number;
  quantitativeCompleted: number; quantitativeFailed: number; eligibilityEvaluated: number;
  passed: number; watch: number; rejected: number; processingError: number; ranked: number;
  aiRequested: number; aiReused: number; aiCompleted: number; aiFailed: number; aiPending: number; aiSkipped: number;
}

export function deriveFunnelSummary(items: ScreeningFunnelItem[]): ScreeningFunnelSummary {
  const count = (fn: (item: ScreeningFunnelItem) => boolean) => items.filter(fn).length;
  return {
    universe: items.length,
    dataAcquisitionSucceeded: count((x) => x.failure_stage !== 'data_acquisition'),
    dataAcquisitionFailed: count((x) => x.failure_stage === 'data_acquisition'),
    preScreenPassed: count((x) => x.pre_screen_passed === true),
    preScreenFailed: count((x) => x.pre_screen_passed === false && x.failure_stage !== 'data_acquisition'),
    quantitativeSelected: count((x) => x.selected_for_quantitative === true),
    quantitativeSkipped: count((x) => x.quantitative_status === 'skipped'),
    quantitativeCompleted: count((x) => x.quantitative_status === 'completed'),
    quantitativeFailed: count((x) => x.quantitative_status === 'failed'),
    eligibilityEvaluated: count((x) => x.eligibility_status != null && x.eligibility_status !== 'not_evaluated'),
    passed: count((x) => x.screening_status === 'passed'), watch: count((x) => x.screening_status === 'watch'), rejected: count((x) => x.screening_status === 'rejected'),
    processingError: count((x) => x.terminal_status === 'processing_error' || x.screening_status === 'processing_error'),
    ranked: count((x) => x.ranking_position != null), aiRequested: count((x) => x.selected_for_ai === true),
    aiReused: count((x) => x.ai_status === 'completed' && x.ai_source === 'cache'), aiCompleted: count((x) => x.ai_status === 'completed' && x.ai_source !== 'cache'), aiFailed: count((x) => x.ai_status === 'failed'),
    aiPending: count((x) => ['pending', 'processing'].includes(x.ai_status ?? '')), aiSkipped: count((x) => x.ai_status === 'skipped' || x.ai_status === 'not_requested'),
  };
}

export function validateFunnelSummary(summary: ScreeningFunnelSummary): string[] {
  const failures: string[] = [];
  const assert = (valid: boolean, message: string) => { if (!valid) failures.push(message); };
  assert(summary.dataAcquisitionSucceeded + summary.dataAcquisitionFailed === summary.universe, 'data acquisition does not reconcile with universe');
  assert(summary.quantitativeCompleted + summary.quantitativeFailed === summary.quantitativeSelected, 'quantitative outcomes do not reconcile with selected');
  assert(summary.passed + summary.watch + summary.rejected === summary.eligibilityEvaluated, 'eligibility statuses do not reconcile');
  assert(summary.ranked === summary.passed, 'only and all passed items must be ranked');
  assert(summary.aiReused + summary.aiCompleted + summary.aiFailed + summary.aiPending === summary.aiRequested, 'AI outcomes do not reconcile with requested');
  return failures;
}

const SECRET_PATTERN = /(bearer\s+\S+|token|authorization|cookie|password|secret|apikey|api[_-]?key)/i;
export function safeProcessingError(error: unknown, fallbackCode: FunnelErrorCode, stage: FunnelStage) {
  const raw = error instanceof Error ? error.message : String(error ?? '');
  const unsafe = SECRET_PATTERN.test(raw);
  const timeout = /timeout|timed out|abort/i.test(raw);
  const code: FunnelErrorCode = timeout ? (stage === 'ai_enrichment' ? 'AI_TIMEOUT' : fallbackCode) : fallbackCode;
  return { code, stage, retryable: timeout || /429|5\d\d|network|fetch/i.test(raw), safe_message: unsafe ? 'Provider request failed; sensitive details were redacted.' : (raw || 'Processing failed.').slice(0, 240), occurred_at: new Date().toISOString() };
}
