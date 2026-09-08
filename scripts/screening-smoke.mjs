/** Deterministic browser smoke. Every API request is mocked. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const baseURL = process.env.SCREENING_SMOKE_URL || 'http://localhost:3100';
const cutoff = '2026-09-08T08:45:00.000Z';
const reports = [], browserErrors = [], posts = [];
let failLatest = false, runningPoll = false, pollCount = 0;

const rule = (key, passed, reason) => ({ key, label: key, passed, reason, actual: passed ? 1 : null, expected: '> 0', missing_fields: passed ? [] : ['foreign_net_value'] });
const assessment = (strategy_id, passed, missing = []) => ({
  strategy_id,
  passed,
  is_in_window: strategy_id !== 'BPJS',
  window_label: strategy_id === 'BPJS' ? '09:00–09:15 WIB' : 'Fixture WIB',
  // BPJS deliberately repeats the field key for min/max rules to catch React key regressions.
  rules: strategy_id === 'BPJS'
    ? [rule('change_percent', passed, passed ? 'Rule minimum lolos' : 'Data minimum belum tersedia'), rule('change_percent', passed, passed ? 'Rule maksimum lolos' : 'Data maksimum belum tersedia')]
    : [rule(`${strategy_id}-rule`, passed, passed ? 'Rule fixture lolos' : 'Data fixture belum tersedia')],
  passed_reasons: passed ? ['Rule fixture lolos'] : [],
  failed_reasons: passed ? [] : ['Data fixture belum tersedia'],
  missing_fields: missing,
});
const row = (ticker, matches, options = {}) => ({
  ticker,
  close: options.close ?? 115,
  change_percent: options.change ?? 15,
  matched_strategies: matches,
  strategy_evaluations: {
    BPJS: assessment('BPJS', matches.includes('BPJS'), matches.includes('BPJS') ? [] : ['market_cap']),
    BSJP: assessment('BSJP', matches.includes('BSJP'), matches.includes('BSJP') ? [] : ['foreign_net_value']),
    ARA_HUNTER: assessment('ARA_HUNTER', matches.includes('ARA_HUNTER'), matches.includes('ARA_HUNTER') ? [] : ['orderbook_updated_at']),
    SWING: assessment('SWING', matches.includes('SWING'), matches.includes('SWING') ? [] : ['ema_50']),
  },
  confidence_score: options.score ?? null,
  confidence_level: options.level ?? null,
  action: options.action ?? null,
  score_reasons: options.reasons ?? '',
  score_breakdown: [],
  missing_fields: options.missing ?? [],
  data_quality: options.quality ?? 'COMPLETE',
  evaluated_at: cutoff,
  evaluated_at_wib: '2026-09-08 15:45:00 WIB',
});
const rows = [
  row('TOPP', ['BSJP', 'ARA_HUNTER', 'SWING', 'CLOSING_PRIORITY'], { score: 100, level: 'HIGH', action: 'STRONG BUY / HAKA', reasons: 'Intersection ARA Hunter + BSJP (+50); Locked ARA (+30); Bid tebal (+10); Akumulasi top 3 broker (+20)' }),
  row('SWNG', ['SWING'], { change: 4, quality: 'PARTIAL', missing: ['foreign_net_value', 'market_cap'] }),
  row('NONE', [], { change: -1, close: 90, quality: 'INSUFFICIENT', missing: ['ema_50', 'foreign_net_value', 'market_cap', 'orderbook_updated_at'] }),
];
const windows = [
  { strategy_id: 'BPJS', label: 'BPJS', window_label: '09:00–09:15 WIB', is_in_window: false },
  { strategy_id: 'BSJP', label: 'BSJP', window_label: '15:40–15:50 WIB', is_in_window: true },
  { strategy_id: 'ARA_HUNTER', label: 'ARA Hunter', window_label: 'Intraday / pra-penutupan', is_in_window: true },
  { strategy_id: 'SWING', label: 'Swing Trading', window_label: 'Post-market / after close', is_in_window: false },
  { strategy_id: 'CLOSING_PRIORITY', label: 'Closing Priority', window_label: '15:40–15:50 WIB', is_in_window: true },
];
const response = (status = 'completed') => ({ success: true, pipeline_version: 'idx-unified-screener-v1', timezone: 'Asia/Jakarta', run: { id: '11111111-1111-4111-8111-111111111111', status, analysis_date: '2026-09-08', information_cutoff_at: cutoff, market_session: 'intraday' }, evaluated_at: cutoff, windows, data: status === 'running' ? [] : rows, summary: { universe: 3, evaluated: status === 'running' ? 0 : 3, matched: status === 'running' ? 0 : 2, topPriority: status === 'running' ? 0 : 1, partialData: status === 'running' ? 0 : 2, strategies: { BPJS: 0, BSJP: 1, ARA_HUNTER: 1, SWING: 2 } } });

const browser = await chromium.launch({ headless: true, channel: process.env.SCREENING_BROWSER_CHANNEL || undefined });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
page.on('pageerror', (error) => browserErrors.push(`runtime: ${error.message}`));
page.on('console', (message) => { if (message.type() === 'error') browserErrors.push(`console: ${message.text()}`); });
await context.route('**/api/**', async (route) => {
  const request = route.request();
  const path = new URL(request.url()).pathname;
  const fulfill = (payload, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(payload) });
  if (path === '/api/auth/check-password') return fulfill({ success: true, enabled: false, isAuthenticated: true });
  if (path === '/api/screener/unified') {
    if (request.method() === 'POST') { posts.push(request.postDataJSON()); return fulfill(response()); }
    if (failLatest) { failLatest = false; return fulfill({ success: false, error: 'Fixture provider secret must stay hidden.' }, 500); }
    if (runningPoll) { pollCount++; return fulfill(response(pollCount < 2 ? 'running' : 'completed')); }
    return fulfill(response());
  }
  return fulfill({ success: true, data: [], status: 'idle', isValid: true });
});

async function check(name, fn) {
  const started = Date.now();
  await fn();
  reports.push({ name, status: 'passed', durationMs: Date.now() - started });
  console.log(`PASS ${name}`);
}
const settled = async () => {
  await page.getByTestId('run-screening').waitFor({ state: 'visible' });
  await page.waitForFunction(() => !document.querySelector('[data-testid="run-screening"]')?.hasAttribute('disabled'));
};

try {
  await check('one unified table renders multiple strategy badges and priority order', async () => {
    await page.goto(`${baseURL}/rankings`);
    await settled();
    assert.equal(await page.locator('.unified-table').count(), 1);
    assert.equal(await page.getByTestId('screening-result').count(), 3);
    const first = page.getByTestId('screening-result').first();
    assert.match(await first.innerText(), /TOPP/);
    assert.match(await first.innerText(), /BSJP/);
    assert.match(await first.innerText(), /ARA Hunter/);
    assert.match(await first.innerText(), /TOP PRIORITY/);
    assert.match(await first.innerText(), /100/);
  });

  await check('window status, partial data, missing fields and rule reasons are explicit', async () => {
    assert.equal(await page.locator('.unified-window-grid .window-active').count(), 3);
    assert.match(await page.locator('.unified-partial').innerText(), /tidak diubah menjadi nol/);
    const swing = page.getByTestId('screening-result').filter({ hasText: 'SWNG' });
    assert.match(await swing.innerText(), /foreign_net_value/);
    await swing.locator('details summary').click();
    assert.match(await swing.innerText(), /TIDAK LOLOS/);
    assert.match(await swing.innerText(), /LOLOS/);
  });

  await check('strategy and ticker filters only filter the same table', async () => {
    await page.getByLabel('Filter strategi').selectOption('CLOSING_PRIORITY');
    assert.equal(await page.getByTestId('screening-result').count(), 1);
    await page.getByLabel('Filter strategi').selectOption('SWING');
    assert.equal(await page.getByTestId('screening-result').count(), 2);
    await page.getByLabel('Cari ticker').fill('SWNG');
    assert.equal(await page.getByTestId('screening-result').count(), 1);
    await page.getByLabel('Cari ticker').fill('');
    await page.getByLabel('Filter strategi').selectOption('ALL');
  });

  await check('manual run submits one pipeline request', async () => {
    await page.getByTestId('run-screening').click();
    await settled();
    assert.equal(posts.length, 1);
    assert.equal(posts[0].strategyId, undefined);
    assert.equal(posts[0].aiLimit, 0);
    assert.match(await page.getByRole('status').filter({ hasText: 'Selesai:' }).innerText(), /1 top priority/);
  });

  await check('safe error and retry state recover without exposing raw payload', async () => {
    const browserErrorCount = browserErrors.length;
    failLatest = true;
    await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    const alert = page.getByTestId('screening-page').getByRole('alert');
    await alert.waitFor();
    assert.doesNotMatch(await alert.innerText(), /provider secret/i);
    await alert.getByRole('button', { name: 'Coba lagi' }).click();
    await alert.waitFor({ state: 'hidden' });
    await settled();
    assert.equal(await page.getByTestId('screening-page').getByRole('alert').count(), 0);
    const expectedNetworkErrors = browserErrors.splice(browserErrorCount);
    assert.equal(expectedNetworkErrors.length, 1);
    assert.match(expectedNetworkErrors[0], /Failed to load resource.*500/);
  });

  await check('running snapshot polls until terminal and then stops', async () => {
    runningPoll = true; pollCount = 0;
    await page.getByRole('button', { name: 'Refresh', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.ranking-note')?.textContent?.includes('Run running'), { timeout: 12_000 });
    await page.waitForFunction(() => document.querySelector('.ranking-note')?.textContent?.includes('Run completed'), { timeout: 12_000 });
    const completedCount = pollCount;
    await page.waitForTimeout(3_400);
    assert.equal(pollCount, completedCount);
    runningPoll = false;
  });

  await check('desktop and mobile layouts avoid page-level horizontal overflow', async () => {
    await mkdir('docs/screenshots', { recursive: true });
    await page.screenshot({ path: 'docs/screenshots/screening-desktop.png', fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    await page.screenshot({ path: 'docs/screenshots/screening-mobile.png', fullPage: true });
    assert.deepEqual(browserErrors, []);
  });
} finally {
  await mkdir('docs', { recursive: true });
  await writeFile('docs/screening-ui-smoke.json', JSON.stringify({ generatedAt: new Date().toISOString(), baseURL, mode: 'deterministic_mock_api', providerIntegration: 'not_tested', reports, browserErrors, unifiedRunRequests: posts }, null, 2) + '\n');
  await browser.close();
}
