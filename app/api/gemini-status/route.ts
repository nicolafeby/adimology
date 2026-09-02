import { NextResponse } from 'next/server';
import { getGeminiStoryModels } from '@/lib/gemini-models';

export const dynamic = 'force-dynamic';

export async function GET() {
  const apiKey = process.env.GEMINI_API_KEY;
  const models = getGeminiStoryModels();
  const primaryModel = models[0];
  const checkedAt = new Date().toISOString();

  if (!apiKey) {
    return NextResponse.json({
      configured: false,
      connected: false,
      model: primaryModel,
      models,
      checkedAt,
      message: 'GEMINI_API_KEY is not configured.',
    });
  }

  try {
    // Reading model metadata verifies the key without generating content or using tokens.
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${primaryModel}`,
      {
        headers: { 'x-goog-api-key': apiKey },
        cache: 'no-store',
      },
    );

    if (!response.ok) {
      return NextResponse.json({
        configured: true,
        connected: false,
        model: primaryModel,
        models,
        checkedAt,
        message:
          response.status === 401 || response.status === 403
            ? 'API key is invalid or does not have access.'
            : `Gemini API returned status ${response.status}.`,
      });
    }

    return NextResponse.json({
      configured: true,
      connected: true,
      model: primaryModel,
      models,
      checkedAt,
      message: 'Gemini API is ready for analysis.',
    });
  } catch (error) {
    console.error('Error checking Gemini API status:', error);
    return NextResponse.json({
      configured: true,
      connected: false,
      model: primaryModel,
      models,
      checkedAt,
      message: 'Unable to reach the Gemini API.',
    });
  }
}
