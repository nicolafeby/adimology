import { NextRequest, NextResponse } from 'next/server';
import type { BrokerFlowResponse } from '@/lib/types';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const emiten = searchParams.get('emiten');
  const lookbackDays = searchParams.get('lookback_days') || '7';
  const brokerStatus = searchParams.get('broker_status') || 'Bandar,Whale,Retail,Mix';

  if (!emiten) {
    return NextResponse.json(
      { success: false, error: 'Missing emiten parameter' },
      { status: 400 }
    );
  }

  try {
    // Transform brokerStatus for the upstream API: 'Mix' -> 'Retail / Bandar'
    const upstreamBrokerStatus = brokerStatus
      .split(',')
      .map(s => s.trim() === 'Mix' ? 'Retail / Bandar' : s.trim())
      .join(',');

    const url = new URL('https://api.tradersaham.com/api/market-insight/broker-intelligence');
    url.searchParams.set('limit', '100');
    url.searchParams.set('page', '1');
    url.searchParams.set('sort_by', 'consistency');
    url.searchParams.set('mode', 'accum');
    url.searchParams.set('lookback_days', lookbackDays);
    url.searchParams.set('broker_status', upstreamBrokerStatus);
    url.searchParams.set('search', emiten.toLowerCase());

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
      },
      cache: 'no-store',
    });

    if (!response.ok) {
      throw new Error(`Tradersaham API returned ${response.status}`);
    }

    const rawData = await response.json();
    
    // Map 'Retail / Bandar' back to 'Mix' in the response activities
    if (rawData && rawData.activities) {
      rawData.activities = rawData.activities.map((activity: any) => ({
        ...activity,
        broker_status: activity.broker_status === 'Retail / Bandar' ? 'Mix' : activity.broker_status
      }));
    }

    return NextResponse.json({
      success: true,
      data: rawData,
    });
  } catch (error) {
    const cause = error instanceof Error ? error.cause : undefined;
    const causeCode = cause && typeof cause === 'object' && 'code' in cause
      ? String(cause.code)
      : undefined;

    if (causeCode === 'CERT_HAS_EXPIRED') {
      console.warn('Broker Flow unavailable: api.tradersaham.com certificate has expired');
      return NextResponse.json(
        {
          success: false,
          error: 'Layanan Broker Flow sedang tidak tersedia karena sertifikat API Tradersaham kedaluwarsa.',
        },
        { status: 503 }
      );
    }

    console.error('Broker Flow API error:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Failed to fetch broker flow data' },
      { status: 500 }
    );
  }
}
