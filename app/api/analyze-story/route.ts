import { after, NextRequest, NextResponse } from 'next/server';
import { createAgentStory, getAgentStoriesByEmiten } from '@/lib/supabase';
import { runStoryBackgroundJob } from '@/lib/background-jobs';

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

    after(() => runStoryBackgroundJob(story.id, emiten, keyStats));

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
