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
  // Provider payloads, stack traces, URLs and database diagnostics stay server-side.
  const message = unsafe ? 'Provider request failed; sensitive details were redacted.' : timeout ? 'Sumber data tidak merespons tepat waktu. Coba lagi.' : /429/.test(raw) ? 'Batas permintaan sumber data tercapai. Coba lagi nanti.' : /401|403/.test(raw) ? 'Akses sumber data kedaluwarsa atau tidak tersedia. Perbarui koneksi.' : 'Pemrosesan gagal. Coba lagi atau periksa koneksi sumber data.';
  return { code, stage, retryable: timeout || /429|5\d\d|network|fetch/i.test(raw), safe_message: message, occurred_at: new Date().toISOString() };

}

/** Bounded timeout; callers must keep persistence outside the timed operation. */
export async function withTimeout<T>(operation: () => Promise<T>, timeoutMs = 20_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([operation(), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Provider timeout')), timeoutMs); })]);
  } finally { if (timer) clearTimeout(timer); }
}

/** Retry only temporary failures. Auth and malformed payloads require an explicit fix. */
export async function withProviderRetry<T>(operation: () => Promise<T>, options: { timeoutMs?: number; attempts?: number; backoffMs?: number } = {}): Promise<T> {
  const attempts = Math.min(3, Math.max(1, options.attempts ?? 2));
  for (let attempt = 0; attempt < attempts; attempt++) {
    try { return await withTimeout(operation, options.timeoutMs ?? 20_000); }
    catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (attempt + 1 === attempts || !/429|5\d\d|network|fetch|timeout|abort/i.test(message) || /401|403/.test(message)) throw error;
      await new Promise((resolve) => setTimeout(resolve, (options.backoffMs ?? 150) * 2 ** attempt));
    }
  }
  throw new Error('Provider unavailable');
}
