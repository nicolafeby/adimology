import { NextRequest, NextResponse } from 'next/server';
import { formatMarketDate } from '@/lib/date';
import { getLatestScreeningRun, getStockRankings } from '@/lib/supabase';
import { groupScreeningResults } from '@/lib/screening';

export async function GET(request: NextRequest) {
  try {
    const date = request.nextUrl.searchParams.get('date') || undefined;
    const limit = Math.min(100, Math.max(1, Number(request.nextUrl.searchParams.get('limit') || 10)));
    const snapshot = await getLatestScreeningRun(date);
    if (snapshot) {
      const grouped = groupScreeningResults(snapshot.results, Number(snapshot.run.universe_count));
      const data = grouped.results.passed.flatMap((row) => row.ranking ? [{ ...row.ranking, analysis_score: row.analysis_score ?? row.ranking.score, ranking_score: row.ranking_score ?? row.ranking.ranking_score ?? null, ranking_position: row.ranking_position ?? row.ranking.rank, eligibility_status: row.eligibility_status ?? 'eligible', eligibility_rules: row.eligibility_rules ?? [], ranking_factors: row.ranking_factors ?? [], eligibility_config_version: row.eligibility_config_version, ranking_model_version: row.ranking_model_version, ai_status: row.ai_status ?? 'not_requested', ai_enrichment: row.ai_enrichment ?? null, ai_source: row.ai_source ?? null, ai_error: row.ai_error ?? null }] : []).sort((a, b) => (a.ranking_position ?? Number.MAX_SAFE_INTEGER) - (b.ranking_position ?? Number.MAX_SAFE_INTEGER)).slice(0, limit);
      return NextResponse.json({ success: true, analysisDate: snapshot.run.analysis_date, runId: snapshot.run.id, quantitativeStatus: snapshot.run.quantitative_status ?? 'completed', enrichmentStatus: snapshot.run.enrichment_status ?? 'not_started', ...grouped, data });
    }
    const rankings = await getStockRankings(date, limit);
    const analysisDate = rankings[0]?.analysis_date ?? date ?? formatMarketDate();
    const legacy = rankings.map((ranking) => ({ symbol: ranking.symbol, analysis_date: analysisDate, screening_status: 'passed' as const, passed_rules: [], failed_rules: [], selection_stage: 'final_selection' as const, data_quality: { completeness: ranking.data_completeness ?? null, confidence: ranking.confidence ?? null, valid: true }, evaluated_at: ranking.created_at ?? `${analysisDate}T00:00:00Z`, run_id: `legacy-${analysisDate}`, ranking }));
    const grouped = groupScreeningResults(legacy, legacy.length);
    return NextResponse.json({ success: true, analysisDate, runId: `legacy-${analysisDate}`, ...grouped, data: rankings, deprecated: { data: 'Gunakan results.passed; data hanya memuat kandidat passed.' } });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : 'Gagal mengambil ranking' }, { status: 500 });
  }
}
