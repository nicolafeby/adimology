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
      return NextResponse.json({ success: true, analysisDate: snapshot.run.analysis_date, runId: snapshot.run.id, ...grouped, data: grouped.results.passed.flatMap((row) => row.ranking ? [row.ranking] : []) });
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
