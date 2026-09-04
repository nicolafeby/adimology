export type DecisionOutcomeStatus = 'expired_no_entry' | 'open' | 'target' | 'stop' | 'ambiguous';
export function evaluateDecisionPath(rows: Array<{ high: number; low: number; close: number }>, entryLow: number, entryHigh: number, stop: number, target: number, validSessions: number) {
  const entryIndex = rows.slice(0, validSessions).findIndex((row) => row.low <= entryHigh && row.high >= entryLow);
  if (entryIndex < 0) return { status: 'expired_no_entry' as const, entered: false, entryIndex: null, holdingPeriod: 0, mfePercent: null, maePercent: null };
  const entry = entryHigh, active = rows.slice(entryIndex); let status: DecisionOutcomeStatus = 'open', holdingPeriod = active.length;
  for (let i = 0; i < active.length; i++) { const targetHit = active[i].high >= target, stopHit = active[i].low <= stop; if (targetHit && stopHit) { status = 'ambiguous'; holdingPeriod = i + 1; break; } if (stopHit) { status = 'stop'; holdingPeriod = i + 1; break; } if (targetHit) { status = 'target'; holdingPeriod = i + 1; break; } }
  const observed = active.slice(0, holdingPeriod);
  return { status, entered: true, entryIndex, holdingPeriod, mfePercent: observed.length ? Math.max(...observed.map((x) => (x.high / entry - 1) * 100)) : null, maePercent: observed.length ? Math.min(...observed.map((x) => (x.low / entry - 1) * 100)) : null };
}
