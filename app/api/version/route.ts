import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json(
    {
      sha: process.env.DEPLOY_SHA ?? 'unknown',
      deployedAt: process.env.DEPLOYED_AT ?? 'unknown',
    },
    {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate',
      },
    },
  );
}
