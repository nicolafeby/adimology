import assert from 'node:assert/strict';
import test from 'node:test';
import {
  evaluateAraHunterStrategy,
  evaluateBpjsStrategy,
  evaluateBsjpStrategy,
  evaluateSwingStrategy,
  evaluateUnifiedIdxScreener,
  filterByStrategy,
  get_top_priority_candidates,
  passesBpjsFilter,
  passesSwingFilter,
  type IdxScreenerCandidate,
} from '../lib/idx-strategy-filters';

const CUTOFF = '2026-09-08T08:45:00.000Z'; // 15:45 WIB
const candidate = (override: Partial<IdxScreenerCandidate> = {}): IdxScreenerCandidate => ({
  ticker: 'TEST', close: 115, high: 116, open: 110, change_percent: 15,
  volume: 4_000, volume_ma_5: 2_000, volume_ma_20: 1_000,
  market_cap: 1_000_000_000_000, transaction_value: 6_000_000_000,
  stoch_rsi_k: 40, stoch_rsi_d: 35,
  previous_stoch_rsi_k: 30, previous_stoch_rsi_d: 35,
  foreign_net_value: 1, offer_depth_top_price: 0, bid_depth_top_price: 600,
  avg_bid_depth: 100, ema_20: 105, ema_50: 100, macd_line: 2,
  macd_signal: 1, rsi_14: 55, top3_broker_net_buy_value: 300,
  top3_broker_net_sell_value: 100, market_data_updated_at: CUTOFF,
  orderbook_updated_at: CUTOFF, broker_summary_updated_at: CUTOFF,
  ...override,
});

test('BPJS uses strict change, volume, value and market-cap boundaries', () => {
  assert.equal(evaluateBpjsStrategy(candidate({ change_percent: 2 })).passed, false);
  assert.equal(evaluateBpjsStrategy(candidate({ change_percent: 2.01 })).passed, true);
  assert.equal(evaluateBpjsStrategy(candidate({ change_percent: 8 })).passed, false);
  assert.equal(evaluateBpjsStrategy(candidate({ change_percent: 3, volume: 2_000 })).passed, false);
  assert.equal(evaluateBpjsStrategy(candidate({ change_percent: 3, volume: 2_001 })).passed, true);
  assert.equal(evaluateBpjsStrategy(candidate({ change_percent: 3, transaction_value: 4_999_999_999 })).passed, false);
  assert.equal(evaluateBpjsStrategy(candidate({ change_percent: 3, market_cap: 499_999_999_999 })).passed, false);
});

test('BPJS requires a new Stochastic RSI bullish crossover below 50', () => {
  assert.equal(passesBpjsFilter(candidate({ change_percent: 3 })), true);
  assert.equal(evaluateBpjsStrategy(candidate({ change_percent: 3, previous_stoch_rsi_k: 40, previous_stoch_rsi_d: 35 })).passed, false);
  assert.equal(evaluateBpjsStrategy(candidate({ change_percent: 3, stoch_rsi_k: 50 })).passed, false);
  assert.equal(evaluateBpjsStrategy(candidate({ change_percent: 3, stoch_rsi_d: 50, stoch_rsi_k: 51 })).passed, false);
});

test('BSJP accepts inclusive change limits and validates volume, high, foreign flow and zero close', () => {
  assert.equal(evaluateBsjpStrategy(candidate({ change_percent: 3 })).passed, true);
  assert.equal(evaluateBsjpStrategy(candidate({ change_percent: 15 })).passed, true);
  assert.equal(evaluateBsjpStrategy(candidate({ change_percent: 2.99 })).passed, false);
  assert.equal(evaluateBsjpStrategy(candidate({ change_percent: 15.01 })).passed, false);
  assert.equal(evaluateBsjpStrategy(candidate({ volume: 2_000 })).passed, false);
  assert.equal(evaluateBsjpStrategy(candidate({ high: 117 })).passed, false);
  assert.equal(evaluateBsjpStrategy(candidate({ foreign_net_value: 0 })).passed, false);
  assert.equal(evaluateBsjpStrategy(candidate({ close: 0, high: 0 })).passed, false);
});

test('ARA Hunter requires base conditions plus a valid orderbook branch', () => {
  assert.equal(evaluateAraHunterStrategy(candidate()).passed, true);
  assert.equal(evaluateAraHunterStrategy(candidate({ offer_depth_top_price: 10, bid_depth_top_price: 501, avg_bid_depth: 100 })).passed, true);
  assert.equal(evaluateAraHunterStrategy(candidate({ offer_depth_top_price: 10, bid_depth_top_price: 500, avg_bid_depth: 100 })).passed, false);
  assert.equal(evaluateAraHunterStrategy(candidate({ offer_depth_top_price: null, bid_depth_top_price: 100, avg_bid_depth: 100 })).passed, false);
  assert.equal(evaluateAraHunterStrategy(candidate({ change_percent: 14.99 })).passed, false);
  assert.equal(evaluateAraHunterStrategy(candidate({ volume: 3_000 })).passed, false);
});

test('Swing enforces EMA, MACD, inclusive RSI, green candle and strict volume rules', () => {
  assert.equal(passesSwingFilter(candidate()), true);
  assert.equal(evaluateSwingStrategy(candidate({ close: 105 })).passed, false);
  assert.equal(evaluateSwingStrategy(candidate({ ema_50: 115 })).passed, false);
  assert.equal(evaluateSwingStrategy(candidate({ macd_line: 1 })).passed, false);
  assert.equal(evaluateSwingStrategy(candidate({ rsi_14: 45 })).passed, true);
  assert.equal(evaluateSwingStrategy(candidate({ rsi_14: 65 })).passed, true);
  assert.equal(evaluateSwingStrategy(candidate({ close: 109, open: 110 })).passed, false);
  assert.equal(evaluateSwingStrategy(candidate({ volume: 1_000 })).passed, false);
});

test('missing, NaN and stale values never become zero or a false positive', () => {
  const missing = evaluateAraHunterStrategy(candidate({ offer_depth_top_price: null, bid_depth_top_price: null, avg_bid_depth: null }));
  assert.equal(missing.passed, false);
  assert.deepEqual(missing.missing_fields, ['avg_bid_depth', 'bid_depth_top_price', 'offer_depth_top_price']);
  assert.equal(evaluateBsjpStrategy(candidate({ foreign_net_value: Number.NaN })).passed, false);
  const stale = evaluateUnifiedIdxScreener([candidate()], { evaluatedAt: CUTOFF, enforceFreshness: true, orderbookMaxAgeSeconds: 60, marketMaxAgeSeconds: { BSJP: 60, ARA_HUNTER: 60 } });
  assert.equal(stale.results[0].matched_strategies.includes('CLOSING_PRIORITY'), true);
  const staleBook = evaluateUnifiedIdxScreener([candidate({ orderbook_updated_at: '2026-09-08T08:00:00Z' })], { evaluatedAt: CUTOFF, enforceFreshness: true });
  assert.equal(staleBook.results[0].matched_strategies.includes('ARA_HUNTER'), false);
  assert.ok(staleBook.results[0].missing_fields.includes('stale:orderbook_updated_at'));
  const priorSession = evaluateUnifiedIdxScreener([candidate({ market_data_updated_at: '2026-09-07T09:15:00Z' })], { evaluatedAt: '2026-09-08T09:00:00Z', enforceFreshness: true });
  assert.equal(priorSession.results[0].matched_strategies.includes('SWING'), false);
});

test('closing evaluator only includes BSJP and ARA intersection with deterministic reasons', () => {
  const excluded = candidate({ ticker: 'NOPE', foreign_net_value: 0 });
  const [result] = get_top_priority_candidates([excluded, candidate()], { evaluatedAt: CUTOFF });
  assert.equal(result.ticker, 'TEST');
  assert.equal(result.confidence_score, 100);
  assert.equal(result.confidence_level, 'HIGH');
  assert.equal(result.action, 'STRONG BUY / HAKA');
  assert.equal(result.score_reasons, 'Intersection ARA Hunter + BSJP (+50); Locked ARA (+30); Bid tebal (+10); Akumulasi top 3 broker (+20)');
  assert.equal(result.score_breakdown[0].points, 50);
});

test('locked and thin-offer bonuses are mutually exclusive while thick bid stays independent', () => {
  const [locked] = get_top_priority_candidates([candidate({ bid_depth_top_price: 100, avg_bid_depth: 100, top3_broker_net_buy_value: 100, top3_broker_net_sell_value: 100 })]);
  assert.equal(locked.confidence_score, 80);
  assert.match(locked.score_reasons, /Locked ARA/);
  assert.doesNotMatch(locked.score_reasons, /Offer sangat tipis/);

  const [thin] = get_top_priority_candidates([candidate({ offer_depth_top_price: 50, bid_depth_top_price: 600, avg_bid_depth: 100, top3_broker_net_buy_value: 100, top3_broker_net_sell_value: 100 })]);
  assert.equal(thin.confidence_score, 75);
  assert.match(thin.score_reasons, /Offer sangat tipis \(\+15\); Bid tebal \(\+10\)/);
});

test('broker accumulation, distribution, clamping and confidence boundaries are correct', () => {
  const [high] = get_top_priority_candidates([candidate()]);
  assert.equal(high.confidence_score, 100);
  const [mediumBoundary] = get_top_priority_candidates([candidate({ top3_broker_net_buy_value: 50, top3_broker_net_sell_value: 100 })]);
  assert.equal(mediumBoundary.confidence_score, 60);
  assert.equal(mediumBoundary.confidence_level, 'MEDIUM');
  assert.equal(mediumBoundary.action, 'SPECULATIVE BUY');
  assert.match(mediumBoundary.score_reasons, /Indikasi distribusi broker \(-30\)$/);
  const [highBoundary] = get_top_priority_candidates([candidate({ bid_depth_top_price: 100, avg_bid_depth: 100, top3_broker_net_buy_value: 100, top3_broker_net_sell_value: 100 })]);
  assert.equal(highBoundary.confidence_score, 80);
  assert.equal(highBoundary.confidence_level, 'HIGH');
});

test('missing broker data gives no scoring false positive and is reported', () => {
  const [result] = get_top_priority_candidates([candidate({
    offer_depth_top_price: 50,
    bid_depth_top_price: 600,
    top3_broker_net_buy_value: null,
    top3_broker_net_sell_value: null,
  })]);
  assert.equal(result.confidence_score, 75);
  assert.deepEqual(result.missing_fields, ['top3_broker_net_buy_value', 'top3_broker_net_sell_value']);
});

test('closing candidates sort by score then ticker deterministically', () => {
  const results = get_top_priority_candidates([
    candidate({ ticker: 'ZZZZ', top3_broker_net_buy_value: 100, top3_broker_net_sell_value: 100 }),
    candidate({ ticker: 'AAAA', top3_broker_net_buy_value: 100, top3_broker_net_sell_value: 100 }),
    candidate({ ticker: 'HIGH' }),
  ]);
  assert.deepEqual(results.map((row) => row.ticker), ['HIGH', 'AAAA', 'ZZZZ']);
});

test('one pipeline keeps multiple matches and adds CLOSING_PRIORITY in the same row', () => {
  const output = evaluateUnifiedIdxScreener([candidate()], { evaluatedAt: CUTOFF });
  assert.equal(output.results.length, 1);
  assert.deepEqual(output.results[0].matched_strategies, ['BSJP', 'ARA_HUNTER', 'SWING', 'CLOSING_PRIORITY']);
  assert.equal(output.top_priority_candidates.length, 1);
  assert.equal(output.timezone, 'Asia/Jakarta');
});

test('strategy dispatcher remains available without creating separate pipelines', () => {
  assert.deepEqual(filterByStrategy([candidate()], 'ara_hunter').map((row) => row.ticker), ['TEST']);
});

test('explicit UTC timestamp is converted to the same WIB strategy window regardless of server timezone', () => {
  const output = evaluateUnifiedIdxScreener([candidate()], { evaluatedAt: '2026-09-08T08:40:00.000Z' });
  assert.equal(output.windows.find((window) => window.strategy_id === 'BSJP')?.is_in_window, true);
  assert.equal(output.windows.find((window) => window.strategy_id === 'CLOSING_PRIORITY')?.is_in_window, true);
  assert.equal(output.windows.find((window) => window.strategy_id === 'BPJS')?.is_in_window, false);
  assert.equal(output.evaluated_at_wib, '2026-09-08 15:40:00 WIB');
});
