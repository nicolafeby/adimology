import { NextRequest, NextResponse } from 'next/server';
import { createAgentStory, getAgentStoriesByEmiten, updateAgentStory } from '@/lib/supabase';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const emiten = searchParams.get('emiten')?.toUpperCase();

  if (!emiten) {
    return NextResponse.json({ error: 'Missing emiten parameter' }, { status: 400 });
  }

  try {
    const stories = await getAgentStoriesByEmiten(emiten);
    
    if (!stories || stories.length === 0) {
      return NextResponse.json({ 
        success: true, 
        data: null,
        message: 'No analysis found'
      }, { headers: { 'Cache-Control': 'no-store, max-age=0' } });
    }

    return NextResponse.json({ 
      success: true, 
      data: stories 
    }, { headers: { 'Cache-Control': 'no-store, max-age=0' } });
  } catch (error) {
    console.error('Error fetching agent story:', error);
    return NextResponse.json({ 
      success: false, 
      error: 'Failed to fetch analysis' 
    }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const emiten = body.emiten?.toUpperCase();
    const keyStats = body.keyStats;

    if (!emiten) {
      return NextResponse.json({ error: 'Missing emiten parameter' }, { status: 400 });
    }

    // Create pending record
    const story = await createAgentStory(emiten);

    // Trigger background function
    const configuredFunctionsUrl = process.env.NETLIFY_FUNCTIONS_URL?.trim();
    const baseUrl = configuredFunctionsUrl
      || (process.env.NODE_ENV === 'development'
        ? 'http://localhost:8888'
        : process.env.URL || request.nextUrl.origin);

    const functionUrl = baseUrl.includes('/.netlify/functions') 
      ? baseUrl 
      : `${baseUrl.replace(/\/$/, '')}/.netlify/functions`;


    console.log(`[Agent Story] Triggering background function at: ${functionUrl}/analyze-story-background`);

    try {
      const backgroundResponse = await fetch(`${functionUrl}/analyze-story-background?emiten=${encodeURIComponent(emiten)}&id=${story.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keyStats })
      });
      if (!backgroundResponse.ok) {
        const details = await backgroundResponse.text();
        throw new Error(`Background function returned ${backgroundResponse.status}: ${details.slice(0, 300)}`);
      }
    } catch (triggerError) {
      const message = triggerError instanceof Error ? triggerError.message : 'Failed to trigger background function';
      await updateAgentStory(story.id, { status: 'error', error_message: message }).catch(() => undefined);
      throw triggerError;
    }

    return NextResponse.json({ 
      success: true, 
      data: story,
      message: 'Analysis started'
    });
  } catch (error) {
    console.error('Error starting agent story:', error);
    return NextResponse.json({ 
      success: false, 
      error: 'Failed to start analysis' 
    }, { status: 500 });
  }
}
