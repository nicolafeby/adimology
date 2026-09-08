import { NextRequest, NextResponse } from 'next/server';
import { getScreeningRun, getScreeningSymbolJourney, updateScreeningAiEnrichment, appendScreeningRunEvents } from '@/lib/supabase';
import { generateAiStory } from '@/lib/ai-story-service';
import { guardScreenerRequest, screeningApiError } from '@/lib/screener-api';
import { validRunId } from '@/lib/screener-request';
import { parseStrategyId } from '@/lib/strategies';
import { withTimeout, safeProcessingError } from '@/lib/screener-observability';
import { unverifiedStoryNewsEnrichment, unavailableNewsEnrichment } from '@/lib/news';
export const maxDuration = 60;
export async function POST(request: NextRequest, { params }: { params: Promise<{ runId: string }> }) {
 const denied = await guardScreenerRequest(request, true); if (denied) return denied;
 try {
  const { runId } = await params;
  const body = await request.json().catch(() => null);
  if (!validRunId(runId) || !body || typeof body !== 'object' || Array.isArray(body) || typeof body.symbol !== 'string' || !/^[A-Z0-9]{4,12}$/i.test(body.symbol)) throw new RangeError('Parameter pengayaan tidak valid.');
  const strategyId = parseStrategyId(body.strategyId), symbol = body.symbol.toUpperCase();
  const run = await getScreeningRun(runId, strategyId);
  if (!run) return NextResponse.json({ success: false, error: 'Run tidak ditemukan untuk preset ini.' }, { status: 404 });
  if (run.execution_mode !== 'live') return NextResponse.json({ success: false, code: 'insufficient_data', error: 'Replay/legacy memerlukan arsip pengayaan point-in-time; sumber live tidak digunakan.' }, { status: 422 });
  const journey = await getScreeningSymbolJourney(runId, symbol);
  if (!journey) return NextResponse.json({ success: false, error: 'Simbol tidak ditemukan pada run ini.' }, { status: 404 });
  if (journey.item.ai_status === 'processing' && Date.now() - Date.parse(journey.item.ai_requested_at ?? '') < 60_000) return NextResponse.json({ success: true, status: 'processing' }, { status: 202 });
  const cutoff = journey.item.feature_cutoff_at ?? run.information_cutoff_at;
  await updateScreeningAiEnrichment(runId, symbol, { ai_status: 'processing', ai_requested_at: new Date().toISOString(), ai_error: null });
  try {
   const payload = await withTimeout(() => generateAiStory(symbol), 35_000);
   const news = unverifiedStoryNewsEnrichment(payload, { symbol, strategyId, informationCutoffAt: cutoff });
   await updateScreeningAiEnrichment(runId, symbol, { ai_status: 'completed', ai_enrichment: payload, ai_source: 'generated', ai_completed_at: new Date().toISOString(), ai_error: null, news_enrichment: news });
   await appendScreeningRunEvents([{ run_id: runId, symbol, stage: 'ai_enrichment', event_type: 'enrichment_retried', status: 'completed', metadata: { monitoring_only: true }, idempotency_key: `enrichment:${crypto.randomUUID()}`, occurred_at: new Date().toISOString() }]);
   return NextResponse.json({ success: true, status: 'completed', news_enrichment: news });
  } catch (error) {
   const safe = safeProcessingError(error, 'AI_PROVIDER_FAILED', 'ai_enrichment');
   await updateScreeningAiEnrichment(runId, symbol, { ai_status: 'failed', ai_error: safe.safe_message, news_enrichment: unavailableNewsEnrichment(cutoff, 'failed') });
   return NextResponse.json({ success: false, error: safe.safe_message, code: safe.code }, { status: 502 });
  }
 } catch (error) { return screeningApiError(error, 'Pengayaan tidak dapat diproses.'); }
}
