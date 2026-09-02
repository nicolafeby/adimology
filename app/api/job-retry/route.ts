import { NextRequest, NextResponse } from 'next/server';
import { createAgentStory, updateAgentStory } from '@/lib/supabase';

function getFunctionsBaseUrl(request: NextRequest) {
  const configured = process.env.NETLIFY_FUNCTIONS_URL?.trim();
  const baseUrl = configured
    || (process.env.NODE_ENV === 'development' ? 'http://localhost:8888' : process.env.URL || request.nextUrl.origin);
  return baseUrl.includes('/.netlify/functions')
    ? baseUrl.replace(/\/$/, '')
    : `${baseUrl.replace(/\/$/, '')}/.netlify/functions`;
}

export async function POST(request: NextRequest) {
  try {
    const { jobName, emiten: rawEmiten } = await request.json();

    if (!['analyze-watchlist', 'analyze-story'].includes(jobName)) {
      return NextResponse.json({ success: false, error: 'Unsupported job type' }, { status: 400 });
    }

    const functionsUrl = getFunctionsBaseUrl(request);

    if (jobName === 'analyze-story') {
      const emiten = String(rawEmiten || '').trim().toUpperCase();
      if (!/^[A-Z0-9]{4,12}$/.test(emiten)) {
        return NextResponse.json({ success: false, error: 'Kode emiten tidak valid' }, { status: 400 });
      }

      const story = await createAgentStory(emiten);
      try {
        const response = await fetch(`${functionsUrl}/analyze-story-background?emiten=${encodeURIComponent(emiten)}&id=${story.id}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        });
        if (!response.ok) {
          const details = await response.text();
          throw new Error(`Background function returned ${response.status}: ${details.slice(0, 300)}`);
        }
        return NextResponse.json({ success: true, data: { storyId: story.id, emiten } });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to trigger story analysis';
        await updateAgentStory(story.id, { status: 'error', error_message: message }).catch(() => undefined);
        throw error;
      }
    }

    // Trigger manual Netlify function instead of scheduled one
    // Scheduled functions return 500 when called via HTTP
    const functionUrl = `${functionsUrl}/analyze-watchlist-manual`;

    console.log(`[Job Retry] Triggering background job at: ${functionUrl}`);

    const response = await fetch(functionUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      }
    });

    const responseText = await response.text();
    let result;
    try {
      result = JSON.parse(responseText);
    } catch (e) {
      result = { message: responseText };
    }

    if (!response.ok) {
      return NextResponse.json({ success: false, error: result.message || `Background function returned ${response.status}` }, { status: 502 });
    }

    return NextResponse.json({ success: true, data: result });

  } catch (error) {
    console.error('[Job Retry] Error details:', {
      message: error instanceof Error ? error.message : 'Unknown error',
      error
    });
    return NextResponse.json({ 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }, { status: 500 });
  }
}
