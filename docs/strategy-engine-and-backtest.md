# Strategy registry, execution engine, and backtest evidence

Implementation separates strategy behavior from provider readiness. All market backtests remain `insufficient_data`; the deterministic numbers in `strategy-backtest-fixtures.json` test software behavior and are not evidence of profitability. Real read-only provider/database evidence is recorded separately in `screening-data-audit.json`.

## Audit and corrections

The previous outcome service evaluated every snapshot against daily candles and waited for 20 sessions. It persisted a 20-session trade as `net_return_10d_positive`; it also mixed execution modes in calibration and could use current historical-price endpoints in replay. The service now dispatches on the complete strategy identity, isolates live from replay, evaluates SWING 5/10/20 separately, and uses the 10-session outcome for the 10-session calibration definition. Daily replay requires an explicit historical outcome archive. BPJS, BSJP and ARA never substitute daily data for intraday data.

The daily engine now refuses to shorten a horizon after a late entry, uses the observed open when a stop gaps, marks entry-bar extrema with unknown ordering ambiguous, and omits pre-entry/post-exit extrema from excursions. SWING screening thresholds remain the existing `eligibility-execution-v2`; the execution correction is versioned `idx-backtest-v3` so previous results are not silently reused.

## Central registry

`lib/strategies.ts` contains stable IDs, strategy and configuration versions, requirements, freshness, risk, execution and outcome definitions. Every persisted identity has `strategy_id`, `strategy_version`, `configuration_version`, `execution_model`, and `outcome_definition`. `strategyPartitionKey` additionally includes run and cutoff. Unknown legacy identity is not relabeled.

| Preset | Version / configuration | Screening and entry (WIB) | Exit / event | Execution |
| --- | --- | --- | --- | --- |
| BPJS | bpjs-v1 / bpjs-baseline-v1 | 09:15 <= time < 10:30 | First available bar open in 15:30–15:45, same trading day; earlier stop/target | intraday_next_bar_open_v1 |
| BSJP | bsjp-v1 / bsjp-baseline-v1 | 15:00 <= time < 15:30 | First available bar open in 09:00–09:30 of the next verified session; earlier stop/target | overnight_next_bar_open_v1 |
| SWING | swing-5-20d-v1 / eligibility-execution-v2 | Existing daily baseline; execution requires fresh market data | Independent 5/10/20 sessions | entry_zone_conservative |
| ARA | ara-v1 / ara-baseline-v1 | 09:15 <= time < 15:30 during continuous trading | Did official ARA trade after cutoff through 16:15, including archived closing-auction trades? | ara_event_only_no_assumed_fill_v1 |

New intraday baseline requirements are positive session momentum, price at/above session VWAP, same-clock cumulative relative volume >=1.2 across at least five distinct prior sessions, spread <=1%, and cumulative traded value >=IDR1bn. Candles must have finished and been available by cutoff; freshness is <=300 seconds. Book freshness is <=60 seconds. Baseline risk is 1% capital, <=1% volume participation, a 1.5% stop and 3% target for BPJS/BSJP. These values are initial unvalidated choices, not optimized on the fixture/holdout period. Registry SWING maximum spread remains 3%; its existing ATR-based stop/targets remain in the original baseline.

The implemented heuristic ranks eligible intraday candidates using session momentum, same-clock relative volume, spread and session range position; ARA substitutes distance to its official bound for range position. VWAP uses actual cumulative traded value divided by actual cumulative volume. Opening range is exposed as a metric. Broker persistence and the existing relative strength factors remain SWING inputs. Optional future factors such as changes across multiple orderbooks require an actual time series; one snapshot supplies no directional proof.

Only `passed` receives a final ranking score. Missing required data is `watch` with reason category `insufficient_data`; provider errors are `processing_error`; failed deterministic rules are `rejected`. ARA `already_touched`/`locked` are monitoring and have no final rank. `locked` describes the supplied snapshot, not guaranteed future order behavior. ARA probabilities remain null until a compatible calibrated event pool exists.

## Calendar and provenance

The regular-market clock schedule was checked against the official [IDX trading-hours and mechanism page](https://www.idx.id/en/products-services/trading-hours-and-mechanism/) on 2026-09-07 (rule reference II-A Kep-00196/BEI/12-2024). `lib/market-calendar.ts` separates opening/closing auctions, morning/afternoon continuous sessions, lunch, post-close and closed states. Friday lunch is different. Clock classification alone is explicitly `calendarVerified:false`.

No actual holiday calendar is bundled or inferred. An adapter must provide verified `ExchangeCalendarDay` records with source, availability timestamp, applicable rules version and open/closed status for every intervening date; otherwise BSJP returns no next-session date. Overrides support exceptional continuous windows. Synthetic test holidays are marked as fixtures and make no claims about real holidays.

`OfficialAraLimit` requires symbol/session, official source type and URL, observed/available timestamps, board, reference price, and rules version. The engine does not calculate a bound from unverified rules and does not substitute a high or highest offer. Date and cutoff must match. Production ingestion must verify provider documentation/official field provenance; a numeric field alone is not sufficient.

## Archive and forward-test contract

The screening service can persist immutable input records and decisions. `strategy_outcome_archives` is append-only and keyed to the decision snapshot. Outcome evaluation calls `getStrategyOutcomeArchive`, never an intraday live fallback. To evaluate a forward observation, record:

- An origin (`live_observed` or `historical_archive`), source, archive as-of time, coverage start/complete-through times, and explicit missing intervals.
- Real completed intraday OHLCV bars with start/end/available timestamps, session date, and traded value; daily SWING replay instead uses `dailyCandles`.
- A verified calendar, historical universe and corporate-action coverage, suspensions, and the applicable participation ceiling.
- Official ARA metadata already frozen in the decision for ARA outcomes.

Origin must match the signal; fixture/legacy archives cannot be reused as market outcomes. Recording an empty or malformed archive does not make a strategy ready. Coverage/universe/corporate-action assertions belong to a trusted ingestion adapter and must be backed by source records. There is currently no verified live intraday provider adapter; operator archive ingestion is the integration point.

## Execution and metrics

BPJS/BSJP consider only bar opens strictly after decision cutoff, inside the entry window and in the entry zone. Volume participation and lot constraints apply. Stop/target on the same candle is `ambiguous` with no counted P&L. Gap stops use actual open rather than the requested stop. Time exits cannot migrate to a later day to improve results. Missing exits remain pending/insufficient; insufficient participation is unfilled. Fees, slippage, tick rounding and minimum fees are configurable through `BacktestConfig` and existing `BACKTEST_*` settings.

Actual queue position and volume precisely at a candle open are unknown; OHLCV fills are modeled and explicitly carry fill uncertainty. MAE/MFE use fully observed post-entry bars before the exit bar plus execution endpoints; they are conservative partial excursions, not tick-level extremes. ARA evaluates events separately, includes archived closing-auction trades, and never assumes a fill or computes P&L. Touch time uses the end of the first observed touch candle as an upper bound; missing earlier coverage leaves time-to-touch null. A negative ARA event requires complete remaining-session coverage through16:15.

Reports partition strategy/version/configuration/execution/outcome/origin/mode and require nonoverlapping development/holdout dates. Counts include signals, entries, closed, pending, ambiguous, unfilled, no-entry and exclusions. Trading summaries contain net returns, win rate, expectancy, profit factor, MAE/MFE and costs. Drawdown is explicitly a sequential indexed approximation, not a portfolio simulation; no portfolio capital allocation or overlapping-position performance claim is made. Production observation APIs label undeclared holdout and do not claim strategy validation.

Calibration requires matching strategy/version/configuration/execution mode as well as the existing model/methodology/execution/outcome/selection filters. Invalid provenance, fixture origins, pending/unfilled/ambiguous outcomes and legacy data are excluded. Minimum sample count remains 50 by default; no probability is displayed for an insufficient pool.

## Reproduce verification

```sh
node --import tsx scripts/strategy-backtest-fixtures.ts
node --import tsx --test tests/strategy-engine.test.ts tests/strategy-outcome-api.test.ts tests/backtest.test.ts tests/probability-calibration.test.ts
npm run typecheck
```

The fixture script writes `docs/strategy-backtest-fixtures.json`: seven deterministic intraday/event scenarios plus three SWING horizons. The report records its actual execution timestamp. All market readiness entries are `insufficient_data`. The API tests use mocked repositories and assert that replay causes zero live-history calls; they do not contact a provider or persist fixture outcomes.

After the additive migrations have been applied to an authorized local/test database, the authenticated routes are:

```text
GET  /api/backtest?strategyId=bpjs&executionMode=live
POST /api/backtest/evaluate   {"strategyId":"bpjs"}
```

Both routes preserve session/cron authentication and validate inputs; raw provider failures are not returned. Use `bpjs`, `bsjp`, `swing`, or `ara`. No production deployment/migration is part of this verification.
