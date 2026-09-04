import { formatMarketDate } from './date';
import { calculateRankingScore, classifyTrendWithMarketGate, diagnosticPriorityScore, preScreenHistory, RANKING_MODEL_CONFIG } from './ranking';
import { analyzeSymbol } from './stock-analysis-service';
import { fetchHistoricalSummary } from './stockbit';
import { bootstrapIdxUniverseFromCache, commitScreeningRun, createAgentStory, createMatchingAlertEvents, ensureDefaultAlertRule, getActiveIdxUniverse, getAgentStoryByEmiten, saveIdxUniverse, saveSignalSnapshots, saveStockQueriesForRanking, saveStockRankings, updateAgentStory, updateScreeningAiEnrichment } from './supabase';
import type { StockRanking } from './types';
import { evaluateMatureSignals } from './outcome-service';
import { fetchIdxListedCompanies } from './idx';
import { generateAiStory } from './ai-story-service';
import { calculateMarketRegime } from './market-regime';
import { calculateTradingDecision } from './decision';
import { getCalibratedProbability } from './calibration-service';
import { ACTIVE_ELIGIBILITY_CONFIG_VERSION, ACTIVE_EXECUTION_MODEL, ACTIVE_MODEL_VERSION, ACTIVE_OUTCOME_DEFINITION, ACTIVE_RANKING_MODEL_VERSION, ACTIVE_REGIME_METHODOLOGY_VERSION, ACTIVE_RELATIVE_STRENGTH_METHODOLOGY_VERSION, ACTIVE_SELECTION_SCOPE, buildCalibrationContext } from './model-versions';
import { evaluateEligibility, groupScreeningResults, SCREENER_ELIGIBILITY_CONFIG, type ScreeningResult, type SelectionStage } from './screening';

const MODEL_VERSION = ACTIVE_MODEL_VERSION;

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object') {
    const value = error as { message?: unknown; details?: unknown; hint?: unknown; code?: unknown };
    const parts = [value.message, value.details, value.hint, value.code && `code=${value.code}`].filter((item): item is string => typeof item === 'string' && item.length > 0);
    if (parts.length) return parts.join(' · ');
    try { return JSON.stringify(error); } catch { return 'Unknown persistence error'; }
  }
  return String(error);
}

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
  quantitativeSnapshots: number;
  aiRequested: number;
  aiCompleted: number;
  aiReused: number;
  errors: Array<{ symbol: string; error: string }>;
}

export async function runMarketScreener(options: { analysisDate?: string; universeLimit?: number; deepLimit?: number; aiLimit?: number; concurrency?: number } = {}) {
  const analysisDate = options.analysisDate ?? formatMarketDate();
  const runId = crypto.randomUUID();
  const startedAt = new Date().toISOString();
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
  const marketHistory = (await fetchHistoricalSummary('COMPOSITE', historyStart, analysisDate, 45).catch(() => [])).filter((row) => row.date <= analysisDate);
  const marketRegime = calculateMarketRegime(marketHistory);
  const preResults = await mapConcurrent(universe, options.concurrency ?? 5, async (company) => {
    const history = await fetchHistoricalSummary(company.symbol, historyStart, analysisDate, 45);
    return { company, pre: preScreenHistory(history), history };
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
  // A small freshly bootstrapped universe may have no strict matches. Analyze its
  // best liquid/momentum rows so the UI can still explain why they are only Watch.
  const candidateLimit = options.deepLimit ?? 50;
  const passedSymbols = new Set(passed.map((item) => item.company.symbol));
  const candidates = [...passed, ...preScreened.filter((item) => !passedSymbols.has(item.company.symbol))].slice(0, candidateLimit);
  const deepResults = await mapConcurrent(candidates, Math.min(options.concurrency ?? 4, 4), async ({ company, history }) => {
    const result = await analyzeSymbol(company.symbol, analysisDate, { stockHistory: history, marketHistory });
    const calibrated = await getCalibratedProbability(buildCalibrationContext({ score: result.analysis.score, marketRegime: marketRegime.label, analysisDate, methodologyVersion: result.analysis.methodologyVersion }));
    const classification = classifyTrendWithMarketGate(result.analysis, result.marketRegime, result.relativeStrength);
    result.analysis.exceptionalStrength = classification.gate.exceptionalStrengthCheck;
    result.analysis.gateResult = classification.gate;
    return { result, calibrated, classification };
  });
  const quantitativeCandidates = deepResults.flatMap((item, index) => {
    if (item.status === 'rejected') {
      errors.push({ symbol: candidates[index].company.symbol, error: item.reason instanceof Error ? item.reason.message : String(item.reason) });
      return [];
    }
    const { result, calibrated, classification } = item.value;
    return [{ result, calibrated, classification, sortScore: diagnosticPriorityScore(result.analysis, calibrated?.probability ?? null) }];
  }).sort((a, b) => b.sortScore - a.sortScore);
  const buildDecision = ({ result, classification }: (typeof quantitativeCandidates)[number]) => {
    const metricNumber = (key: string) => { const value = result.analysis.components.flatMap((component) => component.metrics).find((item) => item.key === key)?.value; return typeof value === 'number' && Number.isFinite(value) ? value : null; };
    const componentScore = (key: string) => result.analysis.components.find((component) => component.key === key)?.score ?? null;
    const bestBid = result.orderbook.bid.reduce<number | null>((best, level) => level.price > 0 && (best === null || level.price > best) ? level.price : best, null);
    const bestOffer = result.orderbook.offer.reduce<number | null>((best, level) => level.price > 0 && (best === null || level.price < best) ? level.price : best, null);
    return calculateTradingDecision({ currentPrice: result.lastPrice, bestBid, bestOffer, targetRealistic: result.targets.targetRealistis1, targetMaximum: result.targets.targetMax, ara: result.ara, atrPercent: metricNumber('atr'), priceVsSma20Percent: metricNumber('sma20'), relativeVolume: metricNumber('volumeRatio'), liquidityScore: componentScore('liquidity'), brokerFlowScore: componentScore('brokerFlow'), signal: classification.signal, marketRegime: result.marketRegime.label, marketGateBlocked: classification.gate.signalBeforeGate !== 'avoid' && classification.gate.signalAfterGate === 'avoid', hardRiskFlags: classification.signal === 'avoid' ? classification.riskFlags : [], confidence: classification.gate.confidenceAfter ?? result.analysis.confidence, dataCompleteness: result.analysis.dataCompleteness, generatedAt: result.analysis.generatedAt, orderbookGeneratedAt: result.analysis.generatedAt, aiStoryGeneratedAt: result.catalyst?.created_at ?? null });
  };
  const preScreenPassedBySymbol = new Map(candidates.map(({ company, pre }) => [company.symbol, pre.passed]));
  const quantitativeSnapshots = await saveSignalSnapshots(quantitativeCandidates.map((candidate) => {
    const { result, calibrated, classification } = candidate;
    const decision = buildDecision(candidate);
    const preScreenPassed = preScreenPassedBySymbol.get(result.symbol) ?? false;
    return { signal_date: analysisDate, symbol: result.symbol, score: result.analysis.score, data_completeness: result.analysis.dataCompleteness, signal: classification.signal, entry_price: decision.entry.reference ?? result.lastPrice, target_price: decision.targets.target1, stop_price: decision.stop.price, signal_agreement: result.analysis.quality?.agreement.score ?? null, confidence: result.analysis.quality?.confidence ?? null, dominant_direction: result.analysis.quality?.dominantDirection ?? null, methodology_version: result.analysis.methodologyVersion, market_regime: marketRegime.label, market_regime_score: marketRegime.score, regime_methodology_version: ACTIVE_REGIME_METHODOLOGY_VERSION, benchmark_observed_at: marketHistory.at(-1)?.date ?? null, execution_model: ACTIVE_EXECUTION_MODEL, outcome_definition: ACTIVE_OUTCOME_DEFINITION, selection_scope: ACTIVE_SELECTION_SCOPE, selection_stage: 'quantitative_evaluated', selection_reason: preScreenPassed ? 'passed_pre_screen' : 'top_quantitative_fallback', pre_screen_passed: preScreenPassed, feature_snapshot: { analysis_quality: result.analysis.quality ?? null, components: result.analysis.components, source_timestamps: result.analysis.quality?.freshness.sources ?? null, sector: result.sector ?? null, market_regime: marketRegime.label, market_regime_score: marketRegime.score, regime_methodology_version: ACTIVE_REGIME_METHODOLOGY_VERSION, benchmark_observed_at: marketHistory.at(-1)?.date ?? null, relative_strength: result.relativeStrength, gate: classification.gate, decision, selection_scope: ACTIVE_SELECTION_SCOPE, selection_stage: 'quantitative_evaluated', selection_reason: preScreenPassed ? 'passed_pre_screen' : 'top_quantitative_fallback', pre_screen_passed: preScreenPassed, execution_spread_percent: (() => { const bid = Math.max(...result.orderbook.bid.map((x) => x.price), 0); const offer = Math.min(...result.orderbook.offer.map((x) => x.price)); const mid = (bid + offer) / 2; return bid > 0 && Number.isFinite(offer) && mid > 0 ? (offer - bid) / mid * 100 : null; })(), raw_features: { stock_history: result.history, market_history: marketHistory }, model_probability: calibrated.probability, probability_calibration: calibrated }, model_version: MODEL_VERSION };
  }));
  // Rankings and screening eligibility are derived once from the quantitative
  // pass. AI enrichment below never re-runs or mutates this baseline.
  const rankingRows: StockRanking[] = quantitativeCandidates.map(({ result, calibrated, classification }) => {
    const marketContext = { regime: result.marketRegime, relativeStrength: result.relativeStrength, gate: classification.gate };
    const decision = buildDecision({ result, calibrated, classification, sortScore: diagnosticPriorityScore(result.analysis, calibrated.probability) });
    const rankingResult = calculateRankingScore({ momentumScore: result.analysis.components.find((c) => c.key === 'technical')?.score ?? null, relativeStrength20d: result.relativeStrength.rs20d, brokerFlowScore: result.analysis.components.find((c) => c.key === 'brokerFlow')?.score ?? null, liquidityScore: result.analysis.components.find((c) => c.key === 'liquidity')?.score ?? null, signalAgreement: result.analysis.quality?.agreement.score ?? null, confidence: result.analysis.quality?.confidence ?? result.analysis.confidence, probability: calibrated });
    return {
    analysis_date: analysisDate,
    symbol: result.symbol,
    rank: 0,
    score: result.analysis.score,
    analysis_score: result.analysis.score,
    ranking_score: rankingResult.score,
    ranking_position: 0,
    ranking_factors: rankingResult.factors,
    eligibility_config_version: ACTIVE_ELIGIBILITY_CONFIG_VERSION,
    ranking_model_version: ACTIVE_RANKING_MODEL_VERSION,
    data_completeness: result.analysis.dataCompleteness,
    signal_agreement: result.analysis.quality?.agreement.score ?? null,
    confidence: result.analysis.quality?.confidence ?? null,
    freshness: result.analysis.quality?.freshness.score ?? null,
    reliability: result.analysis.quality?.reliability.score ?? null,
    dominant_direction: result.analysis.quality?.dominantDirection ?? null,
    conflicts: result.analysis.quality?.conflicts ?? null,
    analysis_quality: result.analysis.quality ?? null,
    methodology_version: result.analysis.methodologyVersion ?? null,
    model_probability: calibrated?.probability ?? null,
    probability_calibration: calibrated,
    signal: classification.signal,
    last_price: result.lastPrice,
    reasons: [
      { label: 'Scoring Model', value: MODEL_VERSION, positive: true },
      ...classification.reasons,
    ],
    risk_flags: classification.riskFlags,
    components: result.analysis.components.map((component) => component.key === 'marketRegime' ? { ...component, marketContext: { ...marketContext, decision } } : component),
    market_context: marketContext,
    decision,
  };
  });
  const preBySymbol = new Map(preScreened.map((item) => [item.company.symbol, item.pre]));
  const deepBySymbol = new Map(quantitativeCandidates.map((item) => [item.result.symbol, item]));
  const finalBySymbol = new Map(rankingRows.map((item) => [item.symbol, item]));
  const preErrors = new Map(errors.map((item) => [item.symbol, item.error]));
  const candidateSymbols = new Set(candidates.map((item) => item.company.symbol));
  const evaluatedAt = new Date().toISOString();
  const screeningResults: ScreeningResult[] = universe.map((company) => {
    const pre = preBySymbol.get(company.symbol);
    const quantitative = deepBySymbol.get(company.symbol);
    const ranking = finalBySymbol.get(company.symbol) ?? null;
    const processError = preErrors.get(company.symbol) ?? null;
    const gate = quantitative?.classification.gate;
    const completeness = quantitative?.result.analysis.dataCompleteness ?? null;
    const confidence = quantitative?.result.analysis.quality?.confidence ?? quantitative?.result.analysis.confidence ?? null;
    const decision = ranking?.decision;
    const freshness = quantitative?.result.analysis.quality?.freshness.sources ?? [];
    const spreadPercent = decision?.inputs.spreadPercent;
    const eligibility = evaluateEligibility({
      processingError: processError,
      preScreenPassed: pre?.passed ?? false,
      completeness,
      confidence,
      criticalDataAvailable: Boolean(quantitative && pre && typeof spreadPercent === 'number'),
      criticalDataStale: freshness.some((item) => ['orderbook', 'marketPrice', 'historicalPrice'].includes(item.source) && item.status === 'stale'),
      averageTradedValue: pre?.averageValue20d ?? null,
      spreadPercent: typeof spreadPercent === 'number' ? spreadPercent : null,
      atrPercent: pre?.atrPercent ?? null,
      dominantDirection: quantitative?.result.analysis.quality?.dominantDirection ?? null,
      hasHighSeverityConflict: quantitative?.result.analysis.quality?.conflicts.some((item) => item.severity === 'high') ?? false,
      signal: quantitative?.classification.signal ?? null,
      analysisValid: Boolean(quantitative),
      marketGateAvoid: gate ? gate.signalBeforeGate !== 'avoid' && gate.signalAfterGate === 'avoid' : false,
      aboveSma20: pre?.aboveSma20 ?? null,
      return5d: pre?.return5d ?? null,
      relativeVolume: pre?.relativeVolume ?? null,
      brokerFlowScore: quantitative?.result.analysis.components.find((item) => item.key === 'brokerFlow')?.score ?? null,
      relativeStrength20d: quantitative?.result.relativeStrength.rs20d ?? null,
      signalAgreement: quantitative?.result.analysis.quality?.agreement.score ?? null,
      riskReward: decision?.riskReward.target1 ?? null,
    });
    const stage: SelectionStage = processError && !pre ? 'universe' : !candidateSymbols.has(company.symbol) || !quantitative ? 'pre_screen' : eligibility.screeningStatus === 'passed' ? 'final_selection' : 'quality_gate';
    return { symbol: company.symbol, analysis_date: analysisDate, screening_status: eligibility.screeningStatus, eligibility_status: eligibility.status, eligibility_rules: eligibility.rules, passed_rules: eligibility.rules.filter((item) => item.passed), failed_rules: eligibility.rules.filter((item) => !item.passed), selection_stage: stage, data_quality: { completeness, confidence, valid: !processError && Boolean(quantitative) }, evaluated_at: evaluatedAt, run_id: runId, analysis_score: ranking?.analysis_score ?? null, ranking_score: null, ranking_position: null, ranking_factors: [], eligibility_config_version: SCREENER_ELIGIBILITY_CONFIG.version, ranking_model_version: RANKING_MODEL_CONFIG.version, ranking: null, ai_status: 'not_requested', ai_enrichment: null, ai_source: null, ai_requested_at: null, ai_completed_at: null, ai_error: null };
  });
  const rankingBySymbol = new Map(rankingRows.map((row) => [row.symbol, row]));
  const passedRows = screeningResults.filter((item) => item.screening_status === 'passed').map((item) => rankingBySymbol.get(item.symbol)!).filter(Boolean).sort((a, b) => (b.ranking_score ?? 0) - (a.ranking_score ?? 0) || (b.confidence ?? 0) - (a.confidence ?? 0) || b.data_completeness - a.data_completeness || (b.components.find((c) => c.key === 'liquidity')?.score ?? 0) - (a.components.find((c) => c.key === 'liquidity')?.score ?? 0) || a.symbol.localeCompare(b.symbol)).map((row, index) => ({ ...row, rank: index + 1, ranking_position: index + 1, eligibility_status: 'eligible' as const }));
  const passedBySymbol = new Map(passedRows.map((row) => [row.symbol, row]));
  for (const row of screeningResults) { const ranked = passedBySymbol.get(row.symbol); if (ranked) { row.ranking = ranked; row.ranking_score = ranked.ranking_score ?? null; row.ranking_position = ranked.ranking_position ?? null; row.ranking_factors = ranked.ranking_factors ?? []; } }
  const aiLimit = Math.max(0, options.aiLimit ?? 10);
  const aiCandidates = screeningResults
    .filter((row) => row.ranking && (row.screening_status === 'passed' || row.screening_status === 'watch'))
    .sort((a, b) => (a.screening_status === b.screening_status ? (b.ranking?.score ?? 0) - (a.ranking?.score ?? 0) : a.screening_status === 'passed' ? -1 : 1))
    .slice(0, aiLimit);
  const requestedAt = new Date().toISOString();
  for (const row of aiCandidates) { row.ai_status = 'pending'; row.ai_requested_at = requestedAt; }
  // This commit is intentionally before the first AI request: a complete,
  // queryable quantitative snapshot exists even if every provider call fails.
  await commitScreeningRun({ id: runId, analysis_date: analysisDate, universe_count: universe.length, started_at: startedAt, quantitative_status: errors.length ? 'partial' : 'completed', enrichment_status: aiCandidates.length ? 'processing' : 'not_started' }, screeningResults as unknown as Array<Record<string, unknown>>);

  let aiReused = 0;
  const aiResults = await mapConcurrent(aiCandidates, 2, async (screeningRow) => {
    const symbol = screeningRow.symbol;
    const latest = await getAgentStoryByEmiten(symbol);
    const hasStructuredAiScore = Number.isFinite(Number(latest?.swot_analysis?.ai_scoring?.score)) && Number.isFinite(Number(latest?.swot_analysis?.ai_scoring?.confidence)) && Boolean(latest?.swot_analysis?.ai_scoring?.model);
    const isFresh = latest?.status === 'completed' && hasStructuredAiScore && latest.created_at && Date.now() - new Date(latest.created_at).getTime() <= 24 * 60 * 60 * 1000;
    if (isFresh) { aiReused++; return { symbol, source: 'cache' as const, enrichment: latest as Record<string, unknown> }; }
    if ((latest?.status === 'pending' || latest?.status === 'processing') && latest.created_at && Date.now() - new Date(latest.created_at).getTime() < 30 * 60 * 1000) return { symbol, source: null, enrichment: null, processing: true };
    const story = await createAgentStory(symbol);
    try {
      await updateAgentStory(story.id, { status: 'processing' });
      const payload = await generateAiStory(symbol);
      await updateAgentStory(story.id, { status: 'completed', ...payload });
      return { symbol, source: 'generated' as const, enrichment: payload as unknown as Record<string, unknown> };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await updateAgentStory(story.id, { status: 'error', error_message: message }).catch(() => undefined);
      throw new Error(message);
    }
  });
  let aiCompleted = 0;
  aiResults.forEach((item, index) => {
    const row = aiCandidates[index];
    if (item.status === 'fulfilled') {
      if (item.value.processing) row.ai_status = 'processing';
      else { row.ai_status = 'completed'; row.ai_source = item.value.source; row.ai_enrichment = item.value.enrichment; row.ai_completed_at = new Date().toISOString(); aiCompleted++; }
    } else {
      const message = item.reason instanceof Error ? item.reason.message : String(item.reason);
      row.ai_status = 'failed'; row.ai_error = message.slice(0, 240);
      errors.push({ symbol: row.symbol, error: `AI Story: ${row.ai_error}` });
    }
  });
  await Promise.all(aiCandidates.map((row) => updateScreeningAiEnrichment(runId, row.symbol, { ai_status: row.ai_status, ai_enrichment: row.ai_enrichment, ai_source: row.ai_source, ai_requested_at: row.ai_requested_at, ai_completed_at: row.ai_completed_at, ai_error: row.ai_error }).catch((error) => errors.push({ symbol: row.symbol, error: `AI enrichment persistence: ${error instanceof Error ? error.message : String(error)}` }))));
  const enrichmentStatus = !aiCandidates.length ? 'not_started' : aiCompleted === aiCandidates.length ? 'completed' : aiCompleted ? 'partial' : 'failed';
  await commitScreeningRun({ id: runId, analysis_date: analysisDate, universe_count: universe.length, started_at: startedAt, quantitative_status: preErrors.size ? 'partial' : 'completed', enrichment_status: enrichmentStatus }, screeningResults as unknown as Array<Record<string, unknown>>)
    .catch((error) => errors.push({ symbol: '*', error: `AI enrichment status persistence: ${errorMessage(error)}` }));
  // The atomic screening contract is authoritative. Legacy rankings and related
  // side effects are best-effort compatibility writes after the run is complete.
  const saved = await saveStockRankings(passedRows as unknown as Array<Record<string, unknown>>).catch((error) => {
    errors.push({ symbol: '*', error: `Legacy ranking persistence: ${errorMessage(error)}` });
    return passedRows;
  });
  await saveStockQueriesForRanking(quantitativeCandidates.map(({ result }) => result), analysisDate).catch((error) => errors.push({ symbol: '*', error: `Stock query persistence: ${error instanceof Error ? error.message : String(error)}` }));
  const alerts = await createMatchingAlertEvents(saved).catch((error) => {
    errors.push({ symbol: '*', error: `Alert creation: ${error instanceof Error ? error.message : String(error)}` });
    return [];
  });
  const contract = groupScreeningResults(screeningResults, universe.length);
  return {
    date: analysisDate, analysisDate, runId, quantitativeStatus: errors.some((item) => !item.error.startsWith('AI')) ? 'partial' : 'completed', enrichmentStatus, ...contract,
    rankings: saved,
    alertsCreated: alerts.length,
    bootstrapped,
    universeSource,
    marketRegime,
    outcomeEvaluation,
    progress: { universe: universe.length, preScreened: preResults.filter((row) => row.status === 'fulfilled').length, candidates: candidates.length, analyzed: deepResults.filter((row) => row.status === 'fulfilled').length, quantitativeSnapshots: quantitativeSnapshots.length, aiRequested: aiCandidates.length, aiCompleted, aiReused, errors } satisfies ScreenerProgress,
  };
}
