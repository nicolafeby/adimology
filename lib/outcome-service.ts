import { fetchHistoricalSummary } from './stockbit';
import { getPendingSignalSnapshots, saveSignalOutcome } from './supabase';
export { evaluateDecisionPath } from './decision-outcome';
import { evaluateDecisionPath } from './decision-outcome';
import { netReturnPercent } from './backtest';

export async function evaluateMatureSignals(limit = 100) {
  const snapshots = await getPendingSignalSnapshots(limit);
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
      await saveSignalOutcome({ snapshot_id: snapshot.id, close_5d: at(4), close_10d: at(9), close_20d: at(19), max_high_10d: Math.max(...first10.map((row) => row.high)), min_low_10d: Math.min(...first10.map((row) => row.low)), return_5d: returnAt(4), return_10d: gross10, return_20d: returnAt(19), target_hit: path ? path.status === 'target' : snapshot.target_price ? first10.some((row) => row.high >= Number(snapshot.target_price)) : null, stop_hit: path ? path.status === 'stop' : snapshot.stop_price ? first10.some((row) => row.low <= Number(snapshot.stop_price)) : null, entry_touched: path?.entered ?? null, outcome_status: path?.status ?? null, holding_period: path?.holdingPeriod ?? null, maximum_favorable_excursion: path?.mfePercent ?? null, maximum_adverse_excursion: path?.maePercent ?? null, net_return: gross10 === null ? null : netReturnPercent(gross10), evaluated_at: new Date().toISOString() });
      evaluated++;
    } catch (error) { errors.push({ symbol: snapshot.symbol, error: error instanceof Error ? error.message : String(error) }); }
  }
  return { pending: snapshots.length, evaluated, errors };
}
