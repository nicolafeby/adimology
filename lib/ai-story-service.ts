import { GoogleGenAI, ThinkingLevel } from '@google/genai';
import type { AgentStoryResult, AiStoryScoring, SourceCitation } from './types';
import { getGeminiStoryModels } from './gemini-models';

export type AiStoryPayload = Pick<AgentStoryResult, 'matriks_story' | 'swot_analysis' | 'checklist_katalis' | 'keystat_signal' | 'strategi_trading' | 'kesimpulan' | 'sources'>;

const STORY_RESPONSE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['matriks_story', 'swot_analysis', 'ai_scoring', 'checklist_katalis', 'strategi_trading', 'keystat_signal', 'kesimpulan'],
  properties: {
    matriks_story: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['kategori_story', 'deskripsi_katalis', 'logika_ekonomi_pasar', 'potensi_dampak_harga'], properties: { kategori_story: { type: 'string' }, deskripsi_katalis: { type: 'string' }, logika_ekonomi_pasar: { type: 'string' }, potensi_dampak_harga: { type: 'string' } } } },
    swot_analysis: { type: 'object', additionalProperties: false, required: ['strengths', 'weaknesses', 'opportunities', 'threats'], properties: { strengths: { type: 'array', items: { type: 'string' } }, weaknesses: { type: 'array', items: { type: 'string' } }, opportunities: { type: 'array', items: { type: 'string' } }, threats: { type: 'array', items: { type: 'string' } } } },
    ai_scoring: { type: 'object', additionalProperties: false, required: ['score', 'confidence', 'sentiment', 'rationale', 'positive_catalysts', 'negative_risks'], properties: { score: { type: 'integer', minimum: 0, maximum: 100 }, confidence: { type: 'integer', minimum: 0, maximum: 100 }, sentiment: { type: 'string', enum: ['positive', 'neutral', 'negative'] }, rationale: { type: 'string' }, positive_catalysts: { type: 'array', items: { type: 'string' } }, negative_risks: { type: 'array', items: { type: 'string' } } } },
    checklist_katalis: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['item', 'dampak_instan'], properties: { item: { type: 'string' }, dampak_instan: { type: 'string' } } } },
    strategi_trading: { type: 'object', additionalProperties: false, required: ['tipe_saham', 'target_entry', 'exit_strategy'], properties: { tipe_saham: { type: 'string' }, target_entry: { type: 'string' }, exit_strategy: { type: 'object', additionalProperties: false, required: ['take_profit', 'stop_loss'], properties: { take_profit: { type: 'string' }, stop_loss: { type: 'string' } } } } },
    keystat_signal: { type: 'string' },
    kesimpulan: { type: 'string' },
  },
};

async function requestStory(ai: GoogleGenAI, model: string, prompt: string) {
  const stream = await (ai.models as any).generateContentStream({
    model,
    config: {
      responseMimeType: 'application/json',
      responseJsonSchema: STORY_RESPONSE_SCHEMA,
      temperature: 0.2,
      ...(model.startsWith('gemini-3') ? { thinkingConfig: { thinkingLevel: ThinkingLevel.HIGH } } : {}),
    },
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    tools: [{ googleSearch: {} }],
  });
  let fullText = '';
  const sourceMap = new Map<string, SourceCitation>();
  for await (const chunk of stream) {
    if (chunk.text) fullText += chunk.text;
    const chunks = chunk.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];
    for (const grounding of chunks) {
      const uri = grounding.web?.uri;
      if (uri) sourceMap.set(uri, { uri, title: grounding.web?.title || uri });
    }
  }
  return { fullText, sources: [...sourceMap.values()] };
}

export async function generateAiStory(emiten: string, keyStats?: unknown): Promise<AiStoryPayload> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY belum dikonfigurasi');
  const today = new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Jakarta' });
  const keyStatsContext = keyStats ? `\nDATA KEY STATISTICS:\n${JSON.stringify(keyStats, null, 2)}` : '';
  const prompt = `Kamu adalah analis saham profesional Indonesia. Hari ini ${today}.
Cari dan analisa berita TERBARU bulan/minggu ini tentang emiten IDX ${emiten} menggunakan Google Search.${keyStatsContext}

Fokus pada story bisnis, aksi korporasi, perubahan fundamental, sentimen, dan kondisi makro. Abaikan angka harga dari internet. Cantumkan tanggal berita, jelaskan logika pasar, bedakan dampak positif/netral/negatif, dan jangan mengarang katalis jika sumber tidak memadai.

Kembalikan HANYA JSON valid:
{
  "matriks_story":[{"kategori_story":"...","deskripsi_katalis":"...","logika_ekonomi_pasar":"...","potensi_dampak_harga":"positif/netral/negatif dan alasannya"}],
  "swot_analysis":{"strengths":[],"weaknesses":[],"opportunities":[],"threats":[]},
  "ai_scoring":{"score":0-100,"confidence":0-100,"sentiment":"positive|neutral|negative","rationale":"alasan berbasis berita","positive_catalysts":[],"negative_risks":[]},
  "checklist_katalis":[{"item":"...","dampak_instan":"..."}],
  "strategi_trading":{"tipe_saham":"...","target_entry":"...","exit_strategy":{"take_profit":"...","stop_loss":"..."}},
  "keystat_signal":"...",
  "kesimpulan":"kesimpulan 2-3 kalimat"
}`;
  const ai = new GoogleGenAI({ apiKey });
  const failures: string[] = [];
  for (const model of getGeminiStoryModels()) {
    try {
      const { fullText, sources } = await requestStory(ai, model, prompt);
      const normalizedText = fullText.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
      const jsonMatch = normalizedText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('respons tidak berisi JSON');
      let result: AiStoryPayload;
      try { result = JSON.parse(jsonMatch[0]) as AiStoryPayload; }
      catch { throw new Error('respons tidak dapat diparse'); }
      const rawScoring = (result as AiStoryPayload & { ai_scoring?: Partial<AiStoryScoring> }).ai_scoring;
      const score = Number(rawScoring?.score);
      const confidence = Number(rawScoring?.confidence);
      if (!Number.isFinite(score) || !Number.isFinite(confidence) || !rawScoring?.rationale || !['positive', 'neutral', 'negative'].includes(String(rawScoring.sentiment))) {
        throw new Error('respons tidak memiliki ai_scoring terstruktur yang valid');
      }
      const aiScoring: AiStoryScoring = {
        model,
        score: Math.round(Math.min(100, Math.max(0, score))),
        confidence: Math.round(Math.min(100, Math.max(0, confidence))),
        sentiment: rawScoring.sentiment as AiStoryScoring['sentiment'],
        rationale: String(rawScoring.rationale),
        positive_catalysts: Array.isArray(rawScoring.positive_catalysts) ? rawScoring.positive_catalysts.map(String) : [],
        negative_risks: Array.isArray(rawScoring.negative_risks) ? rawScoring.negative_risks.map(String) : [],
      };
      return {
        matriks_story: Array.isArray(result.matriks_story) ? result.matriks_story : [],
        swot_analysis: { strengths: result.swot_analysis?.strengths ?? [], weaknesses: result.swot_analysis?.weaknesses ?? [], opportunities: result.swot_analysis?.opportunities ?? [], threats: result.swot_analysis?.threats ?? [], ai_scoring: aiScoring },
        checklist_katalis: Array.isArray(result.checklist_katalis) ? result.checklist_katalis : [],
        keystat_signal: result.keystat_signal || '', strategi_trading: result.strategi_trading,
        kesimpulan: result.kesimpulan || '', sources,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push(`${model}: ${message}`);
      console.warn(`AI Story ${emiten} gagal memakai ${model}:`, message);
    }
  }
  throw new Error(`Semua model AI Story gagal. ${failures.join(' | ')}`);
}
