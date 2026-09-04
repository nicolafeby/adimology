import type { StockRanking, TrendSignal } from './types';

export type ScreeningStatus = 'passed' | 'watch' | 'rejected' | 'processing_error';
export type EligibilityStatus = 'eligible' | 'needs_confirmation' | 'ineligible' | 'not_evaluated';
export type AiStatus = 'not_requested' | 'pending' | 'processing' | 'completed' | 'failed' | 'stale';
export type SelectionStage = 'universe' | 'pre_screen' | 'quantitative_analysis' | 'quality_gate' | 'final_selection';
export type RuleSeverity = 'hard_gate' | 'confirmation' | 'informational';

export interface EligibilityRule { key: string; label: string; category: string; severity: RuleSeverity; passed: boolean; actualValue: unknown; requiredValue: unknown; explanation: string }

/** Baseline heuristic v1. Percent values are percentage points; liquidity is IDR/day. */
export const SCREENER_ELIGIBILITY_CONFIG = Object.freeze({ version: 'eligibility-v1', minimumCompletenessPercent: 60, minimumConfidencePercent: 45, minimumAverageTradedValueIdr: 1_000_000_000, maximumSpreadPercent: 3, maximumAtrPercent: 8, minimumRelativeVolume: 1.2, minimumBrokerFlowScore: 60, minimumSignalAgreementPercent: 60, minimumRiskReward: 1, minimumConfirmations: 4 } as const);

export interface EligibilityInput {
  processingError?: string | null; analysisValid: boolean; preScreenPassed: boolean; completeness: number | null; confidence: number | null;
  criticalDataAvailable: boolean; criticalDataStale: boolean; averageTradedValue: number | null; spreadPercent: number | null; atrPercent: number | null;
  dominantDirection: 'bullish' | 'neutral' | 'bearish' | 'unavailable' | null; hasHighSeverityConflict: boolean; signal: TrendSignal | null; marketGateAvoid: boolean;
  aboveSma20: boolean | null; return5d: number | null; relativeVolume: number | null; brokerFlowScore: number | null; relativeStrength20d: number | null;
  signalAgreement: number | null; riskReward: number | null;
}
export interface EligibilityResult { status: EligibilityStatus; screeningStatus: ScreeningStatus; rules: EligibilityRule[]; hardFailures: EligibilityRule[]; warnings: EligibilityRule[] }
const makeRule = (key: string, label: string, category: string, severity: RuleSeverity, passed: boolean, actualValue: unknown, requiredValue: unknown, explanation: string): EligibilityRule => ({ key, label, category, severity, passed, actualValue, requiredValue, explanation });

/** Pure and deterministic. Caller attaches evaluatedAt; missing values never pass silently. */
export function evaluateEligibility(input: EligibilityInput): EligibilityResult {
  if (input.processingError) return { status: 'not_evaluated', screeningStatus: 'processing_error', rules: [makeRule('processing_completed', 'Proses analisis selesai', 'process', 'hard_gate', false, input.processingError, 'respons valid', 'Proses atau sumber data gagal sehingga eligibility tidak dievaluasi.')], hardFailures: [], warnings: [] };
  const c = SCREENER_ELIGIBILITY_CONFIG;
  const rules = [
    makeRule('pre_screen', 'Pre-screen wajib', 'pre_screen', 'hard_gate', input.preScreenPassed, input.preScreenPassed, true, 'Seluruh filter pre-screen wajib lolos.'),
    makeRule('analysis_valid', 'Analisis valid', 'data_quality', 'hard_gate', input.analysisValid, input.analysisValid, true, 'Struktur analisis kuantitatif harus tersedia.'),
    makeRule('data_completeness', 'Kelengkapan data minimum', 'data_quality', 'hard_gate', input.completeness !== null && input.completeness >= c.minimumCompletenessPercent, input.completeness, `>= ${c.minimumCompletenessPercent}%`, 'Missing completeness adalah hard failure.'),
    makeRule('analysis_confidence', 'Confidence minimum', 'data_quality', 'hard_gate', input.confidence !== null && input.confidence >= c.minimumConfidencePercent, input.confidence, `>= ${c.minimumConfidencePercent}%`, 'Missing confidence adalah hard failure.'),
    makeRule('critical_data', 'Data kritis tersedia dan segar', 'freshness', 'hard_gate', input.criticalDataAvailable && !input.criticalDataStale, { available: input.criticalDataAvailable, stale: input.criticalDataStale }, { available: true, stale: false }, 'Harga, histori, dan data eksekusi kritis tidak boleh unavailable atau stale.'),
    makeRule('minimum_liquidity', 'Likuiditas minimum', 'liquidity', 'hard_gate', input.averageTradedValue !== null && input.averageTradedValue >= c.minimumAverageTradedValueIdr, input.averageTradedValue, `>= Rp ${c.minimumAverageTradedValueIdr}`, 'Rata-rata nilai transaksi 20 hari harus memenuhi baseline.'),
    makeRule('maximum_spread', 'Spread maksimum', 'execution', 'hard_gate', input.spreadPercent !== null && input.spreadPercent <= c.maximumSpreadPercent, input.spreadPercent, `<= ${c.maximumSpreadPercent}%`, 'Spread unavailable atau terlalu lebar adalah hard failure.'),
    makeRule('maximum_volatility', 'Volatilitas maksimum', 'risk', 'hard_gate', input.atrPercent !== null && input.atrPercent <= c.maximumAtrPercent, input.atrPercent, `<= ${c.maximumAtrPercent}% ATR`, 'ATR unavailable atau terlalu tinggi tidak memenuhi batas risiko.'),
    makeRule('dominant_direction', 'Tanpa arah bearish dominan', 'conflict', 'hard_gate', input.dominantDirection !== 'bearish' && input.dominantDirection !== 'unavailable' && input.dominantDirection !== null, input.dominantDirection, 'bullish atau neutral', 'Arah bearish atau unavailable menggagalkan eligibility.'),
    makeRule('high_severity_conflict', 'Tanpa konflik berat', 'conflict', 'hard_gate', !input.hasHighSeverityConflict, input.hasHighSeverityConflict, false, 'Konflik severity tinggi menggagalkan eligibility.'),
    makeRule('signal_not_avoid', 'Signal bukan avoid', 'signal', 'hard_gate', input.signal !== null && input.signal !== 'avoid', input.signal, 'bukan avoid', 'Signal avoid atau unavailable menggagalkan eligibility.'),
    makeRule('market_regime_gate', 'Lolos market-regime gate', 'market_regime', 'hard_gate', !input.marketGateAvoid, input.marketGateAvoid ? 'avoid' : input.signal, 'bukan hard rejection', 'Market gate tidak boleh menghasilkan avoid.'),
    makeRule('trend_confirmation', 'Harga di atas MA20', 'confirmation', 'confirmation', input.aboveSma20 === true, input.aboveSma20, true, 'Missing atau harga di bawah MA20 tidak memberi konfirmasi.'),
    makeRule('positive_return_5d', 'Return 5 hari positif', 'confirmation', 'confirmation', input.return5d !== null && input.return5d > 0, input.return5d, '> 0%', 'Missing atau return non-positif tidak memberi konfirmasi.'),
    makeRule('relative_volume', 'Relative volume', 'confirmation', 'confirmation', input.relativeVolume !== null && input.relativeVolume >= c.minimumRelativeVolume, input.relativeVolume, `>= ${c.minimumRelativeVolume}x`, 'Missing volume tidak memberi konfirmasi.'),
    makeRule('broker_flow', 'Broker flow', 'confirmation', 'confirmation', input.brokerFlowScore !== null && input.brokerFlowScore >= c.minimumBrokerFlowScore, input.brokerFlowScore, `>= ${c.minimumBrokerFlowScore}`, 'Missing broker flow tidak memberi konfirmasi.'),
    makeRule('relative_strength', 'Relative strength vs IHSG', 'confirmation', 'confirmation', input.relativeStrength20d !== null && input.relativeStrength20d > 0, input.relativeStrength20d, '> 0%', 'Missing relative strength tidak memberi konfirmasi.'),
    makeRule('signal_agreement', 'Signal agreement', 'confirmation', 'confirmation', input.signalAgreement !== null && input.signalAgreement >= c.minimumSignalAgreementPercent, input.signalAgreement, `>= ${c.minimumSignalAgreementPercent}%`, 'Missing agreement tidak memberi konfirmasi.'),
    makeRule('risk_reward', 'Risk/reward valid', 'confirmation', 'confirmation', input.riskReward !== null && input.riskReward >= c.minimumRiskReward, input.riskReward, `>= ${c.minimumRiskReward}`, 'Missing atau risk/reward rendah tidak memberi konfirmasi.'),
  ];
  const hardFailures = rules.filter((r) => r.severity === 'hard_gate' && !r.passed), warnings = rules.filter((r) => r.severity === 'confirmation' && !r.passed);
  if (hardFailures.length) return { status: 'ineligible', screeningStatus: 'rejected', rules, hardFailures, warnings };
  if (rules.filter((r) => r.severity === 'confirmation' && r.passed).length < c.minimumConfirmations) return { status: 'needs_confirmation', screeningStatus: 'watch', rules, hardFailures, warnings };
  return { status: 'eligible', screeningStatus: 'passed', rules, hardFailures, warnings };
}

/** @deprecated Compatibility adapter for callers predating eligibility-v1. */
export interface ScreeningClassifierInput { processingError?: string | null; preScreenPassed: boolean; completeness: number | null; confidence: number | null; signal: TrendSignal | null; hasSevereBearishConflict?: boolean; hasHardRisk?: boolean; marketGateAvoid?: boolean; analysisValid?: boolean; confirmationComplete?: boolean }
export function classifyScreening(input: ScreeningClassifierInput) {
  if (input.processingError) return { status: 'processing_error' as const, rules: [] };
  if (!input.preScreenPassed || input.analysisValid === false || input.hasSevereBearishConflict || input.hasHardRisk || input.marketGateAvoid) return { status: 'rejected' as const, rules: [] };
  if (input.completeness === null || input.completeness < SCREENER_ELIGIBILITY_CONFIG.minimumCompletenessPercent || input.confidence === null || input.confidence < SCREENER_ELIGIBILITY_CONFIG.minimumConfidencePercent || input.signal === 'avoid') return { status: 'watch' as const, rules: [] };
  return { status: input.confirmationComplete ? 'passed' as const : 'watch' as const, rules: [] };
}

export interface ScreeningResult {
  symbol: string; analysis_date: string; screening_status: ScreeningStatus | null; eligibility_status?: EligibilityStatus; eligibility_rules?: EligibilityRule[];
  passed_rules: EligibilityRule[]; failed_rules: EligibilityRule[]; selection_stage: SelectionStage; data_quality: { completeness: number | null; confidence: number | null; valid: boolean };
  evaluated_at: string; run_id: string; analysis_score?: number | null; ranking_score?: number | null; ranking_position?: number | null;
  ranking_factors?: import('./ranking').RankingFactor[]; eligibility_config_version?: string; ranking_model_version?: string; ranking?: StockRanking | null;
  ai_status?: AiStatus; ai_enrichment?: Record<string, unknown> | null; ai_source?: 'cache' | 'generated' | null; ai_requested_at?: string | null; ai_completed_at?: string | null; ai_error?: string | null;
}

export function groupScreeningResults(results: ScreeningResult[], universe: number) {
  const grouped = { passed: results.filter((r) => r.screening_status === 'passed'), watch: results.filter((r) => r.screening_status === 'watch'), rejected: results.filter((r) => r.screening_status === 'rejected'), processingError: results.filter((r) => r.screening_status === 'processing_error') };
  const stages: SelectionStage[] = ['quantitative_analysis', 'quality_gate', 'final_selection'];
  return { summary: { universe, evaluated: results.filter((r) => r.screening_status !== 'processing_error' && stages.includes(r.selection_stage)).length, passed: grouped.passed.length, watch: grouped.watch.length, rejected: grouped.rejected.length, processingError: grouped.processingError.length, aiRequested: results.filter((r) => r.ai_status && r.ai_status !== 'not_requested').length, aiCompleted: results.filter((r) => r.ai_status === 'completed').length, aiFailed: results.filter((r) => r.ai_status === 'failed').length }, results: grouped };
}
