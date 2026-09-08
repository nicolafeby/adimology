import { applyExecutionCost, applySlippage, calculateTradeOutcome, DEFAULT_BACKTEST_CONFIG, resolveSlippage, summarizeBacktest, type BacktestCandle, type BacktestConfig, type TradeSetup } from './backtest';
import { atJakartaTime, jakartaClock, nextTradingSession, sessionPhaseAt, verifiedCalendarDay, type ExchangeCalendar } from './market-calendar';
import { getStrategy, strategyIdentity, type StrategyId, type StrategyIdentity } from './strategies';
import { validOfficialAra, type IntradayCandle, type OfficialAraLimit } from './strategy-screening';

export type StrategyOutcomeStatus = 'no_entry' | 'pending' | 'ambiguous' | 'unfilled' | 'closed' | 'insufficient_data' | 'excluded';
export interface StrategyBacktestSignal extends StrategyIdentity {
  snapshotId: string; symbol: string; cutoffAt: string; executionMode: 'live' | 'historical_replay' | 'legacy_unverified';
  origin: 'live_observed' | 'historical_archive' | 'fixture' | 'legacy_unverified'; pointInTimeValid: boolean; backtestEligible: boolean;
  entryLow: number; entryHigh: number; stopPrice: number; targetPrice: number; shares: number;
  officialAra?: OfficialAraLimit; alreadyTouchedAra: boolean; spreadPercent?: number | null;
}
/** A source archive, not a live provider fallback. Coverage is an explicit source assertion. */
export interface StrategyOutcomeArchive { origin: StrategyBacktestSignal['origin']; candles: IntradayCandle[]; dailyCandles?: BacktestCandle[]; calendar: ExchangeCalendar; asOf: string; coverageStart: string; completeThrough: string; missingIntervals: Array<{ startAt: string; endAt: string }>; source: string; historicalUniverseVerified: boolean; corporateActionsVerified: boolean; suspendedSessions?: string[]; maxParticipationPercent?: number }
export interface StrategyBacktestOutcome extends StrategyIdentity {
  snapshotId: string; symbol: string; cutoffAt: string; origin: StrategyBacktestSignal['origin']; executionMode: StrategyBacktestSignal['executionMode'];
  status: StrategyOutcomeStatus; reason: string; entryAt: string | null; exitAt: string | null; exitReason: 'stop' | 'target' | 'time_exit' | 'ara_event' | null;
  rawEntryPrice: number | null; rawExitPrice: number | null; executedEntryPrice: number | null; executedExitPrice: number | null;
  buyFee: number | null; sellFee: number | null; netPnl: number | null; grossReturnPercent: number | null; netReturnPercent: number | null;
  maePercent: number | null; mfePercent: number | null; holdingMinutes: number | null;
  araTouchedAfterCutoff: boolean | null; timeToAraMinutes: number | null; fillUncertainty: boolean; excludedFromCalibration: boolean; warnings: string[];
}
const time = (value: string) => Date.parse(value);
const finite = (value: number) => Number.isFinite(value);
function empty(signal: StrategyBacktestSignal): StrategyBacktestOutcome { return { ...strategyIdentity(signal.strategy_id), snapshotId: signal.snapshotId, symbol: signal.symbol, cutoffAt: signal.cutoffAt, executionMode: signal.executionMode, origin: signal.origin, status: 'insufficient_data', reason: 'Arsip outcome belum lengkap.', entryAt: null, exitAt: null, exitReason: null, rawEntryPrice: null, rawExitPrice: null, executedEntryPrice: null, executedExitPrice: null, buyFee: null, sellFee: null, netPnl: null, grossReturnPercent: null, netReturnPercent: null, maePercent: null, mfePercent: null, holdingMinutes: null, araTouchedAfterCutoff: null, timeToAraMinutes: null, fillUncertainty: true, excludedFromCalibration: true, warnings: [] }; }
function compatible(signal: StrategyBacktestSignal) { const identity = strategyIdentity(signal.strategy_id); return Object.entries(identity).every(([key,value]) => signal[key as keyof StrategyIdentity] === value); }
function hasCoverage(archive: StrategyOutcomeArchive, from: string, through: string) { return time(archive.coverageStart) <= time(from) && time(archive.completeThrough) >= time(through) && archive.missingIntervals.every(gap => time(gap.endAt) <= time(from) || time(gap.startAt) >= time(through)); }

/** Intraday and overnight engine. Decisions consume no candle that ends after cutoff. Outcomes consume only later bars. */
export function evaluateStrategyBacktest(signal: StrategyBacktestSignal, archive: StrategyOutcomeArchive | undefined, config: BacktestConfig = { ...DEFAULT_BACKTEST_CONFIG }): StrategyBacktestOutcome {
  const result = empty(signal), profile = getStrategy(signal.strategy_id), clock = jakartaClock(signal.cutoffAt);
  if (!compatible(signal) || !signal.pointInTimeValid || !signal.backtestEligible || signal.executionMode === 'legacy_unverified' || signal.origin === 'legacy_unverified') { result.status = 'excluded'; result.reason = 'Identitas strategi atau provenance snapshot tidak valid.'; return result; }
  if (signal.strategy_id === 'swing') { result.reason = 'Gunakan evaluateSwingBacktest untuk baseline daily 5/10/20 sesi.'; return result; }
  if (!archive || archive.origin !== signal.origin || !archive.source || !archive.historicalUniverseVerified || !archive.corporateActionsVerified) { result.reason = 'Arsip intraday, universe historis atau corporate action belum terverifikasi (insufficient_data).'; return result; }
  const phase = sessionPhaseAt(signal.cutoffAt, archive.calendar);
  if (!phase.calendarVerified || !phase.continuous) { result.status = 'excluded'; result.reason = 'Cutoff bukan continuous trading pada hari bursa yang terverifikasi.'; return result; }
  const exitDate = signal.strategy_id === 'bsjp' ? nextTradingSession(clock.date, archive.calendar, signal.cutoffAt) : clock.date;
  if (!exitDate) { result.reason = 'Sesi berikutnya atau kalender libur belum terverifikasi.'; return result; }
  const entryDeadline = atJakartaTime(clock.date, profile.entry.end), exitStart = atJakartaTime(exitDate, profile.exit.start), exitDeadline = atJakartaTime(exitDate, profile.exit.end);
  if (clock.time < `${profile.screening.start}:00` || time(signal.cutoffAt) >= time(entryDeadline)) { result.status = 'no_entry'; result.reason = 'Cutoff di luar jendela sinyal atau entry sudah kedaluwarsa.'; return result; }
  const invalidBars = archive.candles.some(b => b.resolution !== 'intraday' || ![b.open,b.high,b.low,b.close,b.volume,b.tradedValue].every(finite) || b.low <= 0 || b.low > Math.min(b.open,b.close) || b.high < Math.max(b.open,b.close) || b.volume < 0 || !(time(b.startAt) < time(b.endAt)) || !(time(b.availableAt) >= time(b.endAt)) || jakartaClock(b.startAt).date !== b.sessionDate);
  if (invalidBars) { result.reason = 'Arsip berisi candle malformed, daily, atau timestamp tidak sah.'; return result; }
  const sorted = [...archive.candles].sort((a,b) => time(a.startAt)-time(b.startAt));
  if (sorted.some((b,i)=>i > 0 && time(b.startAt) < time(sorted[i-1].endAt))) { result.reason = 'Candle duplikat atau interval tumpang tindih.'; return result; }
  const temporalBars = sorted.filter(b => time(b.startAt) > time(signal.cutoffAt) && time(b.availableAt) <= time(archive.asOf) && time(b.endAt) <= time(archive.asOf) && verifiedCalendarDay(archive.calendar,b.sessionDate,signal.cutoffAt)?.isTradingDay === true);
  const bars = temporalBars.filter(b => sessionPhaseAt(b.startAt, archive.calendar).continuous);
  if (signal.strategy_id === 'ara') {
    if (!validOfficialAra(signal.officialAra, signal.symbol, clock.date, signal.cutoffAt)) { result.reason = 'Batas ARA resmi tidak tersedia pada cutoff.'; return result; }
    if (signal.alreadyTouchedAra) { result.status = 'excluded'; result.reason = 'Sudah menyentuh ARA sebelum cutoff; hanya monitoring.'; return result; }
    const end = atJakartaTime(clock.date, '16:15'), candidates = temporalBars.filter(b=>b.sessionDate === clock.date && time(b.endAt) <= time(end));
    const hit = candidates.find(b=>b.high >= signal.officialAra!.price);
    result.warnings.push('Event touch tidak membuktikan order terisi; P&L ARA tidak dihitung. Waktu touch memakai batas akhir candle.');
    if (hit) { result.status = 'closed'; result.reason = 'Batas ARA resmi disentuh pada candle setelah cutoff.'; result.exitReason = 'ara_event'; result.araTouchedAfterCutoff = true; result.exitAt = hit.endAt; result.timeToAraMinutes = hasCoverage(archive,signal.cutoffAt,hit.endAt) ? (time(hit.endAt)-time(signal.cutoffAt))/60000 : null; result.excludedFromCalibration = signal.origin === 'fixture'; return result; }
    if (!hasCoverage(archive,signal.cutoffAt,end)) { result.status = time(archive.asOf) < time(end) ? 'pending' : 'insufficient_data'; result.reason = 'Sisa sesi belum tercakup lengkap; absence of touch belum dapat dibuktikan.'; return result; }
    result.status = 'closed'; result.reason = 'Tidak menyentuh ARA pada cakupan sisa sesi lengkap.'; result.exitReason = 'ara_event'; result.araTouchedAfterCutoff = false; result.exitAt = end; result.excludedFromCalibration = signal.origin === 'fixture'; return result;
  }
  if (![signal.entryLow,signal.entryHigh,signal.stopPrice,signal.targetPrice,signal.shares].every(x=>finite(x)&&x>0) || signal.entryLow > signal.entryHigh || signal.stopPrice >= signal.entryLow || signal.targetPrice <= signal.entryHigh || signal.shares % config.lotSize !== 0) { result.status = 'excluded'; result.reason = 'Entry, stop, target atau ukuran lot tidak valid.'; return result; }
  const entryCandidates = bars.filter(b=>b.sessionDate === clock.date && time(b.startAt) < time(entryDeadline));
  const entryBar = entryCandidates.find(b=>b.open >= signal.entryLow && b.open <= signal.entryHigh);
  if (!entryBar) { result.status = time(archive.asOf) < time(entryDeadline) ? 'pending' : hasCoverage(archive,signal.cutoffAt,entryDeadline) ? 'no_entry' : 'insufficient_data'; result.reason = 'Tidak ada open candle setelah sinyal di dalam zona entry yang teramati.'; return result; }
  const participation = archive.maxParticipationPercent ?? profile.risk.maxParticipationPercent;
  if (!(participation > 0 && participation <= profile.risk.maxParticipationPercent) || entryBar.volume*participation/100 < signal.shares || archive.suspendedSessions?.includes(clock.date)) { result.status = 'unfilled'; result.reason = 'Entry tidak memenuhi batas likuiditas/participation atau sesi disuspensi.'; return result; }
  const slippage = resolveSlippage(config,signal.spreadPercent), entry = applySlippage(entryBar.open,'buy',slippage.percent);
  result.entryAt = entryBar.startAt; result.rawEntryPrice = entryBar.open; result.executedEntryPrice = entry;
  result.warnings.push('Fill dimodelkan pada open candle berikutnya dengan volume participation; posisi antrean dan volume persis pada open tidak diketahui.');
  let exitBar: IntradayCandle | undefined, rawExit: number | null = null;
  const active = bars.filter(b=>time(b.startAt)>=time(entryBar.startAt) && time(b.startAt)<time(exitDeadline));
  const observed: IntradayCandle[] = [];
  for (const bar of active) {
    if (archive.suspendedSessions?.includes(bar.sessionDate)) continue;
    if (!hasCoverage(archive,entryBar.startAt,bar.startAt)) { result.status = 'insufficient_data'; result.reason = 'Gap data setelah entry membuat urutan stop/target tidak terverifikasi.'; return result; }
    if (bar.open <= signal.stopPrice) { exitBar = bar; rawExit = bar.open; result.exitReason = 'stop'; break; }
    if (bar.open >= signal.targetPrice) { exitBar = bar; rawExit = bar.open; result.exitReason = 'target'; break; }
    if (bar.sessionDate === exitDate && time(bar.startAt)>=time(exitStart)) { exitBar = bar; rawExit = bar.open; result.exitReason = 'time_exit'; break; }
    observed.push(bar);
    const stop = bar.low <= signal.stopPrice, target = bar.high >= signal.targetPrice;
    if (stop && target) { result.status = 'ambiguous'; result.reason = 'Stop dan target pada candle sama; urutan tidak diketahui, P&L dikecualikan.'; result.exitAt = bar.endAt; return result; }
    if (stop || target) { exitBar = bar; rawExit = stop ? signal.stopPrice : signal.targetPrice; result.exitReason = stop ? 'stop' : 'target'; break; }
  }
  if (!exitBar || rawExit === null) { result.status = time(archive.asOf) < time(exitDeadline) ? 'pending' : 'insufficient_data'; result.reason = 'Harga exit pada jendela wajib tidak tersedia; posisi tidak dipindah otomatis ke hari berikutnya.'; return result; }
  if (exitBar.volume*participation/100 < signal.shares) { result.status = 'unfilled'; result.reason = 'Likuiditas exit tidak mendukung fill pada jendela wajib.'; return result; }
  result.exitAt = result.exitReason === 'time_exit' || exitBar.open <= signal.stopPrice || exitBar.open >= signal.targetPrice ? exitBar.startAt : exitBar.endAt;
  result.rawExitPrice = rawExit; result.executedExitPrice = applySlippage(rawExit,'sell',slippage.percent);
  Object.assign(result,applyExecutionCost({executedEntryPrice:entry,executedExitPrice:result.executedExitPrice,shares:signal.shares},config));
  // Excursions only use complete bars before the exit bar; extrema after an intrabar exit are unknowable.
  const excursionBars = observed.filter(b=>b !== exitBar);
  result.maePercent = (Math.min(entry,rawExit,...excursionBars.map(b=>b.low))/entry-1)*100; result.mfePercent = (Math.max(entry,rawExit,...excursionBars.map(b=>b.high))/entry-1)*100;
  result.holdingMinutes = (time(result.exitAt)-time(result.entryAt!))/60000; result.status = 'closed'; result.reason = 'Trade selesai menurut execution model dan asumsi biaya.'; result.excludedFromCalibration = signal.origin === 'fixture'; return result;
}

/** Unchanged strategy thresholds; calculate each requested daily horizon independently. */
export function evaluateSwingBacktest(candles: BacktestCandle[], setup: Omit<TradeSetup,'horizon'>, config: BacktestConfig = { ...DEFAULT_BACKTEST_CONFIG }) { return [5,10,20].map(horizon=>({ ...strategyIdentity('swing'), horizon, outcome:calculateTradeOutcome(candles,{...setup,horizon},config) })); }

export function summarizeStrategyBacktest(outcomes: StrategyBacktestOutcome[], input: { strategyId: StrategyId; origin: StrategyBacktestSignal['origin']; executionMode: StrategyBacktestSignal['executionMode']; developmentEnd: string; holdoutStart: string; periodStart: string; periodEnd: string; source: string; universe: string[]; resolution: string; coverage: string }, config: BacktestConfig = {...DEFAULT_BACKTEST_CONFIG}) {
  if (time(input.developmentEnd) >= time(input.holdoutStart)) throw new RangeError('Development dan holdout harus dipisahkan menurut waktu.');
  const identity = strategyIdentity(input.strategyId), selected = outcomes.filter(o=>Object.entries(identity).every(([k,v])=>o[k as keyof StrategyIdentity]===v) && o.origin===input.origin && o.executionMode===input.executionMode && time(o.cutoffAt)>=time(input.holdoutStart) && time(o.cutoffAt)>=time(input.periodStart) && time(o.cutoffAt)<=time(input.periodEnd));
  const rows = selected.map(o=>({entry_triggered:!!o.entryAt,exit_reason:o.status==='closed'?o.exitReason:o.status,net_return_percent:o.status==='closed'?o.netReturnPercent:null,gross_return_percent:o.grossReturnPercent,exit_date:o.exitAt,mae_percent:o.maePercent,mfe_percent:o.mfePercent,execution_model:o.execution_model}));
  const events = selected.filter(o=>o.status==='closed'&&o.araTouchedAfterCutoff!==null), touches=events.filter(o=>o.araTouchedAfterCutoff===true);
  return { ...identity, ...input, status: selected.length ? 'evaluated' : 'insufficient_data', evidence: input.origin==='fixture'?'deterministic_fixture_not_profitability_evidence':'market_observations', signals:selected.length, counts:Object.fromEntries(['closed','pending','ambiguous','unfilled','no_entry','excluded','insufficient_data'].map(status=>[status,selected.filter(o=>o.status===status).length])), entries:selected.filter(o=>o.entryAt).length, trading:input.strategyId==='ara'?null:summarizeBacktest(rows,config), ara:input.strategyId==='ara'?{evaluated:events.length,touches:touches.length,falsePositives:events.length-touches.length,touchRate:events.length?touches.length/events.length:null,averageTimeToAraMinutes:touches.length?touches.reduce((s,o)=>s+(o.timeToAraMinutes??0),0)/touches.length:null,pnl:null,fillUncertainty:true}:null, drawdownMethod:'sequential_indexed_approximation_not_portfolio_simulation', costs:config, averageHoldingMinutes:selected.some(o=>o.holdingMinutes!==null)?selected.filter(o=>o.holdingMinutes!==null).reduce((s,o)=>s+o.holdingMinutes!,0)/selected.filter(o=>o.holdingMinutes!==null).length:null };
}

export function marketBacktestReadiness(strategyId: StrategyId) { return { ...strategyIdentity(strategyId), status:'insufficient_data' as const, missing: strategyId==='swing'?['Snapshot keputusan dengan provenance, versi strategi dan pemisahan development/holdout yang valid harus tersedia.']:['Arsip candle intraday bertimestamp dan cakupan lengkap sesudah cutoff.', 'Universe historis, corporate actions, kalender dan libur bursa terverifikasi.', ...(strategyId==='ara'?['Batas ARA resmi pada sesi keputusan.']:[])], forwardTest:'Persist immutable signal snapshots and append timestamped source/outcome archives; never infer historical provider timestamps.' }; }
