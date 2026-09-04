import test from 'node:test';
import assert from 'node:assert/strict';
import { completedDailyCandleAvailableAt, createPointInTimeContext, filterCompletedDailyCandles, validatePointInTimeSource, type SourceProvenance } from '../lib/point-in-time';

const context = createPointInTimeContext({ analysisDate: '2026-09-04', screenedAt: '2026-09-04T10:00:00+07:00', informationCutoffAt: '2026-09-04T10:00:00+07:00', executionMode: 'live' });
const source = (overrides: Partial<SourceProvenance> = {}): SourceProvenance => ({ source: 'stockbit', dataType: 'broker_summary', symbol: 'BBCA', observedAt: '2026-09-04T09:30:00+07:00', effectiveAt: '2026-09-04T09:30:00+07:00', publishedAt: null, fetchedAt: '2026-09-04T09:30:03+07:00', availableAt: '2026-09-04T09:30:03+07:00', isHistoricalSnapshot: false, providerReference: null, rawSnapshotId: null, temporalValidity: 'valid', ...overrides });

test('accepts sources available before cutoff', () => assert.equal(validatePointInTimeSource(source(), context).valid, true));
test('rejects fresh future data', () => assert.equal(validatePointInTimeSource(source({ availableAt: '2026-09-04T10:00:01+07:00' }), context).status, 'future_data'));
test('separates staleness from point-in-time validity', () => { const value = validatePointInTimeSource(source({ availableAt: '2026-08-01T10:00:00+07:00' }), context, 86400000); assert.equal(value.valid, true); assert.equal(value.status, 'stale'); });
test('historical replay rejects live orderbook', () => { const replay = createPointInTimeContext({ analysisDate: '2026-08-01', screenedAt: '2026-09-04T10:00:00+07:00', informationCutoffAt: '2026-08-01T16:30:00+07:00', executionMode: 'historical_replay' }); assert.equal(validatePointInTimeSource(source({ dataType: 'orderbook' }), replay).status, 'historical_snapshot_missing'); });
test('fundamental availability uses publication time', () => assert.equal(validatePointInTimeSource(source({ dataType: 'fundamental', effectiveAt: '2025-12-31T00:00:00+07:00', publishedAt: null }), context).status, 'publication_time_unverified'));
test('unfinished same-session daily candle is excluded', () => { assert.equal(completedDailyCandleAvailableAt('2026-09-04'), '2026-09-04T16:15:00+07:00'); assert.deepEqual(filterCompletedDailyCandles([{ date: '2026-09-03' }, { date: '2026-09-04' }], context), [{ date: '2026-09-03' }]); });
test('Jakarta timestamps do not shift IDX session date', () => assert.equal(createPointInTimeContext({ screenedAt: '2026-09-04T00:30:00+07:00' }).analysisDate, '2026-09-04'));
