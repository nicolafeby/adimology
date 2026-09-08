import { NextRequest, NextResponse } from 'next/server';
import { getLatestScreeningRun } from '@/lib/supabase';
import { groupScreeningResults } from '@/lib/screening';
import { strategyIdentity, providerStrategySupport } from '@/lib/strategies';
import { guardScreenerRequest, screeningQuery, screeningApiError } from '@/lib/screener-api';
import { boundedInteger } from '@/lib/screener-request';
export async function GET(request: NextRequest) {
  const denied = await guardScreenerRequest(request); if (denied) return denied;
  try {
    const { date, strategyId, runId } = screeningQuery(request);
    const limit = boundedInteger(request.nextUrl.searchParams.get('limit'), 100, 1, 100, 'limit');
    const snapshot = await getLatestScreeningRun(date, strategyId, { runId, includeRunning: true });
    if (!snapshot) return NextResponse.json({ success: true, ...strategyIdentity(strategyId), strategyId, strategySupport: providerStrategySupport(strategyId), run: null, runId: null, results: { passed: [], watch: [], rejected: [], processingError: [] }, summary: {}, data: [] });
    const grouped = groupScreeningResults(snapshot.results, Number(snapshot.run.universe_count));
    const data = grouped.results.passed.flatMap(row => row.ranking ? [{ ...row.ranking, strategy_id: strategyId, strategy_version: snapshot.run.strategy_version, run_id: snapshot.run.id, eligibility_rules: row.eligibility_rules ?? [], ai_status: row.ai_status ?? 'not_requested', ai_enrichment: row.ai_enrichment ?? null, ai_error: row.ai_error ?? null, news_enrichment: row.news_enrichment ?? null }] : []).sort((a, b) => (a.ranking_position ?? a.rank) - (b.ranking_position ?? b.rank)).slice(0, limit);
    return NextResponse.json({ success: true, strategyId, strategySupport: snapshot.run.strategy_support, analysisDate: snapshot.run.analysis_date, runId: snapshot.run.id, run: snapshot.run, quantitativeStatus: snapshot.run.quantitative_status, enrichmentStatus: snapshot.run.enrichment_status, ...grouped, summary: { ...snapshot.run.summary, ...grouped.summary }, data });
  } catch (error) { return screeningApiError(error, 'Hasil screening tidak dapat dimuat.'); }
}
