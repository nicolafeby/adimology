import { fetchHistoricalSummary } from './stockbit';
import { getPendingSignalSnapshots, saveSignalOutcome } from './supabase';
export { evaluateDecisionPath } from './decision-outcome';
import { evaluateDecisionPath } from './decision-outcome';
import { netReturnPercent } from './backtest';
import { calculateTradeOutcome, loadBacktestConfig } from './backtest';

export async function evaluateMatureSignals(limit = 100) {
  const config = loadBacktestConfig();
  const snapshots = await getPendingSignalSnapshots(limit, config.configVersion);
  let evaluated = 0;
  const errors: Array<{ symbol: string; error: string }> = [];
  for (const snapshot of snapshots) {
    try {
      const end = new Date(`${snapshot.signal_date}T00:00:00Z`);
      end.setUTCDate(end.getUTCDate() + 45);
      const rows = (await fetchHistoricalSummary(snapshot.symbol, snapshot.signal_date, end.toISOString().slice(0, 10), 35)).filter((row) => row.date > snapshot.signal_date).sort((a, b) => a.date.localeCompare(b.date));
      if (rows.length < 20) continue;
      const decision = snapshot.feature_snapshot?.decision;
      const entry = Number(decision?.entry?.reference ?? snapshot.entry_price);
      const at = (index: number) => rows[index]?.close ?? null;
      const path = decision?.entry?.lower && decision?.entry?.upper && decision?.stop?.price && decision?.targets?.target1
        ? evaluateDecisionPath(rows, Number(decision.entry.lower), Number(decision.entry.upper), Number(decision.stop.price), Number(decision.targets.target1), Number(decision.validUntil?.tradingSessions ?? 5)) : null;
      const returnAt = (index: number) => !entry || path?.entered === false ? null : rows[(path?.entryIndex ?? 0) + index]?.close ? (Number(rows[(path?.entryIndex ?? 0) + index].close) / entry - 1) * 100 : null;
      const first10 = rows.slice(0, 10);
      const gross10 = returnAt(9);
      const modern = decision?.entry?.lower && decision?.entry?.upper && decision?.stop?.price && decision?.targets?.target1
        ? calculateTradeOutcome(rows, { signalDate: snapshot.signal_date, entryLow: Number(decision.entry.lower), entryHigh: Number(decision.entry.upper), stopPrice: Number(decision.stop.price), target1: Number(decision.targets.target1), target2: decision.targets.target2 ? Number(decision.targets.target2) : null, validSessions: Number(decision.validUntil?.tradingSessions ?? 5), horizon: 20, spreadPercent: Number.isFinite(Number(snapshot.feature_snapshot?.execution_spread_percent)) ? Number(snapshot.feature_snapshot.execution_spread_percent) : null }, config)
        : null;
      await saveSignalOutcome({ snapshot_id: snapshot.id, backtest_config_version: config.configVersion, execution_model: modern ? 'entry_zone_conservative' : 'legacy_close', entry_triggered: modern?.entryTriggered ?? null, entry_date: modern?.entryDate ?? null, raw_entry_price: modern?.rawEntryPrice ?? entry, executed_entry_price: modern?.executedEntryPrice ?? entry, raw_exit_price: modern?.rawExitPrice ?? at(19), executed_exit_price: modern?.executedExitPrice ?? at(19), exit_date: modern?.exitDate ?? rows[19]?.date ?? null, exit_reason: modern?.exitReason ?? 'time_exit', shares: modern?.shares ?? null, calculation_basis: modern?.calculationBasis ?? 'one_share_legacy', buy_fee: modern?.buyFee ?? null, sell_fee: modern?.sellFee ?? null, entry_slippage_percent: modern?.entrySlippagePercent ?? null, exit_slippage_percent: modern?.exitSlippagePercent ?? null, slippage_source: modern?.slippageSource ?? null, gross_pnl: modern?.grossPnl ?? null, net_pnl: modern?.netPnl ?? null, gross_return_percent: modern?.grossReturnPercent ?? gross10, net_return_percent: modern?.netReturnPercent ?? (gross10 === null ? null : netReturnPercent(gross10)), initial_risk: modern?.initialRisk ?? null, r_multiple: modern?.rMultiple ?? null, mfe: modern?.mfe ?? null, mae: modern?.mae ?? null, mfe_percent: modern?.mfePercent ?? path?.mfePercent ?? null, mae_percent: modern?.maePercent ?? path?.maePercent ?? null, mfe_r: modern?.mfeR ?? null, mae_r: modern?.maeR ?? null, holding_sessions: modern?.holdingSessions ?? path?.holdingPeriod ?? null, is_ambiguous: modern?.isAmbiguous ?? path?.status === 'ambiguous', ambiguity_reason: modern?.ambiguityReason ?? null, close_5d: at(4), close_10d: at(9), close_20d: at(19), max_high_10d: Math.max(...first10.map((row) => row.high)), min_low_10d: Math.min(...first10.map((row) => row.low)), return_5d: returnAt(4), return_10d: gross10, return_20d: returnAt(19), target_hit: modern?.targetHit ?? (path ? path.status === 'target' : snapshot.target_price ? first10.some((row) => row.high >= Number(snapshot.target_price)) : null), stop_hit: modern?.stopHit ?? (path ? path.status === 'stop' : snapshot.stop_price ? first10.some((row) => row.low <= Number(snapshot.stop_price)) : null), entry_touched: modern?.entryTriggered ?? path?.entered ?? null, outcome_status: modern?.exitReason ?? path?.status ?? null, holding_period: modern?.holdingSessions ?? path?.holdingPeriod ?? null, maximum_favorable_excursion: modern?.mfePercent ?? path?.mfePercent ?? null, maximum_adverse_excursion: modern?.maePercent ?? path?.maePercent ?? null, net_return: modern?.netReturnPercent ?? (gross10 === null ? null : netReturnPercent(gross10)), evaluated_at: new Date().toISOString() });
      evaluated++;
    } catch (error) { errors.push({ symbol: snapshot.symbol, error: error instanceof Error ? error.message : String(error) }); }
  }
  return { pending: snapshots.length, evaluated, errors };
}
