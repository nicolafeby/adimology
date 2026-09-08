import { fetchHistoricalSummary } from './stockbit';
import { getPendingSignalSnapshots, saveSignalOutcome, getStrategyOutcomeArchive } from './supabase';
export { evaluateDecisionPath } from './decision-outcome';
import { calculateTradeOutcome, loadBacktestConfig } from './backtest';
import { evaluateStrategyBacktest, marketBacktestReadiness, type StrategyBacktestSignal, type StrategyOutcomeArchive } from './strategy-backtest';
import { strategyIdentity, type StrategyId } from './strategies';

/** Intraday archives must be explicitly supplied; live daily prices are never an intraday fallback. */
export interface OutcomeDependencies { pending: typeof getPendingSignalSnapshots; save: typeof saveSignalOutcome; daily: typeof fetchHistoricalSummary }
const defaultDependencies: OutcomeDependencies = { pending:getPendingSignalSnapshots,save:saveSignalOutcome,daily:fetchHistoricalSummary };
export async function evaluateMatureSignals(limit = 100, strategyId: StrategyId = 'swing', archiveLoader: (snapshotId: string) => Promise<StrategyOutcomeArchive | undefined> = getStrategyOutcomeArchive, dependencies: OutcomeDependencies = defaultDependencies) {
  const config = loadBacktestConfig(), identity = strategyIdentity(strategyId);
  const snapshots = await dependencies.pending(limit, config.configVersion, strategyId);
  let evaluated = 0, insufficientData = 0, excluded = 0;
  const errors: Array<{ symbol: string; error: string }> = [];
  for (const snapshot of snapshots) {
    try {
      if (Object.entries(identity).some(([key,value])=>snapshot[key] !== value) || snapshot.point_in_time_valid !== true || snapshot.backtest_eligible !== true || !['live','historical_replay'].includes(snapshot.execution_mode)) { excluded++; continue; }
      const decision = snapshot.feature_snapshot?.decision;
      if (strategyId !== 'swing') {
        const signal: StrategyBacktestSignal = { ...identity, snapshotId:String(snapshot.id),symbol:snapshot.symbol,cutoffAt:snapshot.information_cutoff_at,executionMode:snapshot.execution_mode,origin:snapshot.execution_mode==='live'?'live_observed':'historical_archive',pointInTimeValid:true,backtestEligible:true,entryLow:Number(decision?.entry?.lower),entryHigh:Number(decision?.entry?.upper),stopPrice:Number(decision?.stop?.price),targetPrice:Number(decision?.targets?.target1),shares:Number(decision?.positionSizing?.shares ?? config.lotSize),officialAra:snapshot.feature_snapshot?.official_ara,alreadyTouchedAra:snapshot.feature_snapshot?.strategy_assessment?.monitoring === 'already_touched' || snapshot.feature_snapshot?.strategy_assessment?.monitoring === 'locked' };
        const outcome = evaluateStrategyBacktest(signal, await archiveLoader?.(String(snapshot.id)), config);
        if (outcome.status === 'insufficient_data' || outcome.status === 'pending') { insufficientData++; continue; }
        await dependencies.save({ ...identity,snapshot_id:snapshot.id,backtest_config_version:config.configVersion,execution_mode:snapshot.execution_mode,entry_triggered:!!outcome.entryAt,entry_date:outcome.entryAt?.slice(0,10)??null,exit_date:outcome.exitAt?.slice(0,10)??null,exit_reason:outcome.status==='closed'?outcome.exitReason:outcome.status,outcome_status:outcome.status,raw_entry_price:outcome.rawEntryPrice,executed_entry_price:outcome.executedEntryPrice,raw_exit_price:outcome.rawExitPrice,executed_exit_price:outcome.executedExitPrice,buy_fee:outcome.buyFee,sell_fee:outcome.sellFee,net_pnl:outcome.netPnl,net_return_percent:outcome.netReturnPercent,gross_return_percent:outcome.grossReturnPercent,is_ambiguous:outcome.status==='ambiguous',horizon_outcomes:{strategyOutcome:outcome},evaluated_at:new Date().toISOString() }); evaluated++; continue;
      }
      if (!decision?.entry?.lower || !decision?.entry?.upper || !decision?.stop?.price || !decision?.targets?.target1) { excluded++; continue; }
      const end = new Date(`${snapshot.signal_date}T00:00:00Z`); end.setUTCDate(end.getUTCDate()+60);
      const replayArchive = snapshot.execution_mode === 'historical_replay' ? await archiveLoader(String(snapshot.id)) : undefined;
      if (snapshot.execution_mode === 'historical_replay' && (replayArchive?.origin !== 'historical_archive' || !replayArchive?.dailyCandles?.length || !replayArchive.historicalUniverseVerified || !replayArchive.corporateActionsVerified || !replayArchive.source || replayArchive.missingIntervals.length)) { insufficientData++; continue; }
      // Replay consumes only explicitly recorded outcome archives, never an endpoint for current adjusted history.
      const rawRows = snapshot.execution_mode === 'historical_replay' ? replayArchive!.dailyCandles! : await dependencies.daily(snapshot.symbol,snapshot.signal_date,end.toISOString().slice(0,10),45);
      const rows = rawRows.filter(row=>row.date>snapshot.signal_date && (!replayArchive || Date.parse(`${row.date}T16:15:00+07:00`) <= Date.parse(replayArchive.asOf))).sort((a,b)=>a.date.localeCompare(b.date));
      const setup = { signalDate:snapshot.signal_date,entryLow:Number(decision.entry.lower),entryHigh:Number(decision.entry.upper),stopPrice:Number(decision.stop.price),target1:Number(decision.targets.target1),target2:decision.targets.target2?Number(decision.targets.target2):null,validSessions:Number(decision.validUntil?.tradingSessions??5),spreadPercent:typeof snapshot.feature_snapshot?.execution_spread_percent==='number'?snapshot.feature_snapshot.execution_spread_percent:null };
      const horizons = [5,10,20].map(horizon=>({horizon,outcome:calculateTradeOutcome(rows,{...setup,horizon},config)}));
      if (horizons.some(item=>item.outcome.exitReason==='insufficient_data')) { insufficientData++; continue; }
      // The persisted definition is net_return_10d_positive; never calibrate it from a 20-session trade.
      const modern = horizons[1].outcome;
      await dependencies.save({ ...identity,snapshot_id:snapshot.id,backtest_config_version:config.configVersion,execution_mode:snapshot.execution_mode,entry_triggered:modern.entryTriggered,entry_date:modern.entryDate,raw_entry_price:modern.rawEntryPrice,executed_entry_price:modern.executedEntryPrice,raw_exit_price:modern.rawExitPrice,executed_exit_price:modern.executedExitPrice,exit_date:modern.exitDate,exit_reason:modern.exitReason,shares:modern.shares,calculation_basis:modern.calculationBasis,buy_fee:modern.buyFee,sell_fee:modern.sellFee,entry_slippage_percent:modern.entrySlippagePercent,exit_slippage_percent:modern.exitSlippagePercent,slippage_source:modern.slippageSource,gross_pnl:modern.grossPnl,net_pnl:modern.isAmbiguous?null:modern.netPnl,gross_return_percent:modern.isAmbiguous?null:modern.grossReturnPercent,net_return_percent:modern.isAmbiguous?null:modern.netReturnPercent,initial_risk:modern.initialRisk,r_multiple:modern.isAmbiguous?null:modern.rMultiple,mfe:modern.mfe,mae:modern.mae,mfe_percent:modern.mfePercent,mae_percent:modern.maePercent,mfe_r:modern.mfeR,mae_r:modern.maeR,holding_sessions:modern.holdingSessions,is_ambiguous:modern.isAmbiguous,ambiguity_reason:modern.ambiguityReason,close_5d:rows[4]?.close??null,close_10d:rows[9]?.close??null,close_20d:rows[19]?.close??null,return_5d:horizons[0].outcome.isAmbiguous?null:horizons[0].outcome.grossReturnPercent,return_10d:modern.isAmbiguous?null:modern.grossReturnPercent,return_20d:horizons[2].outcome.isAmbiguous?null:horizons[2].outcome.grossReturnPercent,target_hit:modern.targetHit,stop_hit:modern.stopHit,entry_touched:modern.entryTriggered,outcome_status:modern.exitReason,holding_period:modern.holdingSessions,maximum_favorable_excursion:modern.mfePercent,maximum_adverse_excursion:modern.maePercent,net_return:modern.isAmbiguous?null:modern.netReturnPercent,horizon_outcomes:horizons,evaluated_at:new Date().toISOString() }); evaluated++;
    } catch { errors.push({symbol:snapshot.symbol,error:'Data outcome simbol gagal dievaluasi.'}); }
  }
  return { ...identity,pending:snapshots.length,evaluated,insufficientData,excluded,errors,status:evaluated?'evaluated':'insufficient_data',readiness:evaluated?null:marketBacktestReadiness(strategyId) };
}
