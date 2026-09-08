import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyNews, safeNewsUrl, unverifiedStoryNewsEnrichment, type NewsInput } from '../lib/news';

const context = { symbol: 'BBCA', strategyId: 'bsjp' as const, informationCutoffAt: '2026-09-07T08:15:00Z', horizonEndAt: '2026-09-08T02:30:00Z' };
const fixture = (overrides: Partial<NewsInput> = {}): NewsInput => ({ news_id: 'n-1', symbol: 'BBCA', title: 'Pengumuman jadwal perusahaan', publisher: 'Emiten', url: 'https://issuer.example/announcement', source_type: 'issuer', published_at: '2026-09-04T01:00:00Z', first_seen_at: '2026-09-04T01:01:00Z', fetched_at: '2026-09-04T01:02:00Z', available_at: '2026-09-04T01:02:00Z', ...overrides });

test('news supports independent confirmation, old age, event risk and impact dimensions', () => {
  const item = classifyNews([fixture({ event_at: '2026-09-08T01:00:00Z', impact_direction: 'mixed', primary_confirmation: { event_confirmed: true, url: 'https://issuer.example/announcement', available_at: '2026-09-04T01:02:00Z', source_type: 'issuer' }, event_risk: { category: 'earnings', severity: 'high', reason: 'Laporan selama posisi menginap.', source_url: 'https://issuer.example/announcement' } })], context).items[0];
  assert.deepEqual(item.labels, ['verified_catalyst', 'old_news', 'event_risk']);
  assert.equal(item.impact_direction, 'mixed'); assert.equal(item.decision_eligible, true);
});
test('duplicate republication preserves original age without importing future knowledge', () => {
  const rows = [fixture({ duplicate_group: 'event-1' }), fixture({ news_id: 'n-2', duplicate_group: 'event-1', published_at: '2026-09-07T08:00:00Z' }), fixture({ news_id: 'future', duplicate_group: 'event-1', published_at: '2026-09-01T01:00:00Z', fetched_at: '2026-09-08T08:00:00Z', available_at: '2026-09-08T08:00:00Z' })];
  const result = classifyNews(rows, context);
  assert.equal(result.items[1].effective_published_at, '2026-09-04T01:00:00.000Z');
  assert.ok(result.items[1].labels.includes('old_news')); assert.equal(result.monitoring_updates.length, 1);
});
test('media coverage is not automatically rumor; explicit unconfirmed claim is rumor', () => {
  const coverage = fixture({ source_type: 'media' });
  assert.equal(classifyNews([coverage], context).items[0].labels.includes('rumor'), false);
  assert.equal(classifyNews([{ ...coverage, unconfirmed_claim: true }], context).items[0].labels.includes('rumor'), true);
});
test('primary hostname or AI citation alone cannot confirm a catalyst or publication timestamp', () => {
  const result = unverifiedStoryNewsEnrichment({ status: 'completed', created_at: '2026-09-07T07:00:00Z', sources: [{ title: 'IDX official page', uri: 'https://idx.co.id/announcement' }] }, context);
  assert.equal(result.status, 'timestamp_unverified'); assert.equal(result.items[0].published_at, null); assert.equal(result.items[0].fetched_at, null);
  assert.equal(result.items[0].verification_status, 'unverified'); assert.equal(result.items[0].decision_eligible, false);
  assert.equal(classifyNews([fixture()], context).items[0].labels.includes('verified_catalyst'), false);
});
test('post-cutoff news and confirmation do not enter the decision snapshot', () => {
  const later = fixture({ published_at: '2026-09-07T08:16:00Z' });
  const result = classifyNews([later], context);
  assert.equal(result.items.length, 0); assert.equal(result.monitoring_updates[0].decision_eligible, false);
  const confirmation = fixture({ primary_confirmation: { event_confirmed: true, url: 'https://issuer.example/report', source_type: 'issuer', available_at: '2026-09-07T08:16:00Z' } });
  assert.equal(classifyNews([confirmation], context).items[0].verification_status, 'unverified');
});
test('missing times, unavailable source, failed retrieval and no relevant news are distinct', () => {
  assert.equal(classifyNews([], context).status, 'no_relevant_news');
  assert.equal(classifyNews([], { ...context, sourceStatus: 'unavailable' }).status, 'source_unavailable');
  assert.equal(classifyNews([], { ...context, sourceStatus: 'failed' }).status, 'failed');
  assert.equal(classifyNews([fixture({ published_at: null })], context).status, 'timestamp_unverified');
  assert.equal(classifyNews([fixture({ available_at: '2026-09-07' })], context).items[0].decision_eligible, false);
});
test('freshness follows selected preset and future event remains relevant in old news', () => {
  assert.equal(classifyNews([fixture()], context).items[0].freshness, 'old');
  assert.equal(classifyNews([fixture()], { ...context, strategyId: 'swing' }).items[0].freshness, 'fresh');
  const uma = fixture({ event_at: '2026-09-08T01:00:00Z', event_risk: { category: 'UMA', severity: 'medium', reason: 'Pantau pengumuman.', source_url: 'https://idx.co.id/uma' } });
  assert.match(classifyNews([uma], context).items[0].classification_reasons.event_risk!, /tidak otomatis.*pelanggaran.*suspensi/);
  assert.equal(classifyNews([uma], { ...context, horizonEndAt: context.informationCutoffAt }).items[0].labels.includes('event_risk'), false);
});
test('unsafe links are removed and classifier does not mutate source records', () => {
  for (const url of ['javascript:alert(1)', 'data:text/html,evil', 'file:///etc/passwd', 'https://token:secret@example.com/']) assert.equal(safeNewsUrl(url), null);
  const record = fixture({ url: 'javascript:alert(1)' }), before = JSON.stringify(record);
  assert.equal(classifyNews([record], context).items[0].url, null); assert.equal(JSON.stringify(record), before);
});
test('malformed provider news and citation arrays return a safe enrichment status', () => {
  assert.equal(classifyNews([null] as unknown as NewsInput[], context).status, 'failed');
  assert.equal(unverifiedStoryNewsEnrichment({ sources: [null] } as never, context).status, 'failed');
  assert.equal(unverifiedStoryNewsEnrichment({ sources: 'invalid' } as never, context).status, 'failed');
});
