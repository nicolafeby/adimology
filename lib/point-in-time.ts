import { sessionPhaseAt } from './market-calendar';
export const MARKET_TIMEZONE = 'Asia/Jakarta' as const;
export const POINT_IN_TIME_POLICY_VERSION = 'point-in-time-v1' as const;

export type ScreeningExecutionMode = 'live' | 'historical_replay' | 'legacy_unverified';
export type MarketSession = 'pre_open' | 'intraday' | 'post_close' | 'break' | 'auction' | 'closed' | 'unknown';
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
  if (context.executionMode === 'historical_replay' && !source.isHistoricalSnapshot) return result(false, 'historical_snapshot_missing', `${source.dataType} live tidak boleh digunakan untuk historical replay.`);
  if (publicationRequired.has(source.dataType) && published === null) return result(false, 'publication_time_unverified', `Waktu publikasi ${source.dataType} tidak dapat diverifikasi.`);
  if (available === null) return result(false, 'timestamp_missing', `Timestamp ketersediaan ${source.dataType} tidak tersedia.`);
  const temporalFields = [source.availableAt, source.observedAt, source.effectiveAt, source.publishedAt, source.fetchedAt];
  if (temporalFields.some(value => value !== null && timestamp(value) === null)) return result(false, 'timestamp_missing', `${source.dataType} memiliki timestamp tidak valid.`);
  if (temporalFields.some(value => timestamp(value) !== null && timestamp(value)! > cutoff)) return result(false, 'future_data', `${source.dataType} memiliki timestamp setelah information cutoff.`);
  if (published !== null && published > cutoff) return result(false, 'future_data', `${source.dataType} dipublikasikan setelah information cutoff.`);
  if (available > cutoff) return result(false, 'future_data', `${source.dataType} tersedia setelah information cutoff.`);
  if (source.periodEnd && timestamp(source.periodEnd)! > cutoff) return result(false, 'future_data', `Rentang ${source.dataType} melewati information cutoff.`);
  const stale = staleAfterMs !== undefined && cutoff - available > staleAfterMs;
  return result(true, stale ? 'stale' : 'valid', stale ? `${source.dataType} point-in-time valid tetapi stale.` : `${source.dataType} tersedia pada atau sebelum cutoff.`, stale);
}

export function jakartaDate(at: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: MARKET_TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
}

export function marketSessionAt(at: Date): MarketSession {
  const session = sessionPhaseAt(at.toISOString());
  if (session.continuous) return 'intraday';
  if (session.phase === 'opening_auction' || session.phase === 'closing_auction') return 'auction';
  if (session.phase === 'break') return 'break';
  if (session.phase === 'closed') return 'closed';
  if (session.phase === 'pre_open' || session.phase === 'post_close') return session.phase;
  return 'unknown';
}

export function createPointInTimeContext(input: { analysisDate?: string; screenedAt?: string; informationCutoffAt?: string; executionMode?: ScreeningExecutionMode }): PointInTimeContext {
  const screenedAt = input.screenedAt ?? new Date().toISOString();
  if (!Number.isFinite(Date.parse(screenedAt))) throw new RangeError('screenedAt tidak valid.');
  const today = jakartaDate(new Date(screenedAt));
  const analysisDate = input.analysisDate ?? today;
  const executionMode = input.executionMode ?? (analysisDate === today ? 'live' : 'historical_replay');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(analysisDate) || !Number.isFinite(Date.parse(`${analysisDate}T00:00:00Z`)) || new Date(`${analysisDate}T00:00:00Z`).toISOString().slice(0, 10) !== analysisDate) throw new RangeError('analysisDate tidak valid.');
  if (!['live', 'historical_replay', 'legacy_unverified'].includes(executionMode)) throw new RangeError('executionMode tidak valid.');
  if (input.informationCutoffAt && (!Number.isFinite(Date.parse(input.informationCutoffAt)) || Date.parse(input.informationCutoffAt) > Date.parse(screenedAt))) throw new RangeError('informationCutoffAt tidak valid atau berada di masa depan.');
  if (input.informationCutoffAt && jakartaDate(new Date(input.informationCutoffAt)) !== analysisDate) throw new RangeError('Tanggal cutoff harus sama dengan analysisDate dalam Asia/Jakarta.');
  if (executionMode === 'live' && analysisDate !== today) throw new RangeError('Live screening hanya dapat memakai tanggal pasar saat ini; gunakan historical_replay untuk tanggal lampau.');
  return { analysisDate, screenedAt, informationCutoffAt: input.informationCutoffAt ?? screenedAt, marketTimezone: MARKET_TIMEZONE, executionMode, marketSession: marketSessionAt(new Date(input.informationCutoffAt ?? screenedAt)), policyVersion: POINT_IN_TIME_POLICY_VERSION };
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
  if (!input.sources.length) reasons.push({ code: 'SOURCE_PROVENANCE_MISSING', message: 'Tidak ada provenance sumber untuk memverifikasi cutoff.' });
  for (const source of input.sources) {
    const validation = validatePointInTimeSource(source, input.context);
    if (!validation.valid) reasons.push({ code: validation.status.toUpperCase(), message: validation.reason, sourceType: source.dataType });
  }
  if (!input.decisionPersistedAt || Date.parse(input.decisionPersistedAt) < Date.parse(input.context.informationCutoffAt)) reasons.push({ code: 'DECISION_SNAPSHOT_MISSING', message: 'Waktu persistensi decision snapshot tidak tersedia atau mendahului feature cutoff.' });
  if (!input.modelVersion) reasons.push({ code: 'MODEL_VERSION_MISSING', message: 'Model version tidak tersedia.' });
  if (!input.configVersion) reasons.push({ code: 'CONFIG_VERSION_MISSING', message: 'Config version tidak tersedia.' });
  return { eligible: reasons.length === 0, reasons };
}
