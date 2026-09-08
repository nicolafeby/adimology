/** Bounded transport for read-only provider requests. Writes are never retried. */
export async function fetchProvider(input: string | URL, init: RequestInit = {}, dependencies: {
  fetch?: typeof fetch; sleep?: (ms: number) => Promise<void>; timeoutMs?: number;
} = {}): Promise<Response> {
  const request = dependencies.fetch ?? fetch;
  const sleep = dependencies.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms)));
  const attempts = (init.method ?? 'GET').toUpperCase() === 'GET' ? 3 : 1;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const timeout = AbortSignal.timeout(dependencies.timeoutMs ?? 12_000);
    const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
    try {
      const response = await request(input, { ...init, signal });
      const temporary = response.status === 429 || [502, 503, 504].includes(response.status);
      if (!temporary || attempt === attempts - 1) return response;
      const retryAfter = response.headers.get('retry-after');
      const seconds = retryAfter === null ? NaN : Number(retryAfter);
      const retryMs = Number.isFinite(seconds) ? seconds * 1000 : 250 * 2 ** attempt;
      await response.body?.cancel();
      await sleep(Math.max(0, Math.min(retryMs, 2000)));
    } catch (error) {
      if (init.signal?.aborted || attempt === attempts - 1) throw error;
      await sleep(250 * 2 ** attempt);
    }
  }
  throw new Error('Provider request exhausted');
}

/** Stockbit rejects historical-summary page sizes above 50 with HTTP 400. */
export const STOCKBIT_HISTORICAL_PAGE_LIMIT = 50;

export function validateHistoricalSummaryLimit(limit: number): number {
  if (!Number.isInteger(limit) || limit < 1 || limit > STOCKBIT_HISTORICAL_PAGE_LIMIT) {
    throw new RangeError(`Historical summary limit harus integer 1–${STOCKBIT_HISTORICAL_PAGE_LIMIT}.`);
  }
  return limit;
}

/** Never treat an empty/malformed history response as a successful empty series. */
export function readHistoryPayload(payload: unknown): unknown[] {
  if (!payload || typeof payload !== 'object' || !('data' in payload)) throw new Error('PROVIDER_PAYLOAD_INVALID');
  const data = payload.data;
  if (!data || typeof data !== 'object' || !('result' in data) || !Array.isArray(data.result)) throw new Error('PROVIDER_PAYLOAD_INVALID');
  return data.result;
}

export function providerPriceLimit(raw: unknown): number | null {
  const value = raw && typeof raw === 'object' && 'value' in raw ? raw.value : raw;
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}
