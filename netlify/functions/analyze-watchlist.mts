import type { Config } from "@netlify/functions";

export default async (req: Request) => {
  try {
    // Priority: process.env.URL (production) > default localhost:8888 or 9999
    const host = req.headers.get('host') || 'localhost:8888';
    const baseUrl = (process.env.URL && !process.env.URL.includes('localhost'))
      ? process.env.URL
      : `http://${host}`;


    
    console.log(`[Scheduler] Triggering background job at ${baseUrl}/.netlify/functions/analyze-watchlist-background`);

    // Trigger background function - this returns 202 immediately
    const response = await fetch(`${baseUrl}/.netlify/functions/analyze-watchlist-background`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      }
    });

    console.log(`[Scheduler] Background job triggered, status: ${response.status}`);

    return new Response(JSON.stringify({
      success: true,
      message: 'Background job triggered',
      status: response.status
    }), { status: 200 });
  } catch (error) {
    console.error('[Scheduler] Netlify function error:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }), { status: 500 });
  }
};

export const config: Config = {
  schedule: "0 11 * * *"
};
