import { generateAiStory } from './ai-story-service';
import { runMarketScreener } from './screener-service';
import {
  appendBackgroundJobLogEntry,
  createBackgroundJobLog,
  updateAgentStory,
  updateBackgroundJobLog,
} from './supabase';

export async function runStoryBackgroundJob(
  storyId: number,
  emiten: string,
  keyStats?: unknown,
) {
  const startedAt = Date.now();
  let jobId: number | null = null;

  try {
    const log = await createBackgroundJobLog('analyze-story', 1);
    jobId = log.id;
    await appendBackgroundJobLogEntry(log.id, {
      level: 'info',
      message: 'AI Story Analysis dimulai',
      emiten,
    });
    await updateAgentStory(storyId, { status: 'processing' });

    const payload = await generateAiStory(emiten, keyStats);
    await updateAgentStory(storyId, { status: 'completed', ...payload });

    const duration = (Date.now() - startedAt) / 1000;
    await appendBackgroundJobLogEntry(log.id, {
      level: 'info',
      message: 'AI Story Analysis selesai',
      emiten,
      details: { duration_seconds: duration, sources: payload.sources?.length ?? 0 },
    });
    await updateBackgroundJobLog(log.id, {
      status: 'completed',
      success_count: 1,
      metadata: { duration_seconds: duration },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await updateAgentStory(storyId, { status: 'error', error_message: message }).catch(() => undefined);
    if (jobId) {
      await appendBackgroundJobLogEntry(jobId, { level: 'error', message, emiten }).catch(() => undefined);
      await updateBackgroundJobLog(jobId, { status: 'failed', error_message: message }).catch(() => undefined);
    }
    console.error(`[Background Job] AI Story ${emiten} gagal:`, message);
  }
}

export async function runScreenerBackgroundJob() {
  let jobId: number | null = null;

  try {
    const weekday = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Jakarta',
      weekday: 'short',
    }).format(new Date());
    if (weekday === 'Sat' || weekday === 'Sun') return;

    const universeLimit = Number(process.env.SCREENER_UNIVERSE_LIMIT || 1000);
    const deepLimit = Number(process.env.SCREENER_DEEP_LIMIT || 50);
    const aiLimit = Number(process.env.SCREENER_AI_LIMIT || 10);
    const log = await createBackgroundJobLog('analyze-watchlist', universeLimit);
    jobId = log.id;

    const result = await runMarketScreener({ universeLimit, deepLimit, aiLimit, concurrency: 4 });
    await updateBackgroundJobLog(log.id, {
      status: 'completed',
      success_count: result.progress.analyzed,
      error_count: result.progress.errors.length,
      metadata: {
        date: result.date,
        rankings: result.rankings.length,
        alerts_created: result.alertsCreated,
        ...result.progress,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (jobId) {
      await updateBackgroundJobLog(jobId, { status: 'failed', error_message: message }).catch(() => undefined);
    }
    console.error('[Background Job] Screener gagal:', message);
  }
}
