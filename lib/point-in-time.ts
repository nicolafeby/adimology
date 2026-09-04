export const MARKET_TIMEZONE = 'Asia/Jakarta' as const;
export const POINT_IN_TIME_POLICY_VERSION = 'point-in-time-v1' as const;

export type ScreeningExecutionMode = 'live' | 'historical_replay' | 'legacy_unverified';
export type MarketSession = 'pre_open' | 'intraday' | 'post_close' | 'unknown';
export type TemporalValidity = 'valid' | 'future_data' | 'timestamp_missing' | 'historical_snapshot_missing' | 'publication_time_unverified' | 'stale' | 'session_mismatch';
export type SourceDataType = 'historical_price' | 'market_price' | 'orderbook' | 'broker_summary' | 'fundamental' | 'news' | 'ai_story' | 'benchmark' | 'emiten_info';

export interface SourceProvenance {
  source: string;
  dataType: SourceDataType;
  symbol: string;
  observedAt: string | null;
  effectiveAt: string | null;
  publishedAt: string | null;
  fetchedAt: string;
  availableAt: string | null;
  isHistoricalSnapshot: boolean;
  providerReference: string | null;
  rawSnapshotId: string | null;
  contentHash?: string | null;
  temporalValidity: TemporalValidity;
  periodStart?: string | null;
  periodEnd?: string | null;
}

export interface PointInTimeContext {
  analysisDate: string;
  screenedAt: string;
  informationCutoffAt: string;
  marketTimezone: typeof MARKET_TIMEZONE;
  executionMode: ScreeningExecutionMode;
  marketSession: MarketSession;
  policyVersion: typeof POINT_IN_TIME_POLICY_VERSION;
}

export interface TemporalValidationResult {
  valid: boolean;
  status: TemporalValidity;
  reason: string;
  sourceAvailableAt: string | null;
  informationCutoffAt: string;
  policyVersion: typeof POINT_IN_TIME_POLICY_VERSION;
  stale: boolean;
}

const publicationRequired = new Set<SourceDataType>(['fundamental', 'news', 'ai_story']);
const liveOnly = new Set<SourceDataType>(['orderbook', 'market_price']);

function timestamp(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function validatePointInTimeSource(source: SourceProvenance, context: PointInTimeContext, staleAfterMs?: number): TemporalValidationResult {
  const cutoff = timestamp(context.informationCutoffAt);
  const published = timestamp(source.publishedAt);
  const available = timestamp(source.availableAt) ?? published ?? timestamp(source.observedAt);
  const result = (valid: boolean, status: TemporalValidity, reason: string, stale = false): TemporalValidationResult => ({ valid, status, reason, sourceAvailableAt: available === null ? null : new Date(available).toISOString(), informationCutoffAt: context.informationCutoffAt, policyVersion: POINT_IN_TIME_POLICY_VERSION, stale });
  if (cutoff === null) return result(false, 'timestamp_missing', 'Information cutoff tidak valid.');
  if (context.executionMode === 'legacy_unverified') return result(false, 'timestamp_missing', 'Snapshot legacy tidak memiliki provenance temporal yang dapat diverifikasi.');
  if (context.executionMode === 'historical_replay' && liveOnly.has(source.dataType) && !source.isHistoricalSnapshot) return result(false, 'historical_snapshot_missing', `${source.dataType} live tidak boleh digunakan untuk historical replay.`);
  if (publicationRequired.has(source.dataType) && published === null) return result(false, 'publication_time_unverified', `Waktu publikasi ${source.dataType} tidak dapat diverifikasi.`);
  if (available === null) return result(false, 'timestamp_missing', `Timestamp ketersediaan ${source.dataType} tidak tersedia.`);
  if (available > cutoff) return result(false, 'future_data', `${source.dataType} tersedia setelah information cutoff.`);
  if (source.periodEnd && timestamp(source.periodEnd)! > cutoff) return result(false, 'future_data', `Rentang ${source.dataType} melewati information cutoff.`);
  const stale = staleAfterMs !== undefined && cutoff - available > staleAfterMs;
  return result(true, stale ? 'stale' : 'valid', stale ? `${source.dataType} point-in-time valid tetapi stale.` : `${source.dataType} tersedia pada atau sebelum cutoff.`, stale);
}

export function jakartaDate(at: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: MARKET_TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
}

export function marketSessionAt(at: Date): MarketSession {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: MARKET_TIMEZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23', weekday: 'short' }).formatToParts(at);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  if (value.weekday === 'Sat' || value.weekday === 'Sun') return 'unknown';
  const minute = Number(value.hour) * 60 + Number(value.minute);
  if (minute < 9 * 60) return 'pre_open';
  if (minute <= 16 * 60) return 'intraday';
  return 'post_close';
}

export function createPointInTimeContext(input: { analysisDate?: string; screenedAt?: string; informationCutoffAt?: string; executionMode?: ScreeningExecutionMode }): PointInTimeContext {
  const screenedAt = input.screenedAt ?? new Date().toISOString();
  const today = jakartaDate(new Date(screenedAt));
  const analysisDate = input.analysisDate ?? today;
  const executionMode = input.executionMode ?? (analysisDate === today ? 'live' : 'historical_replay');
  if (executionMode === 'live' && analysisDate !== today) throw new Error('Live screening hanya dapat memakai tanggal pasar saat ini; gunakan historical_replay untuk tanggal lampau.');
  return { analysisDate, screenedAt, informationCutoffAt: input.informationCutoffAt ?? screenedAt, marketTimezone: MARKET_TIMEZONE, executionMode, marketSession: marketSessionAt(new Date(screenedAt)), policyVersion: POINT_IN_TIME_POLICY_VERSION };
}

export function completedDailyCandleAvailableAt(sessionDate: string): string {
  return `${sessionDate}T16:15:00+07:00`;
}

export function filterCompletedDailyCandles<T extends { date: string }>(rows: T[], context: PointInTimeContext): T[] {
  const cutoff = Date.parse(context.informationCutoffAt);
  return rows.filter((row) => Date.parse(completedDailyCandleAvailableAt(row.date)) <= cutoff);
}

export function assessBacktestEligibility(input: { context: PointInTimeContext; sources: SourceProvenance[]; decisionPersistedAt?: string | null; modelVersion?: string | null; configVersion?: string | null }) {
  const reasons: Array<{ code: string; message: string; sourceType?: SourceDataType }> = [];
  if (input.context.executionMode === 'legacy_unverified') reasons.push({ code: 'LEGACY_UNVERIFIED', message: 'Snapshot legacy tidak memiliki provenance temporal.' });
  for (const source of input.sources) {
    const validation = validatePointInTimeSource(source, input.context);
    if (!validation.valid) reasons.push({ code: validation.status.toUpperCase(), message: validation.reason, sourceType: source.dataType });
  }
  if (!input.decisionPersistedAt || Date.parse(input.decisionPersistedAt) < Date.parse(input.context.informationCutoffAt)) reasons.push({ code: 'DECISION_SNAPSHOT_MISSING', message: 'Waktu persistensi decision snapshot tidak tersedia atau mendahului feature cutoff.' });
  if (!input.modelVersion) reasons.push({ code: 'MODEL_VERSION_MISSING', message: 'Model version tidak tersedia.' });
  if (!input.configVersion) reasons.push({ code: 'CONFIG_VERSION_MISSING', message: 'Config version tidak tersedia.' });
  return { eligible: reasons.length === 0, reasons };
}
