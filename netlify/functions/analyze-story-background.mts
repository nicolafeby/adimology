import { generateAiStory } from '../../lib/ai-story-service';
import { appendBackgroundJobLogEntry, createBackgroundJobLog, updateAgentStory, updateBackgroundJobLog } from '../../lib/supabase';

export default async (req: Request) => {
  const startedAt = Date.now();
  const url = new URL(req.url);
  const emiten = url.searchParams.get('emiten')?.toUpperCase();
  const storyId = Number(url.searchParams.get('id'));
  if (!emiten || !storyId) return new Response(JSON.stringify({ error: 'Missing emiten or id' }), { status: 400 });
  let jobId: number | null = null;
  try {
    const log = await createBackgroundJobLog('analyze-story', 1);
    jobId = log.id;
    await appendBackgroundJobLogEntry(log.id, { level: 'info', message: 'AI Story Analysis dimulai', emiten });
    const body = await req.json().catch(() => ({}));
    await updateAgentStory(storyId, { status: 'processing' });
    const payload = await generateAiStory(emiten, body.keyStats);
    await updateAgentStory(storyId, { status: 'completed', ...payload });
    const duration = (Date.now() - startedAt) / 1000;
    await appendBackgroundJobLogEntry(log.id, { level: 'info', message: 'AI Story Analysis selesai', emiten, details: { duration_seconds: duration, sources: payload.sources?.length ?? 0 } });
    await updateBackgroundJobLog(log.id, { status: 'completed', success_count: 1, metadata: { duration_seconds: duration } });
    return new Response(JSON.stringify({ success: true, emiten }), { status: 200, headers: { 'content-type': 'application/json' } });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await updateAgentStory(storyId, { status: 'error', error_message: message }).catch(() => undefined);
    if (jobId) {
      await appendBackgroundJobLogEntry(jobId, { level: 'error', message, emiten }).catch(() => undefined);
      await updateBackgroundJobLog(jobId, { status: 'failed', error_message: message }).catch(() => undefined);
    }
    return new Response(JSON.stringify({ error: message }), { status: 500, headers: { 'content-type': 'application/json' } });
  }
};
