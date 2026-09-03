import { formatMarketDate } from './date';
import { classifyTrend, preScreenHistory, rankingScore } from './ranking';
import { analyzeSymbol } from './stock-analysis-service';
import { fetchHistoricalSummary } from './stockbit';
import { bootstrapIdxUniverseFromCache, createAgentStory, createMatchingAlertEvents, ensureDefaultAlertRule, getActiveIdxUniverse, getAgentStoryByEmiten, getCalibratedProbability, saveIdxUniverse, saveSignalSnapshots, saveStockQueriesForRanking, saveStockRankings, updateAgentStory } from './supabase';
import type { StockRanking } from './types';
import { evaluateMatureSignals } from './outcome-service';
import { fetchIdxListedCompanies } from './idx';
import { generateAiStory } from './ai-story-service';
import { classifyMarketRegime } from './probability-calibration';

const MODEL_VERSION = 'multifactor-ai-v2';

async function mapConcurrent<T, R>(items: T[], concurrency: number, worker: (item: T) => Promise<R>): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(items.length);
  let cursor = 0;
  async function run() {
    while (cursor < items.length) {
      const index = cursor++;
      try { results[index] = { status: 'fulfilled', value: await worker(items[index]) }; }
      catch (reason) { results[index] = { status: 'rejected', reason }; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, run));
  return results;
}

export interface ScreenerProgress {
  universe: number;
  preScreened: number;
  candidates: number;
  analyzed: number;
  aiRequested: number;
  aiCompleted: number;
  aiReused: number;
  errors: Array<{ symbol: string; error: string }>;
}

export async function runMarketScreener(options: { analysisDate?: string; universeLimit?: number; deepLimit?: number; aiLimit?: number; concurrency?: number } = {}) {
  const analysisDate = options.analysisDate ?? formatMarketDate();
  const outcomeEvaluation = await evaluateMatureSignals(100).catch((error) => ({ pending: 0, evaluated: 0, errors: [{ symbol: '*', error: error instanceof Error ? error.message : String(error) }] }));
  let universeSource: 'idx' | 'database' | 'watchlist-cache' = 'database';
  let bootstrapped = 0;
  try {
    bootstrapped = (await saveIdxUniverse(await fetchIdxListedCompanies())).length;
    universeSource = 'idx';
  } catch (error) {
    console.error('IDX universe sync failed; using database cache:', error);
  }
  let universe = await getActiveIdxUniverse(options.universeLimit ?? 1000);
  if (!universe.length) {
    bootstrapped = (await bootstrapIdxUniverseFromCache()).length;
    universeSource = 'watchlist-cache';
    universe = await getActiveIdxUniverse(options.universeLimit ?? 1000);
  }
  if (!universe.length) throw new Error('Universe kosong. Sinkronkan watchlist Stockbit atau isi tabel idx_universe terlebih dahulu.');
  await ensureDefaultAlertRule();
  const start = new Date(`${analysisDate}T00:00:00Z`);
  start.setUTCDate(start.getUTCDate() - 60);
  const historyStart = start.toISOString().slice(0, 10);
  const preResults = await mapConcurrent(universe, options.concurrency ?? 5, async (company) => {
    const history = await fetchHistoricalSummary(company.symbol, historyStart, analysisDate, 45);
    return { company, pre: preScreenHistory(history) };
  });
  const errors: Array<{ symbol: string; error: string }> = [];
  const preScreened = preResults.flatMap((result, index) => {
    if (result.status === 'rejected') {
      errors.push({ symbol: universe[index].symbol, error: result.reason instanceof Error ? result.reason.message : String(result.reason) });
      return [];
    }
    return [result.value];
  }).sort((a, b) => b.pre.score - a.pre.score);
  const passed = preScreened.filter((item) => item.pre.passed);
  const marketRegime = classifyMarketRegime(preScreened.map((item) => item.pre));
  // A small freshly bootstrapped universe may have no strict matches. Analyze its
  // best liquid/momentum rows so the UI can still explain why they are only Watch.
  const candidateLimit = options.deepLimit ?? 50;
  const passedSymbols = new Set(passed.map((item) => item.company.symbol));
  const candidates = [...passed, ...preScreened.filter((item) => !passedSymbols.has(item.company.symbol))].slice(0, candidateLimit);
  const deepResults = await mapConcurrent(candidates, Math.min(options.concurrency ?? 4, 4), async ({ company }) => {
    const result = await analyzeSymbol(company.symbol, analysisDate);
    const calibrated = await getCalibratedProbability(result.analysis.score, MODEL_VERSION, marketRegime);
    const classification = classifyTrend(result.analysis);
    return { result, calibrated, classification };
  });
  const quantitativeCandidates = deepResults.flatMap((item, index) => {
    if (item.status === 'rejected') {
      errors.push({ symbol: candidates[index].company.symbol, error: item.reason instanceof Error ? item.reason.message : String(item.reason) });
      return [];
    }
    const { result, calibrated, classification } = item.value;
    return [{ result, calibrated, classification, sortScore: rankingScore(result.analysis, calibrated?.probability ?? null) }];
  }).sort((a, b) => b.sortScore - a.sortScore);
  const aiCandidates = quantitativeCandidates.slice(0, Math.max(1, options.aiLimit ?? 10));
  let aiReused = 0;
  const aiResults = await mapConcurrent(aiCandidates, 2, async ({ result }) => {
    const latest = await getAgentStoryByEmiten(result.symbol);
    const hasStructuredAiScore = Number.isFinite(Number(latest?.swot_analysis?.ai_scoring?.score))
      && Number.isFinite(Number(latest?.swot_analysis?.ai_scoring?.confidence))
      && Boolean(latest?.swot_analysis?.ai_scoring?.model);
    const isFresh = latest?.status === 'completed' && hasStructuredAiScore && latest.created_at && Date.now() - new Date(latest.created_at).getTime() <= 24 * 60 * 60 * 1000;
    if (isFresh) { aiReused++; return { symbol: result.symbol, reused: true }; }
    if ((latest?.status === 'pending' || latest?.status === 'processing') && latest.created_at && Date.now() - new Date(latest.created_at).getTime() < 30 * 60 * 1000) {
      throw new Error('AI Story masih diproses oleh job sebelumnya');
    }
    const story = await createAgentStory(result.symbol);
    try {
      await updateAgentStory(story.id, { status: 'processing' });
      const payload = await generateAiStory(result.symbol);
      await updateAgentStory(story.id, { status: 'completed', ...payload });
      return { symbol: result.symbol, reused: false };
    } catch (error) {
      await updateAgentStory(story.id, { status: 'error', error_message: error instanceof Error ? error.message : String(error) }).catch(() => undefined);
      throw error;
    }
  });
  const aiValidatedSymbols = new Set(aiResults.flatMap((item, index) => {
    if (item.status === 'rejected') {
      errors.push({ symbol: aiCandidates[index].result.symbol, error: `AI Story: ${item.reason instanceof Error ? item.reason.message : String(item.reason)}` });
      return [];
    }
    return [item.value.symbol];
  }));
  if (!aiValidatedSymbols.size) throw new Error('Tidak ada kandidat yang berhasil divalidasi AI Story; snapshot ranking sebelumnya dipertahankan.');
  // Re-run only AI-validated candidates so the freshly persisted catalyst is
  // included in the comprehensive score and can change the final ordering.
  const rescoredResults = await mapConcurrent(aiCandidates.filter(({ result }) => aiValidatedSymbols.has(result.symbol)), Math.min(options.concurrency ?? 4, 4), async ({ result: previous }) => {
    const result = await analyzeSymbol(previous.symbol, analysisDate);
    const calibrated = await getCalibratedProbability(result.analysis.score, MODEL_VERSION, marketRegime);
    const classification = classifyTrend(result.analysis);
    return { result, calibrated, classification, sortScore: rankingScore(result.analysis, calibrated?.probability ?? null) };
  });
  const eligible = rescoredResults.flatMap((item, index) => {
    if (item.status === 'rejected') {
      errors.push({ symbol: [...aiValidatedSymbols][index] ?? '*', error: `Rescoring: ${item.reason instanceof Error ? item.reason.message : String(item.reason)}` });
      return [];
    }
    return [item.value];
  }).sort((a, b) => b.sortScore - a.sortScore);
  if (!eligible.length) throw new Error('Tidak ada kandidat AI yang berhasil dihitung ulang; snapshot sebelumnya dipertahankan.');
  const rankingRows: StockRanking[] = eligible.map(({ result, calibrated, classification }, index) => ({
    analysis_date: analysisDate,
    symbol: result.symbol,
    rank: index + 1,
    score: result.analysis.score,
    data_completeness: result.analysis.dataCompleteness,
    model_probability: calibrated?.probability ?? null,
    signal: classification.signal,
    last_price: result.lastPrice,
    reasons: [
      { label: 'Scoring Model', value: MODEL_VERSION, positive: true },
      ...(result.catalyst?.swot_analysis?.ai_scoring ? [
        { label: 'AI Story', value: `${result.catalyst.swot_analysis.ai_scoring.score}/100 · ${result.catalyst.swot_analysis.ai_scoring.rationale}`, positive: result.catalyst.swot_analysis.ai_scoring.sentiment === 'positive' },
        ...(result.catalyst.swot_analysis.ai_scoring.model ? [{ label: 'AI Model', value: result.catalyst.swot_analysis.ai_scoring.model, positive: true }] : []),
      ] : []),
      ...classification.reasons,
    ],
    risk_flags: classification.riskFlags,
    components: result.analysis.components,
  }));
  const saved = await saveStockRankings(rankingRows as unknown as Array<Record<string, unknown>>);
  await saveSignalSnapshots(eligible.map(({ result, calibrated, classification }) => ({
    signal_date: analysisDate,
    symbol: result.symbol,
    score: result.analysis.score,
    data_completeness: result.analysis.dataCompleteness,
    signal: classification.signal,
    entry_price: result.lastPrice,
    target_price: result.targets.targetRealistis1,
    stop_price: Math.max(0, result.lastPrice - result.targets.fraksi * 5),
    feature_snapshot: { components: result.analysis.components, market_regime: marketRegime, model_probability: calibrated?.probability ?? null, probability_sample_size: calibrated?.sampleSize ?? 0 },
    model_version: MODEL_VERSION,
  })));
  await saveStockQueriesForRanking(eligible.map(({ result }) => result), analysisDate);
  const alerts = await createMatchingAlertEvents(saved);
  return {
    date: analysisDate,
    rankings: saved,
    alertsCreated: alerts.length,
    bootstrapped,
    universeSource,
    marketRegime,
    outcomeEvaluation,
    progress: { universe: universe.length, preScreened: preResults.filter((row) => row.status === 'fulfilled').length, candidates: candidates.length, analyzed: deepResults.filter((row) => row.status === 'fulfilled').length, aiRequested: aiCandidates.length, aiCompleted: aiValidatedSymbols.size, aiReused, errors } satisfies ScreenerProgress,
  };
}
