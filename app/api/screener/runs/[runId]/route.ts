import { NextResponse } from 'next/server';
import { getScreeningRun } from '@/lib/supabase';

export async function GET(_: Request, { params }: { params: Promise<{ runId: string }> }) {
  const { runId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(runId)) return NextResponse.json({ success: false, error: 'Run ID tidak valid' }, { status: 400 });
  try { const run = await getScreeningRun(runId); return run ? NextResponse.json({ success: true, run, summary: run.summary ?? {} }) : NextResponse.json({ success: false, error: 'Run tidak ditemukan' }, { status: 404 }); }
  catch { return NextResponse.json({ success: false, error: 'Run tidak dapat dimuat' }, { status: 500 }); }
}
