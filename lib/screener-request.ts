import { createHash } from 'node:crypto';
import { parseStrategyId, strategyIdentity, type StrategyId } from './strategies';
import type { ScreeningExecutionMode } from './point-in-time';

export class ScreenerInputError extends RangeError {}
export const validRunId = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
export function validAnalysisDate(value: unknown): value is string { return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value; }
export function boundedInteger(value: unknown, fallback: number, min: number, max: number, name: string): number {
  if (value === undefined || value === null) return fallback;
  if ((typeof value !== 'number' && typeof value !== 'string') || value === '') throw new ScreenerInputError(`${name} harus angka bulat ${min}–${max}.`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) throw new ScreenerInputError(`${name} harus angka bulat ${min}–${max}.`);
  return parsed;
}
export function parseScreenerRequest(input: unknown) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new ScreenerInputError('Body JSON harus berupa object.');
  const body = input as Record<string, unknown>;
  const strategyId = parseStrategyId(body.strategyId);
  if (body.analysisDate !== undefined && !validAnalysisDate(body.analysisDate)) throw new ScreenerInputError('analysisDate harus tanggal YYYY-MM-DD yang valid.');
  if (body.informationCutoffAt !== undefined && (typeof body.informationCutoffAt !== 'string' || !/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(body.informationCutoffAt) || !Number.isFinite(Date.parse(body.informationCutoffAt)) || Date.parse(body.informationCutoffAt) > Date.now())) throw new ScreenerInputError('informationCutoffAt harus timestamp dengan zona waktu dan tidak di masa depan.');
  if (body.executionMode !== undefined && !['live', 'historical_replay'].includes(String(body.executionMode))) throw new ScreenerInputError('executionMode harus live atau historical_replay.');
  if (body.idempotencyKey !== undefined && (typeof body.idempotencyKey !== 'string' || !/^[A-Za-z0-9_.:-]{1,128}$/.test(body.idempotencyKey))) throw new ScreenerInputError('Idempotency key tidak valid.');
  return { strategyId, analysisDate: body.analysisDate as string | undefined, informationCutoffAt: body.informationCutoffAt as string | undefined, executionMode: body.executionMode as ScreeningExecutionMode | undefined, idempotencyKey: body.idempotencyKey as string | undefined, universeLimit: boundedInteger(body.universeLimit, 1000, 1, 1000, 'universeLimit'), deepLimit: boundedInteger(body.deepLimit, 50, 1, 100, 'deepLimit'), aiLimit: boundedInteger(body.aiLimit, 10, 0, 20, 'aiLimit'), concurrency: boundedInteger(body.concurrency, 4, 1, 6, 'concurrency') };
}
/** A retry is stable; strategy/date/cutoff/config changes always get a different key. */
export function screeningIdempotencyKey(input: { strategyId: StrategyId; analysisDate: string; cutoff?: string; executionMode: string; clientKey?: string; universeLimit?: number; deepLimit?: number; aiLimit?: number }) {
  if (!input.clientKey) return null;
  return createHash('sha256').update(JSON.stringify({ ...strategyIdentity(input.strategyId), date: input.analysisDate, cutoff: input.cutoff ?? 'live_acquisition', mode: input.executionMode, clientKey: input.clientKey, universeLimit: input.universeLimit ?? 1000, deepLimit: input.deepLimit ?? 50, aiLimit: input.aiLimit ?? 10 })).digest('hex');
}
