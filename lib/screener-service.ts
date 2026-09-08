import { isScreeningUpdateRequired, ScreeningUpdateRequiredError } from './screening-errors';
import { createHash } from 'node:crypto';
import { evaluateStrategyScreening, type StrategyScreeningData } from './strategy-screening';
import { strategyIdentity, parseStrategyId, providerStrategySupport, type StrategyId } from './strategies';
import { screeningIdempotencyKey, parseScreenerRequest } from './screener-request';
import { classifyNews, unavailableNewsEnrichment, unverifiedStoryNewsEnrichment } from './news';
import { formatMarketDate } from './date';
import { calculateRankingScore, classifyTrendWithMarketGate, diagnosticPriorityScore, preScreenHistory, RANKING_MODEL_CONFIG } from './ranking';
import { analyzeSymbol } from './stock-analysis-service';
import { fetchHistoricalSummary } from './stockbit';
import { STOCKBIT_HISTORICAL_PAGE_LIMIT } from './provider-http';
import { appendScreeningRunEvents, bootstrapIdxUniverseFromCache, claimScreeningRun, createAgentStory, createMatchingAlertEvents, ensureDefaultAlertRule, failPendingScreeningRunItems, getActiveIdxUniverse, getStrategyScreeningInput, getScreeningRun, recoverStaleScreeningRuns, getAgentStoryByEmiten, saveIdxUniverse, saveSignalSnapshots, saveSourceSnapshots, saveStockQueriesForRanking, saveStockRankings, updateAgentStory, updateScreeningAiEnrichment, updateScreeningRun, upsertScreeningRunItems } from './supabase';
import type { StockRanking } from './types';
import { evaluateMatureSignals } from './outcome-service';
import { fetchIdxListedCompanies } from './idx';
import { generateAiStory } from './ai-story-service';
import { calculateMarketRegime } from './market-regime';
import { calculateTradingDecision, buildStrategyTradingDecision } from './decision';
import { getCalibratedProbability } from './calibration-service';
import { ACTIVE_ELIGIBILITY_CONFIG_VERSION, ACTIVE_EXECUTION_MODEL, ACTIVE_MODEL_VERSION, ACTIVE_OUTCOME_DEFINITION, ACTIVE_RANKING_MODEL_VERSION, ACTIVE_REGIME_METHODOLOGY_VERSION, ACTIVE_RELATIVE_STRENGTH_METHODOLOGY_VERSION, ACTIVE_SELECTION_SCOPE, buildCalibrationContext } from './model-versions';
import { evaluateEligibility, groupScreeningResults, SCREENER_ELIGIBILITY_CONFIG, type ScreeningResult, type SelectionStage } from './screening';
import { deriveFunnelSummary, safeProcessingError, validateFunnelSummary, type ScreeningRunStatus, withTimeout, withProviderRetry } from './screener-observability';
import { assessBacktestEligibility, filterCompletedDailyCandles, marketSessionAt, createPointInTimeContext, POINT_IN_TIME_POLICY_VERSION, type ScreeningExecutionMode } from './point-in-time';
import { ACTIVE_STRATEGY_PROFILE, BROKER_FLOW_POLICY, EXECUTION_POLICY, FACTOR_LINEAGE, LIQUIDITY_POLICY, SCREENER_FACTOR_CONFIG, SECTOR_PEER_POLICY } from './screener-factor-config';
import { buildIdxScreenerCandidate } from './idx-screener-adapter';
import { evaluateUnifiedIdxScreener } from './idx-strategy-filters';

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

async function mapConcurrent<T, R>(items: T[], concurrency: number, worker: (item: T) => Promise<R>, deadline = Infinity): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(items.length);
  let cursor = 0;
  async function run() {
    while (cursor < items.length) {
      const index = cursor++;
      try { if (Date.now() >= deadline) throw new Error('Run timeout: anggaran waktu pemrosesan habis'); results[index] = { status: 'fulfilled', value: await worker(items[index]) }; }
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

export async function runMarketScreener(options: { strategyId?: StrategyId; analysisDate?: string; informationCutoffAt?: string; executionMode?: ScreeningExecutionMode; universeLimit?: number; deepLimit?: number; aiLimit?: number; concurrency?: number; triggerSource?: string; requestedBy?: string; idempotencyKey?: string } = {}) {
  const validated = parseScreenerRequest(options);
  options = { ...options, ...validated };
  const strategyId = parseStrategyId(options.strategyId);
  const identity = strategyIdentity(strategyId);
  const strategySupport = providerStrategySupport(strategyId);
  const initialContext = createPointInTimeContext({ analysisDate: options.analysisDate ?? formatMarketDate(), informationCutoffAt: options.informationCutoffAt, executionMode: options.executionMode });
  const analysisDate = initialContext.analysisDate;
  if (initialContext.executionMode === 'historical_replay') throw new Error('HISTORICAL_SNAPSHOT_MISSING: arsip point-in-time belum tersedia lengkap; replay dihentikan sebelum endpoint live dipanggil.');
  await recoverStaleScreeningRuns();
  const runId = crypto.randomUUID();
  const startedAt = new Date().toISOString();
  const runEpoch = Date.parse(startedAt);
  const claimed = await claimScreeningRun({ ...identity, strategy_support: strategySupport, id: runId, analysis_date: analysisDate, started_at: startedAt, screened_at: startedAt, information_cutoff_at: initialContext.informationCutoffAt, market_timezone: initialContext.marketTimezone, market_session: initialContext.marketSession, execution_mode: initialContext.executionMode, data_policy_version: POINT_IN_TIME_POLICY_VERSION, point_in_time_status: 'partial', trigger_source: options.triggerSource ?? 'api', requested_by: options.requestedBy ?? null, idempotency_key: screeningIdempotencyKey({ strategyId, analysisDate, cutoff: options.informationCutoffAt, executionMode: initialContext.executionMode, clientKey: options.idempotencyKey, universeLimit: options.universeLimit, deepLimit: options.deepLimit, aiLimit: options.aiLimit }), eligibility_config_version: ACTIVE_ELIGIBILITY_CONFIG_VERSION, ranking_model_version: ACTIVE_RANKING_MODEL_VERSION, methodology_version: MODEL_VERSION });
  if (claimed.reused) {
    const existing = await getScreeningRun(claimed.id, strategyId);
    return { ...identity, strategyId, strategySupport, reused: true, runId: claimed.id, analysisDate, date: analysisDate, run: existing ?? { ...identity, id: claimed.id, status: 'failed' }, summary: existing?.summary ?? null, results: { passed: [], watch: [], rejected: [], processingError: [] }, rankings: [], alertsCreated: 0, progress: { universe: 0, preScreened: 0, candidates: 0, analyzed: 0, quantitativeSnapshots: 0, aiRequested: 0, aiCompleted: 0, aiReused: 0, errors: [] } };
  }
  try {
  await appendScreeningRunEvents([{ run_id: runId, symbol: null, stage: 'universe', event_type: 'run_started', status: 'running', metadata: {}, idempotency_key: 'run_started', occurred_at: startedAt }]);
  if (strategyId !== 'swing') {
    const universe = await getActiveIdxUniverse(options.universeLimit ?? 1000);
    await updateScreeningRun(runId, { universe_count: universe.length, universe_size: universe.length, quantitative_status: 'processing', universe_source: 'database' });
    const evaluated = await mapConcurrent(universe, options.concurrency ?? 4, async company => {
      const input = await withTimeout(() => getStrategyScreeningInput(company.symbol, strategyId, initialContext.informationCutoffAt, initialContext.executionMode), 15_000);
      const assessment = evaluateStrategyScreening({ strategyId, cutoffAt: initialContext.informationCutoffAt, data: input?.data });
      const decision = buildStrategyTradingDecision(assessment, input?.data, initialContext.informationCutoffAt);
      return { company, input, assessment, decision };
    }, runEpoch + 175_000);
    const evaluatedAt = new Date().toISOString();
    const results: ScreeningResult[] = evaluated.map((value, index) => {
      const company = universe[index];
      const assessment = value.status === 'fulfilled' ? value.value.assessment : evaluateStrategyScreening({ strategyId, cutoffAt: initialContext.informationCutoffAt, data: { symbol: company.symbol, candles: [], sameClockVolumes: [], sessionCoverageFromOpen: false, providerError: 'archive_fetch_failed' } });
      const input = value.status === 'fulfilled' ? value.value.input : undefined;
      const quantCompleted = input !== undefined && assessment.support.level !== 'unavailable';
      const universeEvidence = (input?.data as (StrategyScreeningData & { universeProvenance?: { availableAt: string; complete: boolean; sourceUrl: string } }) | undefined)?.universeProvenance;
      const universeVerified = !!universeEvidence?.complete && /^https:\/\//.test(universeEvidence.sourceUrl) && Number.isFinite(Date.parse(universeEvidence.availableAt)) && Date.parse(universeEvidence.availableAt) <= Date.parse(initialContext.informationCutoffAt);
      const archiveMeta = input?.data as (StrategyScreeningData & { origin?: string; corporateActionsVerified?: boolean }) | undefined;
      const fixture = archiveMeta?.origin === 'fixture' || !!input && /fixture|mock|synthetic/i.test(input.source);
      const originVerified = archiveMeta?.origin === (initialContext.executionMode === 'live' ? 'live_observed' : 'historical_archive');
      const corporateActionsVerified = archiveMeta?.corporateActionsVerified === true;
      const valid = quantCompleted && assessment.support.level === 'ready';
      const backtestEligible = valid && universeVerified && originVerified && corporateActionsVerified && !fixture;
      const archivedNews = (input?.data as (StrategyScreeningData & { news?: import('./news').NewsInput[] }) | undefined)?.news;
      const news = archivedNews ? classifyNews(archivedNews, { symbol: company.symbol, strategyId, informationCutoffAt: initialContext.informationCutoffAt, horizonEndAt: value.status === 'fulfilled' ? value.value.decision.timeExitAt : null }) : unavailableNewsEnrichment(initialContext.informationCutoffAt);
      const ranking: StockRanking | null = assessment.screeningStatus === 'passed' && assessment.rankingScore !== null && assessment.metrics.price !== null && value.status === 'fulfilled' ? {
        ...identity, run_id: runId, information_cutoff_at: initialContext.informationCutoffAt, analysis_date: analysisDate, symbol: company.symbol, rank: 0, score: assessment.heuristicScore!, analysis_score: assessment.heuristicScore!, ranking_score: assessment.rankingScore, ranking_position: 0, data_completeness: 100, confidence: null, signal: 'early_uptrend', model_probability: null, probability_calibration: null, last_price: assessment.metrics.price, reasons: assessment.rules.map(rule => ({ label: rule.label, value: rule.explanation, positive: rule.passed })), risk_flags: assessment.warnings, components: [], eligibility_status: assessment.eligibilityStatus, eligibility_rules: assessment.rules, eligibility_config_version: identity.configuration_version, ranking_model_version: identity.strategy_version, decision: value.value.decision, strategy_support: assessment.support, strategy_assessment: assessment as unknown as Record<string, unknown>, news_enrichment: news,
      } : null;
      return { ...identity, strategy_assessment: assessment, monitoring: assessment.monitoring, signal_valid_until: assessment.validUntil, strategy_support: assessment.support, symbol: company.symbol, company_name: company.company_name ?? null, sector: company.sector ?? null, run_id: runId, analysis_date: analysisDate, screening_status: assessment.screeningStatus, eligibility_status: assessment.eligibilityStatus, eligibility_rules: assessment.rules, passed_rules: assessment.rules.filter(rule => rule.passed), failed_rules: assessment.rules.filter(rule => !rule.passed), selection_stage: assessment.screeningStatus === 'passed' ? 'final_selection' : 'quality_gate', data_quality: { completeness: valid ? 100 : null, confidence: null, valid }, evaluated_at: evaluatedAt, current_stage: value.status === 'rejected' ? 'data_acquisition' : 'completed', terminal_status: value.status === 'rejected' ? 'processing_error' : 'completed', failure_stage: value.status === 'rejected' ? 'data_acquisition' : null, quantitative_status: quantCompleted ? 'completed' : 'skipped', selected_for_quantitative: quantCompleted, selected_for_ai: false, ranking, analysis_score: assessment.heuristicScore, ranking_score: ranking?.ranking_score ?? null, ranking_position: null, ai_status: 'not_requested', news_enrichment: news, feature_cutoff_at: initialContext.informationCutoffAt, point_in_time_valid: valid, backtest_eligible: backtestEligible, backtest_ineligibility_reasons: backtestEligible ? [] : [{ code: !valid ? 'REQUIRED_INTRADAY_DATA_UNAVAILABLE' : fixture ? 'FIXTURE_EXCLUDED' : !originVerified ? 'DATA_ORIGIN_UNVERIFIED' : !corporateActionsVerified ? 'CORPORATE_ACTIONS_UNVERIFIED' : 'HISTORICAL_UNIVERSE_UNVERIFIED', message: !valid ? assessment.support.reasons.join(' ') : 'Coverage dan provenance universe harus diverifikasi; fixture bukan data pasar.' }], completed_at: evaluatedAt } as ScreeningResult;
    });
    const ranked = results.filter(row => row.ranking).sort((a,b) => (b.ranking_score ?? 0) - (a.ranking_score ?? 0) || a.symbol.localeCompare(b.symbol));
    ranked.forEach((row,index) => { row.ranking_position = index + 1; row.ranking!.rank = index + 1; row.ranking!.ranking_position = index + 1; });
    await upsertScreeningRunItems(results as unknown as Array<Record<string, unknown>>);
    const snapshots = evaluated.flatMap((value,index) => {
      if (value.status !== 'fulfilled' || !value.value.input || value.value.assessment.heuristicScore === null) return [];
      const { company, input, assessment, decision } = value.value;
      const row = results[index] as ScreeningResult & { backtest_eligible: boolean; backtest_ineligibility_reasons: unknown[]; point_in_time_valid: boolean };
      return [{ ...identity, signal_date: analysisDate, symbol: company.symbol, run_id: runId, information_cutoff_at: initialContext.informationCutoffAt, execution_mode: initialContext.executionMode, data_policy_version: POINT_IN_TIME_POLICY_VERSION, point_in_time_valid: row.point_in_time_valid, source_provenance: [{ source: input.source, sourceSnapshotId: input.sourceSnapshotId, availableAt: input.availableAt, observedAt: input.observedAt, fetchedAt: input.fetchedAt }], backtest_eligible: row.backtest_eligible, backtest_ineligibility_reasons: row.backtest_ineligibility_reasons, score: assessment.heuristicScore, signal: assessment.screeningStatus === 'passed' ? 'early_uptrend' : 'watch', data_completeness: assessment.support.level === 'ready' ? 100 : null, entry_price: decision.entry.reference, target_price: decision.targets.target1, stop_price: decision.stop.price, model_version: identity.strategy_version, methodology_version: identity.strategy_version, feature_snapshot: { ...identity, persisted_at: evaluatedAt, decision, strategy_assessment: assessment, official_ara: input.data.officialAra ?? null, source_snapshot_id: input.sourceSnapshotId, origin: (input.data as StrategyScreeningData & { origin?: string }).origin ?? 'legacy_unverified', validation_status: 'unvalidated_baseline' } }];
    });
    await saveSignalSnapshots(snapshots);
    await appendScreeningRunEvents(results.map(row => ({ run_id: runId, symbol: row.symbol, stage: 'eligibility', event_type: 'strategy_assessed', status: row.screening_status, metadata: { strategy_id: strategyId, support: row.strategy_support, reason_category: row.strategy_assessment?.reasonCategory }, idempotency_key: `${row.symbol}:strategy_assessed`, occurred_at: evaluatedAt })));
    const contract = groupScreeningResults(results, universe.length), summary = deriveFunnelSummary(results);
    const ready = results.filter(row => row.strategy_support?.level === 'ready').length;
    const support = ready === universe.length && universe.length ? { level: 'ready' as const, reasons: ['Data wajib tersedia dari arsip dengan cutoff yang cocok; threshold strategi belum tervalidasi.'] } : ready ? { level: 'partial' as const, reasons: [`${ready}/${universe.length} simbol memiliki data wajib lengkap.`] } : strategySupport;
    const status = evaluated.some(value => value.status === 'rejected') ? 'partial' : 'completed';
    const run = { ...identity, id: runId, analysis_date: analysisDate, status, quantitative_status: status, enrichment_status: 'skipped', started_at: startedAt, completed_at: evaluatedAt, screened_at: startedAt, information_cutoff_at: initialContext.informationCutoffAt, market_timezone: initialContext.marketTimezone, market_session: initialContext.marketSession, execution_mode: initialContext.executionMode, data_policy_version: POINT_IN_TIME_POLICY_VERSION, strategy_support: support, universe_count: universe.length, universe_size: universe.length, summary, point_in_time_status: ready === universe.length && universe.length ? 'valid' : ready ? 'partial' : 'invalid', point_in_time_warnings: ready === universe.length && universe.length ? [] : [{ code: 'REQUIRED_STRATEGY_DATA_UNAVAILABLE', reasons: support.reasons }] };
    await updateScreeningRun(runId, run);
    await appendScreeningRunEvents([{ run_id: runId, symbol: null, stage: 'completed', event_type: 'strategy_run_completed', status, metadata: support, idempotency_key: 'strategy_run_completed', occurred_at: evaluatedAt }]);
    return { ...identity, strategyId, strategySupport: support, runId, analysisDate, date: analysisDate, run, ...contract, summary, rankings: ranked.map(row => row.ranking!), alertsCreated: 0, progress: { universe: universe.length, preScreened: 0, candidates: ready, analyzed: summary.quantitativeCompleted, quantitativeSnapshots: snapshots.length, aiRequested: 0, aiCompleted: 0, aiReused: 0, errors: results.filter(row => row.screening_status === 'processing_error').map(row => ({ symbol: row.symbol, error: 'Arsip data simbol tidak dapat diproses.' })) } };
  }
  const outcomeEvaluation = await evaluateMatureSignals(100).catch((error) => ({ pending: 0, evaluated: 0, errors: [{ symbol: '*', error: error instanceof Error ? error.message : String(error) }] }));
  let universeSource: 'idx' | 'database' | 'watchlist-cache' = 'database';
  let bootstrapped = 0;
  try {
    bootstrapped = (await saveIdxUniverse(await withProviderRetry(() => fetchIdxListedCompanies(), { timeoutMs: 15_000 }))).length;
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
  const universeAt = new Date().toISOString();
  await updateScreeningRun(runId, { universe_source: universeSource, universe_size: universe.length, universe_count: universe.length, quantitative_status: 'processing' });
  await upsertScreeningRunItems(universe.map((company) => ({ ...identity, strategy_support: strategySupport, run_id: runId, symbol: company.symbol, company_name: company.company_name ?? null, sector: company.sector ?? null, analysis_date: analysisDate, screening_status: null, passed_rules: [], failed_rules: [], selection_stage: 'universe', data_quality: {}, evaluated_at: universeAt, current_stage: 'universe', terminal_status: 'pending', quantitative_status: 'not_started', started_at: universeAt })));
  await appendScreeningRunEvents([{ run_id: runId, symbol: null, stage: 'universe', event_type: 'universe_loaded', status: 'completed', metadata: { count: universe.length, source: universeSource }, idempotency_key: 'universe_loaded', occurred_at: universeAt }]);
  await ensureDefaultAlertRule();
  const start = new Date(`${analysisDate}T00:00:00Z`);
  start.setUTCDate(start.getUTCDate() - 120);
  const historyStart = start.toISOString().slice(0, 10);
  const marketHistory = filterCompletedDailyCandles(await withProviderRetry(() => fetchHistoricalSummary('COMPOSITE', historyStart, analysisDate, STOCKBIT_HISTORICAL_PAGE_LIMIT)).catch(() => []), initialContext);
  const marketRegime = calculateMarketRegime(marketHistory);
  const preResults = await mapConcurrent(universe, options.concurrency ?? 5, async (company) => {
    const history = filterCompletedDailyCandles(await withProviderRetry(() => fetchHistoricalSummary(company.symbol, historyStart, analysisDate, STOCKBIT_HISTORICAL_PAGE_LIMIT)), initialContext);
    return { company, pre: preScreenHistory(history), history };
  }, runEpoch + 100_000);
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
  await updateScreeningRun(runId, { quantitative_status: 'processing' });
  const deepResults = await mapConcurrent(candidates, Math.min(options.concurrency ?? 4, 4), async ({ company, history }) => {
    const result = await withTimeout(() => analyzeSymbol(company.symbol, analysisDate, { stockHistory: history, marketHistory, pointInTimeContext: initialContext, fixedInformationCutoffAt: options.informationCutoffAt }), 45_000);
    const calibrated = await getCalibratedProbability(buildCalibrationContext({ score: result.analysis.score, marketRegime: marketRegime.label, analysisDate, calibrationCutoff: result.pointInTimeContext.informationCutoffAt, methodologyVersion: result.analysis.methodologyVersion }));
    const classification = classifyTrendWithMarketGate(result.analysis, result.marketRegime, result.relativeStrength);
    result.analysis.exceptionalStrength = classification.gate.exceptionalStrengthCheck;
    result.analysis.gateResult = classification.gate;
    return { result, calibrated, classification };
  }, runEpoch + 175_000);
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
    return { ...calculateTradingDecision({ currentPrice: result.lastPrice, bestBid, bestOffer, targetRealistic: result.targets.targetRealistis1, targetMaximum: result.targets.targetMax, ara: result.ara, atrPercent: metricNumber('atr'), priceVsSma20Percent: metricNumber('sma20'), relativeVolume: metricNumber('volumeRatio'), liquidityScore: componentScore('liquidity'), brokerFlowScore: componentScore('brokerFlow'), signal: classification.signal, marketRegime: result.marketRegime.label, marketGateBlocked: classification.gate.signalBeforeGate !== 'avoid' && classification.gate.signalAfterGate === 'avoid', hardRiskFlags: classification.signal === 'avoid' ? classification.riskFlags : [], confidence: classification.gate.confidenceAfter ?? result.analysis.confidence, dataCompleteness: result.analysis.dataCompleteness, generatedAt: result.analysis.generatedAt, orderbookGeneratedAt: result.orderbook.observedAt ?? undefined, aiStoryGeneratedAt: null }), ...identity, horizon: '5–20 sesi bursa' };
  };
  const preScreenPassedBySymbol = new Map(candidates.map(({ company, pre }) => [company.symbol, pre.passed]));
  // Finalize live run cutoff at acquisition, before quantitative persistence and AI.
  const acquisitionCutoff = options.informationCutoffAt ?? quantitativeCandidates.map(({ result }) => result.pointInTimeContext.informationCutoffAt).sort().at(-1) ?? initialContext.informationCutoffAt;
  await updateScreeningRun(runId, { information_cutoff_at: acquisitionCutoff, market_session: marketSessionAt(new Date(acquisitionCutoff)) });
  const quantitativeSnapshots = await saveSignalSnapshots(quantitativeCandidates.map((candidate) => {
    const { result, calibrated, classification } = candidate;
    const decision = buildDecision(candidate);
    const preScreenPassed = preScreenPassedBySymbol.get(result.symbol) ?? false;
    const persistedAt = new Date().toISOString();
    const backtest = assessBacktestEligibility({ context: result.pointInTimeContext, sources: result.sourceProvenance, decisionPersistedAt: persistedAt, modelVersion: MODEL_VERSION, configVersion: ACTIVE_ELIGIBILITY_CONFIG_VERSION });
    return { ...identity, signal_date: analysisDate, symbol: result.symbol, run_id: runId, information_cutoff_at: result.pointInTimeContext.informationCutoffAt, execution_mode: result.pointInTimeContext.executionMode, data_policy_version: POINT_IN_TIME_POLICY_VERSION, point_in_time_valid: result.sourceProvenance.every((item) => item.temporalValidity === 'valid'), source_provenance: result.sourceProvenance, backtest_eligible: backtest.eligible, backtest_ineligibility_reasons: backtest.reasons, score: result.analysis.score, data_completeness: result.analysis.dataCompleteness, signal: classification.signal, entry_price: decision.entry.reference ?? result.lastPrice, target_price: decision.targets.target1, stop_price: decision.stop.price, signal_agreement: result.analysis.quality?.agreement.score ?? null, confidence: result.analysis.quality?.confidence ?? null, dominant_direction: result.analysis.quality?.dominantDirection ?? null, methodology_version: result.analysis.methodologyVersion, market_regime: marketRegime.label, market_regime_score: marketRegime.score, regime_methodology_version: ACTIVE_REGIME_METHODOLOGY_VERSION, benchmark_observed_at: marketHistory.at(-1)?.date ?? null, execution_model: ACTIVE_EXECUTION_MODEL, outcome_definition: ACTIVE_OUTCOME_DEFINITION, selection_scope: ACTIVE_SELECTION_SCOPE, selection_stage: 'quantitative_evaluated', selection_reason: preScreenPassed ? 'passed_pre_screen' : 'top_quantitative_fallback', pre_screen_passed: preScreenPassed, feature_snapshot: { ...identity, persisted_at: persistedAt, strategy_profile: ACTIVE_STRATEGY_PROFILE, factor_config_version: SCREENER_FACTOR_CONFIG.version, policy_versions: { liquidity: LIQUIDITY_POLICY.version, execution: EXECUTION_POLICY.version, brokerFlow: BROKER_FLOW_POLICY.version, sectorPeer: SECTOR_PEER_POLICY.version }, factor_lineage: FACTOR_LINEAGE, validation_status: 'unvalidated_baseline', analysis_quality: result.analysis.quality ?? null, components: result.analysis.components, source_timestamps: result.analysis.quality?.freshness.sources ?? null, sector: result.sector ?? null, market_regime: marketRegime.label, market_regime_score: marketRegime.score, regime_methodology_version: ACTIVE_REGIME_METHODOLOGY_VERSION, benchmark_observed_at: marketHistory.at(-1)?.date ?? null, relative_strength: result.relativeStrength, gate: classification.gate, decision, selection_scope: ACTIVE_SELECTION_SCOPE, selection_stage: 'quantitative_evaluated', selection_reason: preScreenPassed ? 'passed_pre_screen' : 'top_quantitative_fallback', pre_screen_passed: preScreenPassed, execution_spread_percent: (() => { const bid = Math.max(...result.orderbook.bid.map((x) => x.price), 0); const offer = Math.min(...result.orderbook.offer.map((x) => x.price)); const mid = (bid + offer) / 2; return bid > 0 && Number.isFinite(offer) && mid > 0 ? (offer - bid) / mid * 100 : null; })(), raw_features: { stock_history: result.history, market_history: marketHistory }, model_probability: calibrated.probability, probability_calibration: calibrated }, model_version: MODEL_VERSION };
  }));
  await saveSourceSnapshots(quantitativeCandidates.flatMap(({ result }) => result.sourceProvenance.map((source) => {
    const payload = source.dataType === 'historical_price' ? result.history : source.dataType === 'benchmark' ? marketHistory : source.dataType === 'orderbook' ? result.orderbook : source.dataType === 'market_price' ? { price: result.lastPrice } : source.dataType === 'broker_summary' ? { summary: result.brokerSummary, topBroker: result.brokerData } : null;
    return { ...identity, run_id: runId, symbol: result.symbol, source: source.source, data_type: source.dataType, payload, provider_reference: source.providerReference, content_hash: payload === null ? source.contentHash ?? null : createHash('sha256').update(JSON.stringify(payload)).digest('hex'), effective_at: source.effectiveAt, published_at: source.publishedAt, observed_at: source.observedAt, fetched_at: source.fetchedAt, available_at: source.availableAt, period_start: source.periodStart ?? null, period_end: source.periodEnd ?? null, is_historical_snapshot: source.isHistoricalSnapshot, temporal_validation_status: source.temporalValidity };
  })));

  // Rankings and screening eligibility are derived once from the quantitative
  // pass. AI enrichment below never re-runs or mutates this baseline.
  const rankingRows: StockRanking[] = quantitativeCandidates.map(({ result, calibrated, classification }) => {
    const marketContext = { regime: result.marketRegime, relativeStrength: result.relativeStrength, gate: classification.gate };
    const decision = buildDecision({ result, calibrated, classification, sortScore: diagnosticPriorityScore(result.analysis, calibrated.probability) });
    const rankingResult = calculateRankingScore({ momentumScore: result.analysis.components.find((c) => c.key === 'technical')?.score ?? null, relativeStrength20d: result.relativeStrength.rs20d, brokerFlowScore: result.analysis.components.find((c) => c.key === 'brokerFlow')?.score ?? null, liquidityScore: result.analysis.components.find((c) => c.key === 'liquidity')?.score ?? null, signalAgreement: result.analysis.quality?.agreement.score ?? null, confidence: result.analysis.quality?.confidence ?? result.analysis.confidence, probability: calibrated });
    return {
    ...identity,
    run_id: runId,
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
  const historyBySymbol = new Map(preScreened.map((item) => [item.company.symbol, item.history]));
  const deepBySymbol = new Map(quantitativeCandidates.map((item) => [item.result.symbol, item]));
  const finalBySymbol = new Map(rankingRows.map((item) => [item.symbol, item]));
  const preErrors = new Map(errors.map((item) => [item.symbol, item.error]));
  const candidateSymbols = new Set(candidates.map((item) => item.company.symbol));
  const evaluatedAt = new Date().toISOString();
  const unified = evaluateUnifiedIdxScreener(universe.map((company) => {
    const quantitative = deepBySymbol.get(company.symbol)?.result;
    const brokerSource = quantitative?.sourceProvenance.find((source) => source.dataType === 'broker_summary');
    return buildIdxScreenerCandidate({
      ticker: company.symbol,
      history: historyBySymbol.get(company.symbol) ?? quantitative?.history ?? [],
      marketCap: quantitative?.marketCap ?? null,
      // The provider's historical net_foreign field is shares, not IDR value.
      // It is intentionally not substituted for foreign_net_value.
      foreignNetValue: null,
      orderbook: quantitative?.orderbook ?? null,
      brokerSummary: quantitative?.brokerSummary ?? null,
      orderbookUpdatedAt: quantitative?.orderbook.observedAt ?? null,
      brokerSummaryUpdatedAt: brokerSource?.availableAt ?? null,
    });
  }), { evaluatedAt: acquisitionCutoff, enforceFreshness: true });
  const unifiedBySymbol = new Map(unified.results.map((row) => [row.ticker, row]));
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
    const execution = quantitative?.result.analysis.components.find((item) => item.key === 'liquidity')?.execution;
    const executionScenario = execution?.scenarios.find((item) => item.notional === 50_000_000) ?? execution?.scenarios[0];
    const executionDeferred = initialContext.marketSession !== 'intraday';
    const technicalCoverage = quantitative?.result.analysis.components.find((item) => item.key === 'technical')?.coverage ?? 0;
    const executionCoverage = execution?.available ? 100 : 0;
    const eligibilityCoverage = quantitative ? Math.round(technicalCoverage * .7 + executionCoverage * .3) : null;
    const eligibility = evaluateEligibility({
      processingError: processError,
      preScreenPassed: pre?.passed ?? false,
      // Eligibility coverage contains only swing-critical price history and
      // execution evidence. Missing contextual fundamentals/news cannot turn a
      // valid setup into a hard rejection.
      completeness: eligibilityCoverage,
      confidence,
      criticalDataAvailable: Boolean(quantitative && pre && typeof spreadPercent === 'number'),
      criticalDataStale: freshness.some((item) => (executionDeferred ? item.source === 'historicalPrice' : ['orderbook', 'marketPrice', 'historicalPrice'].includes(item.source)) && item.status === 'stale'),
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
      executionStatus: executionScenario?.executionStatus ?? null,
      executionDeferred,
    });
    const skipped = Boolean(pre && !candidateSymbols.has(company.symbol));
    const stage: SelectionStage = processError && !pre ? 'universe' : skipped || !quantitative ? 'pre_screen' : eligibility.screeningStatus === 'passed' ? 'final_selection' : 'quality_gate';
    const safeError = processError ? safeProcessingError(processError, pre ? 'QUANTITATIVE_ANALYSIS_FAILED' : 'HISTORY_FETCH_FAILED', pre ? 'quantitative_analysis' : 'data_acquisition') : null;
    return { ...identity, strategy_assessment: unifiedBySymbol.get(company.symbol) ?? null, strategy_support: strategySupport, news_enrichment: unavailableNewsEnrichment(quantitative?.result.pointInTimeContext.informationCutoffAt ?? initialContext.informationCutoffAt), symbol: company.symbol, company_name: company.company_name ?? null, sector: company.sector ?? null, analysis_date: analysisDate, screening_status: skipped ? null : eligibility.screeningStatus, eligibility_status: skipped ? 'not_evaluated' : eligibility.status, eligibility_rules: skipped ? [] : eligibility.rules, passed_rules: skipped ? [] : eligibility.rules.filter((item) => item.passed), failed_rules: skipped ? [] : eligibility.rules.filter((item) => !item.passed), selection_stage: stage, data_quality: { completeness, confidence, valid: !processError && Boolean(quantitative) }, evaluated_at: evaluatedAt, run_id: runId, analysis_score: ranking?.analysis_score ?? null, ranking_score: null, ranking_position: null, ranking_factors: [], eligibility_config_version: SCREENER_ELIGIBILITY_CONFIG.version, ranking_model_version: RANKING_MODEL_CONFIG.version, ranking: null, current_stage: processError ? safeError!.stage : skipped ? 'quantitative_selection' : 'persisted', terminal_status: processError ? 'processing_error' : skipped ? 'skipped' : !pre?.passed ? 'filtered_out' : 'completed', pre_screen_passed: pre?.passed ?? null, pre_screen_score: pre?.score ?? null, pre_screen_rules: pre ?? {}, selected_for_quantitative: candidateSymbols.has(company.symbol), quantitative_status: skipped ? 'skipped' : processError && pre ? 'failed' : quantitative ? 'completed' : 'not_started', data_completeness: completeness, confidence, selected_for_ai: false, failure_stage: safeError?.stage ?? null, error_code: safeError?.code ?? null, error_message: safeError?.safe_message ?? null, completed_at: evaluatedAt, ai_status: 'not_requested', ai_enrichment: null, ai_source: null, ai_requested_at: null, ai_completed_at: null, ai_error: null } as unknown as ScreeningResult & Record<string, unknown>;
  });
  for (const row of screeningResults as Array<ScreeningResult & Record<string, unknown>>) {
    const quantitative = deepBySymbol.get(row.symbol)?.result;
    const provenance = quantitative?.sourceProvenance ?? [];
    const issues = provenance.filter((item) => item.temporalValidity !== 'valid').map((item) => ({ sourceType: item.dataType, status: item.temporalValidity }));
    row.feature_cutoff_at = quantitative?.pointInTimeContext.informationCutoffAt ?? initialContext.informationCutoffAt;
    row.point_in_time_valid = Boolean(quantitative) && issues.length === 0;
    row.point_in_time_issues = issues;
    row.source_provenance = provenance;
    row.backtest_eligible = Boolean(row.point_in_time_valid);
    row.backtest_ineligibility_reasons = row.point_in_time_valid ? [] : issues.length ? issues : [{ code: 'SOURCE_PROVENANCE_MISSING' }];
  }
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
  for (const row of aiCandidates) Object.assign(row, { selected_for_ai: true, current_stage: 'ai_enrichment' });
  await upsertScreeningRunItems(screeningResults as unknown as Array<Record<string, unknown>>);
  await appendScreeningRunEvents(screeningResults.flatMap((row) => {
    const item = row as ScreeningResult & Record<string, unknown>;
    const events: Array<Record<string, unknown>> = [];
    const add = (stage: string, eventType: string, status: string, metadata: Record<string, unknown> = {}) => events.push({ run_id: runId, symbol: row.symbol, stage, event_type: eventType, status, metadata, idempotency_key: `${row.symbol}:${eventType}`, occurred_at: evaluatedAt });
    if (item.failure_stage === 'data_acquisition') add('data_acquisition', 'data_fetch_failed', 'failed', { error_code: item.error_code });
    else add('data_acquisition', 'data_fetch_completed', 'completed');
    if (item.pre_screen_passed === true) add('pre_screen', 'pre_screen_passed', 'completed', { score: item.pre_screen_score });
    else if (item.pre_screen_passed === false) add('pre_screen', 'pre_screen_failed', 'filtered_out', { score: item.pre_screen_score });
    if (item.selected_for_quantitative) add('quantitative_selection', 'quantitative_selected', 'completed');
    else if (item.quantitative_status === 'skipped') add('quantitative_selection', 'quantitative_skipped', 'skipped');
    if (item.quantitative_status === 'completed') add('quantitative_analysis', 'analysis_completed', 'completed');
    if (item.quantitative_status === 'failed') add('quantitative_analysis', 'analysis_failed', 'failed', { error_code: item.error_code });
    if (row.eligibility_status && row.eligibility_status !== 'not_evaluated') add('eligibility', 'eligibility_evaluated', String(row.screening_status), { eligibility_status: row.eligibility_status });
    if (row.ranking_position != null) add('ranking', 'ranking_assigned', 'completed', { position: row.ranking_position });
    return events;
  }));
  // This commit is intentionally before the first AI request: a complete,
  // queryable quantitative snapshot exists even if every provider call fails.
  await updateScreeningRun(runId, { quantitative_status: errors.length ? 'partial' : 'completed', enrichment_status: aiCandidates.length ? 'processing' : 'not_started' });
  await appendScreeningRunEvents([{ run_id: runId, symbol: null, stage: 'persisted', event_type: 'results_persisted', status: 'completed', metadata: { count: screeningResults.length }, idempotency_key: 'results_persisted', occurred_at: new Date().toISOString() }]);

  let aiReused = 0;
  const aiResults = await mapConcurrent(aiCandidates, 2, async (screeningRow) => {
    const symbol = screeningRow.symbol;
    const latest = await withTimeout(() => getAgentStoryByEmiten(symbol), 10_000);
    const hasStructuredAiScore = Number.isFinite(Number(latest?.swot_analysis?.ai_scoring?.score)) && Number.isFinite(Number(latest?.swot_analysis?.ai_scoring?.confidence)) && Boolean(latest?.swot_analysis?.ai_scoring?.model);
    const isFresh = latest?.status === 'completed' && hasStructuredAiScore && latest.created_at && Date.now() - new Date(latest.created_at).getTime() <= 24 * 60 * 60 * 1000;
    if (isFresh) { aiReused++; return { symbol, source: 'cache' as const, enrichment: latest as Record<string, unknown> }; }
    if ((latest?.status === 'pending' || latest?.status === 'processing') && latest.created_at && Date.now() - new Date(latest.created_at).getTime() < 30 * 60 * 1000) return { symbol, source: null, enrichment: null, processing: true };
    const story = await createAgentStory(symbol);
    try {
      await updateAgentStory(story.id, { status: 'processing' });
      const payload = await withTimeout(() => generateAiStory(symbol), 35_000);
      await updateAgentStory(story.id, { status: 'completed', ...payload });
      return { symbol, source: 'generated' as const, enrichment: payload as unknown as Record<string, unknown> };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await updateAgentStory(story.id, { status: 'error', error_message: message }).catch(() => undefined);
      throw new Error(message);
    }
  }, runEpoch + 220_000);
  let aiCompleted = 0;
  aiResults.forEach((item, index) => {
    const row = aiCandidates[index];
    if (item.status === 'fulfilled') {
      if (item.value.processing) { row.ai_status = 'failed'; row.ai_error = 'Pengayaan lain masih berjalan; coba pengayaan lagi nanti.'; }
      else { row.ai_status = 'completed'; row.ai_source = item.value.source; row.ai_enrichment = item.value.enrichment; row.ai_completed_at = new Date().toISOString(); aiCompleted++; }
    } else {
      const message = item.reason instanceof Error ? item.reason.message : String(item.reason);
      row.ai_status = 'failed'; row.ai_error = safeProcessingError(message, 'AI_PROVIDER_FAILED', 'ai_enrichment').safe_message;
      errors.push({ symbol: row.symbol, error: `AI Story: ${row.ai_error}` });
    }
  });
  for (const row of aiCandidates) {
    row.news_enrichment = row.ai_status === 'completed' ? unverifiedStoryNewsEnrichment(row.ai_enrichment as Parameters<typeof unverifiedStoryNewsEnrichment>[0], { symbol: row.symbol, strategyId, informationCutoffAt: (row as ScreeningResult & { feature_cutoff_at?: string }).feature_cutoff_at ?? acquisitionCutoff }) : unavailableNewsEnrichment(acquisitionCutoff, 'failed');
  }
  await Promise.all(aiCandidates.map((row) => updateScreeningAiEnrichment(runId, row.symbol, { ai_status: row.ai_status, ai_enrichment: row.ai_enrichment, ai_source: row.ai_source, ai_requested_at: row.ai_requested_at, ai_completed_at: row.ai_completed_at, ai_error: row.ai_error, news_enrichment: row.news_enrichment }).catch(() => errors.push({ symbol: row.symbol, error: 'AI enrichment persistence failed' }))));
  const enrichmentStatus = !aiCandidates.length ? 'not_started' : aiCompleted === aiCandidates.length ? 'completed' : aiCompleted ? 'partial' : 'failed';
  await updateScreeningRun(runId, { quantitative_status: preErrors.size ? 'partial' : 'completed', enrichment_status: enrichmentStatus })
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
  const funnelSummary = deriveFunnelSummary(screeningResults);
  const reconciliationWarnings = validateFunnelSummary(funnelSummary);
  const quantitativePartial = errors.some((item) => !item.error.startsWith('AI')) || reconciliationWarnings.length > 0;
  const finalStatus: ScreeningRunStatus = quantitativePartial ? 'partial' : 'completed';
  const completedAt = new Date().toISOString();
  const pointInTimeWarnings = quantitativeCandidates.flatMap(({ result }) => result.sourceProvenance.filter((source) => source.temporalValidity !== 'valid').map((source) => ({ symbol: result.symbol, sourceType: source.dataType, status: source.temporalValidity })));
  await updateScreeningRun(runId, { status: finalStatus, quantitative_status: quantitativePartial ? 'partial' : 'completed', enrichment_status: enrichmentStatus === 'not_started' ? 'skipped' : enrichmentStatus, completed_at: completedAt, point_in_time_status: pointInTimeWarnings.length ? 'partial' : 'valid', point_in_time_warnings: pointInTimeWarnings, summary: { ...funnelSummary, unifiedMatched: unified.results.filter((row) => row.matched_strategies.length > 0).length, closingPriority: unified.top_priority_candidates.length, pointInTimeValid: quantitativeCandidates.flatMap(({ result }) => result.sourceProvenance).filter((source) => source.temporalValidity === 'valid').length, pointInTimeInvalid: pointInTimeWarnings.length, backtestEligible: screeningResults.filter((row) => (row as ScreeningResult & Record<string, unknown>).backtest_eligible === true).length, backtestIneligible: screeningResults.filter((row) => (row as ScreeningResult & Record<string, unknown>).backtest_eligible !== true).length }, error_summary: [...errors.map((item) => ({ symbol: item.symbol, ...safeProcessingError(item.error, 'UNKNOWN_PROCESSING_ERROR', item.error.startsWith('AI') ? 'ai_enrichment' : 'quantitative_analysis') })), ...reconciliationWarnings.map((safe_message) => ({ code: 'PERSISTENCE_FAILED', stage: 'persisted', retryable: false, safe_message }))] });
  await appendScreeningRunEvents([{ run_id: runId, symbol: null, stage: 'completed', event_type: 'run_completed', status: finalStatus, metadata: { warnings: reconciliationWarnings }, idempotency_key: 'run_completed', occurred_at: completedAt }]);
  return {
    ...identity, strategyId, strategySupport, date: analysisDate, analysisDate, runId, run: { ...identity, strategy_support: strategySupport, information_cutoff_at: acquisitionCutoff, id: runId, analysisDate, status: finalStatus, quantitativeStatus: quantitativePartial ? 'partial' : 'completed', enrichmentStatus, startedAt, completedAt }, quantitativeStatus: quantitativePartial ? 'partial' : 'completed', enrichmentStatus, ...contract, summary: funnelSummary,
    rankings: saved,
    alertsCreated: alerts.length,
    bootstrapped,
    universeSource,
    marketRegime,
    outcomeEvaluation,
    progress: { universe: universe.length, preScreened: preResults.filter((row) => row.status === 'fulfilled').length, candidates: candidates.length, analyzed: deepResults.filter((row) => row.status === 'fulfilled').length, quantitativeSnapshots: quantitativeSnapshots.length, aiRequested: aiCandidates.length, aiCompleted, aiReused, errors: errors.map(item => ({ symbol: item.symbol, error: safeProcessingError(item.error, 'UNKNOWN_PROCESSING_ERROR', 'quantitative_analysis').safe_message })) } satisfies ScreenerProgress,
  };
  } catch (error) {
    const safe = safeProcessingError(error, 'UNKNOWN_PROCESSING_ERROR', 'universe');
    await failPendingScreeningRunItems(runId, safe).catch(() => undefined);
    await updateScreeningRun(runId, { status: 'failed', quantitative_status: 'failed', enrichment_status: 'skipped', completed_at: new Date().toISOString(), error_summary: [safe] }).catch(() => undefined);
    await appendScreeningRunEvents([{ run_id: runId, symbol: null, stage: safe.stage, event_type: 'run_failed', status: 'failed', metadata: safe, idempotency_key: 'run_failed', occurred_at: safe.occurred_at }]).catch(() => undefined);
    if (isScreeningUpdateRequired(error)) throw new ScreeningUpdateRequiredError();
    throw new Error(safe.safe_message);
  }
}
