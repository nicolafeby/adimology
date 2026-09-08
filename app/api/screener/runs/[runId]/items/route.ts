import { NextRequest, NextResponse } from 'next/server';
import { getScreeningRun, getScreeningRunItems } from '@/lib/supabase';
import { guardScreenerRequest, screeningQuery, screeningApiError } from '@/lib/screener-api';
import { boundedInteger, validRunId } from '@/lib/screener-request';
function enumFilter(value: string | null, allowed: string[]) { if (value && !allowed.includes(value)) throw new RangeError('Filter tidak valid.'); return value || undefined; }
function bool(value: string | null) { if (value !== null && !['true','false'].includes(value)) throw new RangeError('Filter boolean tidak valid.'); return value === null ? undefined : value === 'true'; }
export async function GET(request: NextRequest, { params }: { params: Promise<{ runId: string }> }) {
 const denied = await guardScreenerRequest(request); if (denied) return denied;
 try {
  const { runId } = await params, { strategyId } = screeningQuery(request), q = request.nextUrl.searchParams;
  if (!validRunId(runId)) throw new RangeError('Run ID tidak valid.');
  const page = boundedInteger(q.get('page'), 1, 1, 10000, 'page'), pageSize = boundedInteger(q.get('pageSize'), 50, 1, 100, 'pageSize');
  const filters = { page, pageSize, status: enumFilter(q.get('status'), ['completed','filtered_out','processing_error','skipped','pending']), stage: enumFilter(q.get('stage'), ['universe','data_acquisition','pre_screen','quantitative_selection','quantitative_analysis','eligibility','ranking','persisted','ai_enrichment','completed']), preScreenPassed: bool(q.get('preScreenPassed')), selectedForQuantitative: bool(q.get('selectedForQuantitative')), screeningStatus: enumFilter(q.get('screeningStatus'), ['passed','watch','rejected','processing_error']), aiStatus: enumFilter(q.get('aiStatus'), ['not_requested','pending','processing','completed','failed','stale']), newsLabel: enumFilter(q.get('newsLabel'), ['verified_catalyst','rumor','old_news','event_risk']) };
  if (!await getScreeningRun(runId, strategyId)) return NextResponse.json({ success: false, error: 'Run tidak ditemukan untuk preset ini.' }, { status: 404 });
  return NextResponse.json({ success: true, ...await getScreeningRunItems(runId, filters) });
 } catch (error) { return screeningApiError(error, 'Item screening tidak dapat dimuat.'); }
}
