import { after, NextRequest, NextResponse } from 'next/server';
import { createAgentStory } from '@/lib/supabase';
import { runScreenerBackgroundJob, runStoryBackgroundJob } from '@/lib/background-jobs';

export async function POST(request: NextRequest) {
  try {
    const { jobName, emiten: rawEmiten } = await request.json();

    if (!['analyze-watchlist', 'analyze-story'].includes(jobName)) {
      return NextResponse.json({ success: false, error: 'Unsupported job type' }, { status: 400 });
    }

    if (jobName === 'analyze-story') {
      const emiten = String(rawEmiten || '').trim().toUpperCase();
      if (!/^[A-Z0-9]{4,12}$/.test(emiten)) {
        return NextResponse.json({ success: false, error: 'Kode emiten tidak valid' }, { status: 400 });
      }

      const story = await createAgentStory(emiten);
      after(() => runStoryBackgroundJob(story.id, emiten));
      return NextResponse.json({ success: true, data: { storyId: story.id, emiten } });
    }

    after(runScreenerBackgroundJob);
    return NextResponse.json({ success: true, data: { message: 'Screener background job dimulai' } });

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
