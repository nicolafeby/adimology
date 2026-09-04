import { NextRequest, NextResponse } from 'next/server';
import { getScreeningRunItems } from '@/lib/supabase';

const bool = (value: string | null) => value == null ? undefined : value === 'true';
export async function GET(request: NextRequest, { params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params; const q = request.nextUrl.searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(runId)) return NextResponse.json({ success: false, error: 'Run ID tidak valid' }, { status: 400 });
  try {
    const page = Math.max(1, Number(q.get('page') ?? 1)); const pageSize = Math.min(100, Math.max(1, Number(q.get('pageSize') ?? 50)));
    const result = await getScreeningRunItems(runId, { status: q.get('status') ?? undefined, stage: q.get('stage') ?? undefined, preScreenPassed: bool(q.get('preScreenPassed')), selectedForQuantitative: bool(q.get('selectedForQuantitative')), screeningStatus: q.get('screeningStatus') ?? undefined, aiStatus: q.get('aiStatus') ?? undefined, page, pageSize });
    return NextResponse.json({ success: true, ...result });
  } catch { return NextResponse.json({ success: false, error: 'Item funnel tidak dapat dimuat' }, { status: 500 }); }
}
