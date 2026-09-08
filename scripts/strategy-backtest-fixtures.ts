import { writeFileSync } from 'node:fs';
import { DEFAULT_BACKTEST_CONFIG } from '../lib/backtest';
import { evaluateStrategyBacktest, evaluateSwingBacktest, summarizeStrategyBacktest, marketBacktestReadiness } from '../lib/strategy-backtest';
import { STRATEGY_IDS } from '../lib/strategies';
import { archiveFixture, bar, signalFixture } from '../tests/strategy-fixtures';
const config={...DEFAULT_BACKTEST_CONFIG};
const scenarios = [
  {name:'bpjs_same_day_time_exit',signal:signalFixture('bpjs'),archive:archiveFixture([bar('2026-09-04','09:25','09:30'),bar('2026-09-04','15:30','15:35',{open:104,high:105,low:103,close:104})])},
  {name:'bpjs_ambiguous',signal:signalFixture('bpjs',{snapshotId:'fixture-bpjs-ambiguous'}),archive:archiveFixture([bar('2026-09-04','09:25','09:30',{high:115,low:90})])},
  {name:'bpjs_no_entry',signal:signalFixture('bpjs',{snapshotId:'fixture-bpjs-no-entry'}),archive:archiveFixture([bar('2026-09-04','09:25','09:30',{open:120,high:122,low:119,close:120})])},
  {name:'bsjp_gap_stop_after_synthetic_holiday',signal:signalFixture('bsjp'),archive:archiveFixture([bar('2026-09-04','15:10','15:15'),bar('2026-09-08','09:00','09:05',{open:90,high:94,low:88,close:92})])},
  {name:'ara_touch_after_cutoff',signal:signalFixture('ara'),archive:archiveFixture([bar('2026-09-04','10:00','10:05',{high:125,close:120})])},
  {name:'ara_no_touch_complete_coverage',signal:signalFixture('ara',{snapshotId:'fixture-ara-no-touch'}),archive:archiveFixture([bar('2026-09-04','10:00','10:05')])},
  {name:'ara_already_touched',signal:signalFixture('ara',{snapshotId:'fixture-ara-already',alreadyTouchedAra:true}),archive:archiveFixture([])},
];
const results=scenarios.map(s=>({name:s.name,outcome:evaluateStrategyBacktest(s.signal,s.archive,config)}));
const summary=STRATEGY_IDS.filter(id=>id!=='swing').map(strategyId=>summarizeStrategyBacktest(results.map(r=>r.outcome),{strategyId,origin:'fixture',executionMode:'historical_replay',developmentEnd:'2026-08-31T00:00:00Z',holdoutStart:'2026-09-01T00:00:00Z',periodStart:'2026-09-01T00:00:00Z',periodEnd:'2026-09-09T00:00:00Z',source:'tests/strategy-fixtures.ts (synthetic, not exchange observations)',universe:['TEST'],resolution:'synthetic intraday',coverage:'Explicit synthetic coverage only; holiday date is a fixture, not a claim about the real calendar.'},config));
const swing=evaluateSwingBacktest(Array.from({length:24},(_,i)=>({date:`2026-10-${String(i+1).padStart(2,'0')}`,open:100,high:105,low:98,close:102})),{signalDate:'2026-09-30',entryLow:99,entryHigh:101,stopPrice:95,target1:110,validSessions:5},config);
const report={generatedAt:new Date().toISOString(),evidence:'Deterministic fixtures verify code behavior, never profitability.',marketBacktest:STRATEGY_IDS.map(marketBacktestReadiness),summary,swing,scenarios:results};
writeFileSync('docs/strategy-backtest-fixtures.json',JSON.stringify(report,null,2)+'\n');
process.stdout.write(`Generated docs/strategy-backtest-fixtures.json: ${results.length} intraday scenarios; ${swing.length} SWING horizons. Market backtests: insufficient_data.\n`);
