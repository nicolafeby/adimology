export const SCREENING_UPDATE_REQUIRED = 'SCREENING_UPDATE_REQUIRED' as const;
export const SCREENING_UPDATE_MESSAGE = 'Layanan Screening belum selesai diperbarui. Coba lagi setelah pembaruan selesai.';

export class ScreeningUpdateRequiredError extends Error {
  readonly code = SCREENING_UPDATE_REQUIRED;
  constructor() { super(SCREENING_UPDATE_MESSAGE); this.name = 'ScreeningUpdateRequiredError'; }
}

const schemaCodes = new Set(['42703', '42P01', '42883', 'PGRST202', 'PGRST204', 'PGRST205']);
const screeningObjects = /\b(?:screening_runs|screening_results|screening_run_events|screening_enrichments|signal_snapshots|signal_outcomes|source_snapshots|strategy_outcome_archives|claim_screening_run|mark_stale_screening_runs)\b/i;
/** Recognize only known schema failures; database diagnostics never become UI text. */
export function isScreeningUpdateRequired(error: unknown): boolean {
  if (error instanceof ScreeningUpdateRequiredError) return true;
  if (!error || typeof error !== 'object') return false;
  const value = error as { code?: unknown; message?: unknown; details?: unknown; hint?: unknown };
  if (typeof value.code !== 'string' || !schemaCodes.has(value.code)) return false;
  const diagnostic = [value.message, value.details, value.hint].filter((part): part is string => typeof part === 'string').join(' ');
  return screeningObjects.test(diagnostic);
}
