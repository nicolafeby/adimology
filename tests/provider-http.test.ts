import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchProvider, providerPriceLimit, readHistoryPayload, STOCKBIT_HISTORICAL_PAGE_LIMIT, validateHistoricalSummaryLimit } from '../lib/provider-http';

test('provider GET retries bounded rate limits and temporary failures with backoff', async () => {
  const waits: number[] = []; let requests = 0;
  const response = await fetchProvider('https://provider.invalid', {}, {
    fetch: async () => { requests++; return new Response('{}', { status: requests === 1 ? 429 : requests === 2 ? 503 : 200 }); },
    sleep: async ms => { waits.push(ms); },
  });
  assert.equal(response.status, 200); assert.equal(requests, 3); assert.deepEqual(waits, [250, 500]);
});
test('expired tokens and provider writes are not retried', async () => {
  for (const [method, status] of [['GET', 401], ['DELETE', 503]] as const) {
    let requests = 0;
    await fetchProvider('https://provider.invalid', { method }, { fetch: async () => { requests++; return new Response('', { status }); } });
    assert.equal(requests, 1);
  }
});
test('timeout stops a hung transport after bounded retries', async () => {
  let requests = 0;
  // A timer keeps this fixture alive while AbortSignal.timeout fires (its timer is unrefed).
  const keepAlive = setInterval(() => {}, 1000);
  try {
    await assert.rejects(fetchProvider('https://provider.invalid', {}, {
      timeoutMs: 5, sleep: async () => {},
      fetch: async (_url, init) => { requests++; return new Promise((_, reject) => { init!.signal!.addEventListener('abort', () => reject(new Error('timeout')), { once: true }); }); },
    }), /timeout/);
    assert.equal(requests, 3);
  } finally { clearInterval(keepAlive); }
});
test('malformed history differs from a valid empty series', () => {
  assert.deepEqual(readHistoryPayload({ data: { result: [] } }), []);
  for (const payload of [null, {}, { data: null }, { data: { result: {} } }]) assert.throws(() => readHistoryPayload(payload), /PROVIDER_PAYLOAD_INVALID/);
});
test('historical summary rejects page sizes above the provider maximum before transport', () => {
  assert.equal(STOCKBIT_HISTORICAL_PAGE_LIMIT, 50);
  assert.equal(validateHistoricalSummaryLimit(50), 50);
  for (const invalid of [0, 50.5, 51]) assert.throws(() => validateHistoricalSummaryLimit(invalid), /1–50/);
});
test('missing ARA stays unavailable and touched limits retain the official field value', () => {
  assert.equal(providerPriceLimit({ value: '1200' }), 1200);
  for (const payload of [null, undefined, {}, { high: 1200 }, { offer: [{ price: '1200' }] }, { value: 'NaN' }, 0]) assert.equal(providerPriceLimit(payload), null);
});
