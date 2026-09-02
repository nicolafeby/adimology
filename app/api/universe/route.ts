import { NextResponse } from 'next/server';
import { fetchIdxListedCompanies } from '@/lib/idx';
import { getActiveIdxUniverse, saveIdxUniverse } from '@/lib/supabase';

export async function GET() {
  try {
    const rows = await getActiveIdxUniverse(2000);
    return NextResponse.json({ success: true, count: rows.length, data: rows });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : 'Gagal mengambil universe' }, { status: 500 });
  }
}

export async function POST() {
  try {
    const companies = await fetchIdxListedCompanies();
    const saved = await saveIdxUniverse(companies);
    return NextResponse.json({ success: true, source: 'IDX', count: saved.length });
  } catch (error) {
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : 'Gagal sinkronisasi IDX' }, { status: 500 });
  }
}
