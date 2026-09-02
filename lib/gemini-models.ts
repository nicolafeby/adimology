const DEFAULT_GEMINI_STORY_MODELS = [
  'gemini-3.5-flash-lite',
  'gemini-3.6-flash',
  'gemini-3-flash-preview',
];

export function getGeminiStoryModels(): string[] {
  const configured = process.env.GEMINI_STORY_MODELS
    ?.split(',')
    .map((model) => model.trim())
    .filter(Boolean);

  return configured?.length ? [...new Set(configured)] : DEFAULT_GEMINI_STORY_MODELS;
}
