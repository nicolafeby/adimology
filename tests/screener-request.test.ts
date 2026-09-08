import assert from 'node:assert/strict';
import test from 'node:test';
import { boundedInteger, parseScreenerRequest, screeningIdempotencyKey, validAnalysisDate } from '../lib/screener-request';
import { STRATEGY_IDS } from '../lib/strategies';
import { withProviderRetry, withTimeout } from '../lib/screener-observability';

test('all four strategy requests retain identity and reject malformed and nonfinite limits', () => {
 for (const strategyId of STRATEGY_IDS) assert.equal(parseScreenerRequest({ strategyId }).strategyId, strategyId);
 for (const input of [null, [], '', { strategyId:'SWING' }, { concurrency:0 }, { concurrency:-1 }, { concurrency:'NaN' }, { deepLimit: Infinity }, { aiLimit:21 }, { analysisDate:'2026-02-31' }, { executionMode:'legacy_unverified' }, { informationCutoffAt:'2026-09-07' }]) assert.throws(() => parseScreenerRequest(input));
 assert.equal(validAnalysisDate('2024-02-29'),true); assert.equal(validAnalysisDate('2025-02-29'),false);
 assert.throws(() => boundedInteger('1.1',1,1,100,'page'));
});
test('idempotency is stable for retry and partitions strategy, cutoff, date and configuration inputs', () => {
 const base = { strategyId:'swing' as const, analysisDate:'2026-09-07',cutoff:'2026-09-07T03:00:00Z', executionMode:'live',clientKey:'retry-123' };
 assert.equal(screeningIdempotencyKey(base),screeningIdempotencyKey({...base}));
 assert.equal(new Set(STRATEGY_IDS.map(strategyId=>screeningIdempotencyKey({...base,strategyId}))).size,4);
 assert.notEqual(screeningIdempotencyKey(base),screeningIdempotencyKey({...base,cutoff:'2026-09-07T04:00:00Z'}));
 assert.notEqual(screeningIdempotencyKey(base),screeningIdempotencyKey({...base,deepLimit:20}));
 assert.notEqual(screeningIdempotencyKey(base),screeningIdempotencyKey({...base,analysisDate:'2026-09-08'}));
 assert.equal(screeningIdempotencyKey({...base,clientKey:undefined}),null);
});
test('transient provider failures retry within bounds; expired credentials do not loop', async () => {
 let calls=0;
 assert.equal(await withProviderRetry(async()=>{ if(++calls===1) throw new Error('HTTP 429'); return 'ok'; },{backoffMs:1}), 'ok'); assert.equal(calls,2);
 calls=0; await assert.rejects(withProviderRetry(async()=>{calls++;throw new Error('HTTP 401');},{backoffMs:1}), /401/); assert.equal(calls,1);
 await assert.rejects(withTimeout(()=>new Promise(()=>{}),5),/timeout/);
});
