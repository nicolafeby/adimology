/** Clock schedule verified against IDX's regular market schedule; holidays are deliberately not inferred. */
export const IDX_SESSION_RULES = Object.freeze({ version: 'idx-regular-session-2025-v1', sourceUrl: 'https://www.idx.id/en/products-services/trading-hours-and-mechanism/', verifiedOn: '2026-09-07', ruleReference: 'II-A Kep-00196/BEI/12-2024' });
export interface ExchangeCalendarDay { date: string; isTradingDay: boolean; sourceUrl: string; availableAt: string; rulesVersion: string; verified: boolean; continuousWindows?: Array<{ start: string; end: string }> }
export interface ExchangeCalendar { days: ExchangeCalendarDay[]; coverageStart: string; coverageEnd: string }
export type SessionPhase = 'pre_open' | 'opening_auction' | 'continuous_morning' | 'break' | 'continuous_afternoon' | 'closing_auction' | 'post_close' | 'closed' | 'unknown';
export function jakartaClock(at: string | Date) { const date = new Date(at); if (!Number.isFinite(date.getTime())) throw new RangeError('Timestamp tidak valid.'); const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23', weekday: 'short' }).formatToParts(date).map(p => [p.type, p.value])); return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}:${parts.second}`, minute: Number(parts.hour) * 60 + Number(parts.minute), weekday: parts.weekday }; }
export function atJakartaTime(date: string, time: string) { return new Date(`${date}T${time.length === 5 ? `${time}:00` : time}+07:00`).toISOString(); }
export function verifiedCalendarDay(calendar: ExchangeCalendar | undefined, date: string, cutoffAt?: string) { const day = calendar?.days.find(d => d.date === date); if (!day || !day.verified || !/^https:\/\//.test(day.sourceUrl) || !day.rulesVersion || !Number.isFinite(Date.parse(day.availableAt)) || (cutoffAt && Date.parse(day.availableAt) > Date.parse(cutoffAt))) return null; return day; }
export function sessionPhaseAt(at: string | Date, calendar?: ExchangeCalendar) {
  const clock = jakartaClock(at), day = verifiedCalendarDay(calendar, clock.date, new Date(at).toISOString()), friday = clock.weekday === 'Fri'; let phase: SessionPhase;
  if (day?.isTradingDay === false || ['Sat', 'Sun'].includes(clock.weekday)) phase = 'closed';
  else if (clock.time < '08:45:00') phase = 'pre_open';
  else if (clock.time < '09:00:00') phase = 'opening_auction';
  else if (clock.time <= (friday ? '11:30:00' : '12:00:00')) phase = 'continuous_morning';
  else if (clock.time < (friday ? '14:00:00' : '13:30:00')) phase = 'break';
  else if (clock.time < '15:50:00') phase = 'continuous_afternoon';
  else if (clock.time < '16:02:00') phase = 'closing_auction';
  else phase = 'post_close';
  let continuous = phase === 'continuous_morning' || phase === 'continuous_afternoon';
  if (day?.continuousWindows) { continuous = day.continuousWindows.some(w => clock.time >= `${w.start}:00` && clock.time < `${w.end}:00`); if (!continuous && phase.startsWith('continuous')) phase = 'closed'; }
  return { phase, continuous, calendarVerified: day !== null, tradingDate: clock.date, ruleVersion: day?.rulesVersion ?? IDX_SESSION_RULES.version };
}
/** Every intervening calendar day must be explicit, including holidays and weekends. */
export function nextTradingSession(date: string, calendar?: ExchangeCalendar, cutoffAt?: string): string | null {
  if (!calendar) return null;
  for (let offset = 1; offset <= 31; offset++) { const next = new Date(`${date}T00:00:00Z`); next.setUTCDate(next.getUTCDate() + offset); const key = next.toISOString().slice(0, 10); if (key > calendar.coverageEnd) return null; const day = verifiedCalendarDay(calendar, key, cutoffAt); if (!day) return null; if (day.isTradingDay) return key; }
  return null;
}
