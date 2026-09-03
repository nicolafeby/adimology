import { NextRequest, NextResponse } from 'next/server';
import { upsertSession } from '@/lib/supabase';
import { secretsEqual } from '@/lib/request-security';

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': 'null',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Token-Sync-Secret',
    },
  });
}

export async function POST(request: NextRequest) {
  try {
    if (!secretsEqual(request.headers.get('x-token-sync-secret'), process.env.TOKEN_SYNC_SECRET)) {
      return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
    }
    const body = await request.json();
    const { token, expires_at } = body;

    if (!token) {
      return NextResponse.json(
        { success: false, error: 'Token is required' },
        { status: 400 }
      );
    }

    let expiresAtDate: Date | undefined;
    if (expires_at) {
      if (typeof expires_at === 'number') {
        expiresAtDate = new Date(expires_at * 1000);
      } else {
        expiresAtDate = new Date(expires_at);
      }
    }

    await upsertSession('stockbit_token', token, expiresAtDate);

    return NextResponse.json({
      success: true,
      message: 'Token updated successfully',
      expires_at: expiresAtDate,
    });
  } catch (error: unknown) {
    console.error('Update Token Error:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to update token' },
      { status: 500 }
    );
  }
}
