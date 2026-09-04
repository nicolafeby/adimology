import type { StockRanking, TrendSignal } from './types';

export type ScreeningStatus = 'passed' | 'watch' | 'rejected' | 'processing_error';
export type SelectionStage = 'universe' | 'pre_screen' | 'quantitative_analysis' | 'quality_gate' | 'final_selection';
export type RuleSeverity = 'info' | 'warning' | 'hard_fail';

export interface ScreeningRule {
  key: string;
  label: string;
  passed: boolean;
  actual_value: unknown;
  required_value: unknown;
  explanation: string;
  severity: RuleSeverity;
}

export interface ScreeningResult {
  symbol: string;
  analysis_date: string;
  screening_status: ScreeningStatus;
  passed_rules: ScreeningRule[];
  failed_rules: ScreeningRule[];
  selection_stage: SelectionStage;
  data_quality: { completeness: number | null; confidence: number | null; valid: boolean };
  evaluated_at: string;
  run_id: string;
  ranking?: StockRanking | null;
}

export interface ScreeningClassifierInput {
  processingError?: string | null;
  preScreenPassed: boolean;
  completeness: number | null;
  confidence: number | null;
  signal: TrendSignal | null;
  hasSevereBearishConflict?: boolean;
  hasHardRisk?: boolean;
  marketGateAvoid?: boolean;
  analysisValid?: boolean;
  confirmationComplete?: boolean;
}

export const SCREENING_THRESHOLDS = Object.freeze({ minimumCompleteness: 60, minimumConfidence: 45 });

const rule = (key: string, label: string, passed: boolean, actual_value: unknown, required_value: unknown, explanation: string, severity: RuleSeverity): ScreeningRule =>
  ({ key, label, passed, actual_value, required_value, explanation, severity });

/** Pure, deterministic classification. Dates and identifiers are attached by the caller. */
export function classifyScreening(input: ScreeningClassifierInput): { status: ScreeningStatus; rules: ScreeningRule[] } {
  if (input.processingError) return {
    status: 'processing_error',
    rules: [rule('processing_completed', 'Proses analisis selesai', false, input.processingError, 'Respons valid tanpa error', 'Saham tidak dapat dinilai secara valid karena proses atau sumber data gagal.', 'hard_fail')],
  };
  const completeness = input.completeness;
  const confidence = input.confidence;
  const rules = [
    rule('pre_screen', 'Hard filter pre-screen', input.preScreenPassed, input.preScreenPassed, true, input.preScreenPassed ? 'Saham memenuhi seluruh hard filter pre-screen.' : 'Saham tidak memenuhi satu atau lebih hard filter pre-screen.', input.preScreenPassed ? 'info' : 'hard_fail'),
    rule('analysis_valid', 'Analisis valid', input.analysisValid !== false, input.analysisValid !== false, true, 'Struktur analisis harus valid dan lengkap untuk diklasifikasikan.', input.analysisValid === false ? 'hard_fail' : 'info'),
    rule('data_completeness', 'Kelengkapan data minimum', completeness !== null && completeness >= SCREENING_THRESHOLDS.minimumCompleteness, completeness, `>= ${SCREENING_THRESHOLDS.minimumCompleteness}%`, 'Kelengkapan data minimum diperlukan untuk hasil passed.', 'warning'),
    rule('analysis_confidence', 'Confidence minimum', confidence !== null && confidence >= SCREENING_THRESHOLDS.minimumConfidence, confidence, `>= ${SCREENING_THRESHOLDS.minimumConfidence}%`, 'Confidence minimum diperlukan untuk hasil passed.', 'warning'),
    rule('bearish_conflict', 'Tanpa konflik bearish berat', !input.hasSevereBearishConflict, Boolean(input.hasSevereBearishConflict), false, 'Konflik bearish berat membatalkan seleksi.', input.hasSevereBearishConflict ? 'hard_fail' : 'info'),
    rule('hard_risk', 'Tanpa hard risk', !input.hasHardRisk, Boolean(input.hasHardRisk), false, 'Hard risk membuat saham tidak layak diloloskan.', input.hasHardRisk ? 'hard_fail' : 'info'),
    rule('market_gate', 'Lolos market gate', !input.marketGateAvoid, input.marketGateAvoid ? 'avoid' : input.signal, 'bukan avoid', 'Market gate tidak boleh menghasilkan avoid.', input.marketGateAvoid ? 'hard_fail' : 'info'),
    rule('confirmation', 'Konfirmasi final', Boolean(input.confirmationComplete), input.signal, 'confirmed_uptrend', 'Konfirmasi final membedakan passed dari watch.', 'warning'),
  ];
  if (rules.some((item) => !item.passed && item.severity === 'hard_fail')) return { status: 'rejected', rules };
  return { status: rules.every((item) => item.passed) ? 'passed' : 'watch', rules };
}

export function groupScreeningResults(results: ScreeningResult[], universe: number) {
  const grouped = {
    passed: results.filter((row) => row.screening_status === 'passed'),
    watch: results.filter((row) => row.screening_status === 'watch'),
    rejected: results.filter((row) => row.screening_status === 'rejected'),
    processingError: results.filter((row) => row.screening_status === 'processing_error'),
  };
  const fullyEvaluatedStages: SelectionStage[] = ['quantitative_analysis', 'quality_gate', 'final_selection'];
  return { summary: { universe, evaluated: results.filter((row) => row.screening_status !== 'processing_error' && fullyEvaluatedStages.includes(row.selection_stage)).length, passed: grouped.passed.length, watch: grouped.watch.length, rejected: grouped.rejected.length, processingError: grouped.processingError.length }, results: grouped };
}
