import { runMarketScreener } from '../../lib/screener-service';
import { createBackgroundJobLog, updateBackgroundJobLog } from '../../lib/supabase';

export default async () => {
  let jobId: number | null = null;
  try {
    const weekday = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Jakarta', weekday: 'short' }).format(new Date());
    if (weekday === 'Sat' || weekday === 'Sun') {
      return new Response(JSON.stringify({ success: true, skipped: true, message: 'Bursa tutup pada akhir pekan' }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    const universeLimit = Number(process.env.SCREENER_UNIVERSE_LIMIT || 1000);
    const deepLimit = Number(process.env.SCREENER_DEEP_LIMIT || 50);
    const aiLimit = Number(process.env.SCREENER_AI_LIMIT || 10);
    const log = await createBackgroundJobLog('analyze-watchlist', universeLimit);
    jobId = log.id;
    const result = await runMarketScreener({ universeLimit, deepLimit, aiLimit, concurrency: 4, triggerSource: 'scheduled', idempotencyKey: `scheduled:${new Date().toISOString().slice(0, 10)}` });
    await updateBackgroundJobLog(log.id, { status: 'completed', success_count: result.progress.analyzed, error_count: result.progress.errors.length, metadata: { date: result.date, rankings: result.rankings.length, alerts_created: result.alertsCreated, ...result.progress } });
    return new Response(JSON.stringify({ success: true, ...result }), { status: 200, headers: { 'content-type': 'application/json' } });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (jobId) await updateBackgroundJobLog(jobId, { status: 'failed', error_message: message }).catch(() => undefined);
    return new Response(JSON.stringify({ success: false, error: message }), { status: 500, headers: { 'content-type': 'application/json' } });
  }
};
