import { NextResponse } from 'next/server';
import { getScreeningSymbolJourney } from '@/lib/supabase';

export async function GET(_: Request, { params }: { params: Promise<{ runId: string; symbol: string }> }) {
  const { runId, symbol: raw } = await params; const symbol = raw.toUpperCase();
  if (!/^[0-9a-f-]{36}$/i.test(runId) || !/^[A-Z0-9]{4,12}$/.test(symbol)) return NextResponse.json({ success: false, error: 'Parameter tidak valid' }, { status: 400 });
  try { const data = await getScreeningSymbolJourney(runId, symbol); return data ? NextResponse.json({ success: true, data }) : NextResponse.json({ success: false, error: 'Perjalanan emiten tidak ditemukan' }, { status: 404 }); }
  catch { return NextResponse.json({ success: false, error: 'Perjalanan emiten tidak dapat dimuat' }, { status: 500 }); }
}
