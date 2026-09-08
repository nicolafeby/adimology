import { getStrategy, strategyIdentity, type StrategyId, type StrategyIdentity, type StrategySupportLevel } from './strategies';
import { atJakartaTime, jakartaClock, nextTradingSession, sessionPhaseAt, type ExchangeCalendar } from './market-calendar';
import type { EligibilityRule, EligibilityStatus, ScreeningStatus } from './screening';

export interface IntradayCandle { startAt: string; endAt: string; availableAt: string; open: number; high: number; low: number; close: number; volume: number; tradedValue: number; resolution: 'intraday'; sessionDate: string }
export interface SameClockVolume { sessionDate: string; throughTime: string; cumulativeVolume: number; availableAt: string }
export interface OfficialAraLimit { symbol: string; sessionDate: string; price: number; sourceUrl: string; sourceType: 'exchange' | 'official_provider_field'; observedAt: string; availableAt: string; board: string; referencePrice: number; rulesVersion: string }
export interface TimestampedBook { observedAt: string; availableAt: string; bids: Array<{ price: number; shares: number }>; offers: Array<{ price: number; shares: number }> }
export interface StrategyScreeningData { symbol: string; candles: IntradayCandle[]; sameClockVolumes: SameClockVolume[]; calendar?: ExchangeCalendar; book?: TimestampedBook; officialAra?: OfficialAraLimit; sessionCoverageFromOpen: boolean; suspended?: { active: boolean; sourceUrl: string; availableAt: string }; providerError?: string }
export interface StrategyScreeningAssessment extends StrategyIdentity { support: { level: StrategySupportLevel; reasons: string[] }; screeningStatus: ScreeningStatus; eligibilityStatus: EligibilityStatus; rules: EligibilityRule[]; rankingScore: number | null; heuristicScore: number | null; calibratedProbability: null; monitoring: 'candidate' | 'already_touched' | 'locked' | 'unavailable' | null; reasonCategory: 'strategy_rules' | 'insufficient_data' | 'provider_error' | 'monitoring' | 'eligible'; metrics: Record<string, number | null>; officialAra?: OfficialAraLimit | null; validUntil: string; warnings: string[] }
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const validAt = (value: string | undefined, cutoff: number) => !!value && Number.isFinite(Date.parse(value)) && Date.parse(value) <= cutoff;
const clamp = (value: number) => Math.max(0, Math.min(100, value));
export function completedIntradayCandles(rows: IntradayCandle[], cutoffAt: string, sessionDate: string) {
  const cutoff = Date.parse(cutoffAt);
  return rows.filter(row => row.resolution === 'intraday' && row.sessionDate === sessionDate && validAt(row.endAt, cutoff) && validAt(row.availableAt, cutoff) && Date.parse(row.startAt) < Date.parse(row.endAt) && [row.open, row.high, row.low, row.close, row.volume, row.tradedValue].every(finite) && row.low > 0 && row.low <= Math.min(row.open, row.close) && row.high >= Math.max(row.open, row.close) && row.volume > 0 && row.tradedValue > 0).sort((a,b) => Date.parse(a.startAt) - Date.parse(b.startAt));
}
export function sameClockRelativeVolume(volume: number, throughTime: string, rows: SameClockVolume[], sessionDate: string, cutoffAt: string, minimumSessions = 5): number | null {
  const cutoff = Date.parse(cutoffAt), sessions = new Map<string, number>();
  for (const row of rows) if (row.sessionDate < sessionDate && row.throughTime === throughTime && finite(row.cumulativeVolume) && row.cumulativeVolume > 0 && validAt(row.availableAt, cutoff)) sessions.set(row.sessionDate, row.cumulativeVolume);
  const values = [...sessions.values()]; return values.length >= minimumSessions && finite(volume) ? volume / (values.reduce((sum,x) => sum + x, 0) / values.length) : null;
}
export function validOfficialAra(limit: OfficialAraLimit | undefined, symbol: string, sessionDate: string, cutoffAt: string): limit is OfficialAraLimit {
  const cutoff = Date.parse(cutoffAt);
  return !!limit && limit.symbol === symbol && limit.sessionDate === sessionDate && finite(limit.price) && limit.price > 0 && finite(limit.referencePrice) && limit.referencePrice > 0 && !!limit.board && !!limit.rulesVersion && ['exchange','official_provider_field'].includes(limit.sourceType) && /^https:\/\//.test(limit.sourceUrl) && validAt(limit.observedAt, cutoff) && validAt(limit.availableAt, cutoff);
}
/** No daily fallback and no AI input: admission/ranking are frozen quantitative results. */
export function evaluateStrategyScreening(input: { strategyId: StrategyId; cutoffAt: string; data?: StrategyScreeningData }): StrategyScreeningAssessment {
  const profile = getStrategy(input.strategyId), clock = jakartaClock(input.cutoffAt), cutoff = Date.parse(input.cutoffAt), data = input.data;
  const result: StrategyScreeningAssessment = { ...strategyIdentity(input.strategyId), support: { level: 'unavailable', reasons: [] }, screeningStatus: 'watch', eligibilityStatus: 'needs_confirmation', rules: [], rankingScore: null, heuristicScore: null, calibratedProbability: null, monitoring: input.strategyId === 'ara' ? 'unavailable' : null, reasonCategory: 'insufficient_data', metrics: {}, validUntil: atJakartaTime(clock.date, profile.entry.end), warnings: ['Threshold intraday merupakan baseline belum tervalidasi; skor heuristik bukan probabilitas.'] };
  const rule = (key: string, passed: boolean, actualValue: unknown, requiredValue: unknown, explanation: string, category = 'strategy') => result.rules.push({ key, label: key.replaceAll('_',' '), category, severity: 'hard_gate', passed, actualValue, requiredValue, explanation });
  if (input.strategyId === 'swing') { result.support = { level: 'partial', reasons: ['Gunakan evaluator baseline SWING existing untuk daily 5–20 sesi.'] }; return result; }
  if (data?.providerError) { result.screeningStatus = 'processing_error'; result.eligibilityStatus = 'not_evaluated'; result.reasonCategory = 'provider_error'; result.support.reasons.push('Provider gagal mengambil data wajib.'); return result; }
  const phase = sessionPhaseAt(input.cutoffAt, data?.calendar), bars = completedIntradayCandles(data?.candles ?? [], input.cutoffAt, clock.date), latest = bars.at(-1);
  const sumVolume = bars.reduce((s,b) => s+b.volume,0), sumValue = bars.reduce((s,b) => s+b.tradedValue,0), price = latest?.close ?? null;
  const vwap = sumVolume > 0 ? sumValue / sumVolume : null, momentum = latest && bars[0] ? (latest.close/bars[0].open-1)*100 : null;
  const throughTime = latest ? jakartaClock(latest.endAt).time.slice(0,5) : null;
  const rvol = throughTime ? sameClockRelativeVolume(sumVolume, throughTime, data?.sameClockVolumes ?? [], clock.date, input.cutoffAt) : null;
  const book = data?.book, bookFresh = !!book && validAt(book.observedAt, cutoff) && validAt(book.availableAt, cutoff) && cutoff - Date.parse(book.observedAt) <= profile.freshness.orderbookSeconds * 1000;
  const bids = (book?.bids ?? []).filter(b => finite(b.price) && b.price > 0 && finite(b.shares) && b.shares > 0).sort((a,b)=>b.price-a.price), offers = (book?.offers ?? []).filter(b => finite(b.price) && b.price > 0 && finite(b.shares) && b.shares > 0).sort((a,b)=>a.price-b.price);
  const spread = bids[0] && offers[0] && offers[0].price >= bids[0].price ? (offers[0].price/bids[0].price-1)*100 : null;
  const officialAra = validOfficialAra(data?.officialAra, data?.symbol ?? '', clock.date, input.cutoffAt) ? data!.officialAra! : undefined;
  result.officialAra = officialAra ?? null;
  const touched = !!officialAra && bars.some(b=>b.high >= officialAra.price), locked = touched && price === officialAra?.price && bookFresh && bids[0]?.price === officialAra?.price && offers.length === 0;
  result.metrics = { price, vwap, momentumPercent: momentum, sameClockRelativeVolume: rvol, spreadPercent: spread, tradedValue: sumValue || null, officialAraPrice: officialAra?.price ?? null, distanceToAraPercent: officialAra && price ? (officialAra.price/price-1)*100 : null, openingRangeHigh: bars.length ? Math.max(...bars.filter(b=>jakartaClock(b.endAt).time <= '09:15:00').map(b=>b.high), bars[0].high) : null, sessionRangePosition: bars.length && price ? (price-Math.min(...bars.map(b=>b.low)))/Math.max(1, Math.max(...bars.map(b=>b.high))-Math.min(...bars.map(b=>b.low))) : null };
  const missing: string[] = [];
  if (!phase.calendarVerified) missing.push('Kalender bursa pada cutoff belum diverifikasi.');
  if (!latest || !data?.sessionCoverageFromOpen) missing.push('Candle intraday selesai dari awal sesi sampai cutoff belum lengkap.');
  if (rvol === null) missing.push('Minimum 5 sesi volume kumulatif pada jam pembanding yang sama belum tersedia.');
  if (!bookFresh) missing.push('Orderbook bertimestamp segar dan tersedia sebelum cutoff belum tersedia.');
  const next = input.strategyId === 'bsjp' ? nextTradingSession(clock.date, data?.calendar, input.cutoffAt) : null;
  if (input.strategyId === 'bsjp' && !next) missing.push('Sesi bursa berikutnya belum terverifikasi; akhir pekan/libur tidak boleh ditebak.');
  if (input.strategyId === 'ara' && !officialAra) missing.push('ARA resmi untuk simbol/sesi dengan timestamp sumber belum tersedia.');
  rule('required_data', missing.length === 0, missing, profile.dataRequirements, 'Missing data wajib menghasilkan insufficient_data.', 'data');
  rule('continuous_session', phase.calendarVerified && phase.continuous, phase.phase, 'verified continuous session', 'Lelang, istirahat dan hari non-bursa bukan jendela eksekusi.');
  rule('entry_window', clock.time >= `${profile.entry.start}:00` && clock.time < `${profile.entry.end}:00`, clock.time, `${profile.entry.start}–${profile.entry.end} WIB`, 'Sinyal kedaluwarsa pada akhir jendela entry.');
  rule('intraday_freshness', !!latest && cutoff-Date.parse(latest.endAt) <= profile.freshness.intradaySeconds*1000, latest?.endAt ?? null, `<= ${profile.freshness.intradaySeconds} detik`, 'Hanya candle selesai dan tersedia sebelum cutoff.');
  rule('positive_momentum', momentum !== null && momentum > 0, momentum, '> 0%', 'Momentum sesi positif adalah baseline awal.');
  rule('above_vwap', price !== null && vwap !== null && price >= vwap, { price, vwap }, 'price >= session VWAP', 'VWAP memakai nilai dan volume transaksi sampai cutoff.');
  rule('same_clock_rvol', rvol !== null && rvol >= profile.risk.minimumSameClockRelativeVolume, rvol, `>= ${profile.risk.minimumSameClockRelativeVolume}x`, 'Volume dibandingkan jam yang setara, bukan volume final harian.');
  rule('spread', spread !== null && spread <= profile.risk.maxSpreadPercent, spread, `<= ${profile.risk.maxSpreadPercent}%`, 'Orderbook satu sisi tidak membuktikan fill.');
  rule('liquidity', sumValue >= profile.risk.minimumTradedValueIdr, sumValue || null, `>= ${profile.risk.minimumTradedValueIdr} IDR`, 'Likuiditas kumulatif sampai cutoff; baseline belum tervalidasi.');
  const suspended = data?.suspended?.active === true && /^https:\/\//.test(data.suspended.sourceUrl) && validAt(data.suspended.availableAt, cutoff);
  rule('not_suspended', !suspended, suspended, false, 'Hanya status operasional resmi berprovenance menjadi gate.');
  if (input.strategyId === 'ara') { result.monitoring = officialAra ? locked ? 'locked' : touched ? 'already_touched' : 'candidate' : 'unavailable'; rule('not_already_ara', !!officialAra && !touched, result.monitoring, 'candidate', 'Sudah menyentuh ARA hanya monitoring; snapshot satu sisi tidak menjamin arah berikutnya.'); result.warnings.push('Fill uncertainty: posisi antrean tidak diketahui; evaluasi ARA adalah kejadian, bukan P&L.'); }
  if (input.strategyId === 'bsjp') result.warnings.push('Risiko gap overnight dan agenda peristiwa sampai pagi sesi berikutnya wajib ditinjau; stop dapat tereksekusi lebih buruk saat gap.');
  result.support = { level: missing.length ? bars.length ? 'partial' : 'unavailable' : 'ready', reasons: missing };
  if (touched) { result.reasonCategory = 'monitoring'; return result; }
  if (missing.length) return result;
  if (result.rules.some(r=>!r.passed)) { result.screeningStatus = 'rejected'; result.eligibilityStatus = 'ineligible'; result.reasonCategory = 'strategy_rules'; return result; }
  const score = clamp(35 + clamp((momentum ?? 0)*10)*0.25 + clamp((rvol ?? 0)*25)*0.25 + clamp((1-(spread ?? 1))*100)*0.15 + (input.strategyId === 'ara' ? clamp(100-(result.metrics.distanceToAraPercent ?? 100)*10)*0.15 : clamp((result.metrics.sessionRangePosition ?? 0)*100)*0.15));
  result.heuristicScore = Math.round(score*100)/100; result.rankingScore = result.heuristicScore; result.screeningStatus = 'passed'; result.eligibilityStatus = 'eligible'; result.reasonCategory = 'eligible'; return result;
}
