import type {
  AnalysisComponent,
  AnalysisMetric,
  BrokerSummaryData,
  ComprehensiveAnalysis,
  KeyStatsData,
  OrderbookSnapshot,
} from './types';
import type { AiStoryScoring } from './types';
import type { HistoricalSummaryItem } from './stockbit';
import { calculateHistoricalFeatures, calculateMarketRegime } from './market-regime';
import { calculateWilderAtr } from './risk-management';
import { ANALYSIS_QUALITY_VERSION, buildAnalysisQuality, calculateComponentCoverage, calculateFreshness, normalizeComponentDirection } from './analysis-quality';
import type { FreshnessSource } from './types';
import { assessBrokerPersistence, assessExecution, sectorFamily, sectorRelativeMetric, type PeerObservation } from './screener-factors';
import { ACTIVE_STRATEGY_PROFILE, BROKER_FLOW_POLICY, EXECUTION_POLICY, SECTOR_PEER_POLICY } from './screener-factor-config';

const clamp = (value: number, min = 0, max = 100) => Math.min(max, Math.max(min, value));
const finite = (value: number) => Number.isFinite(value) ? value : 0;

function metric(
  key: string,
  label: string,
  value: number | string | null,
  signal: AnalysisMetric['signal'],
  description: string,
  unit?: string,
): AnalysisMetric {
  return { key, label, value, signal, description, unit };
}

interface BrokerHistoryRow { from_date: string; bandar?: string; barang_bandar?: number; rata_rata_bandar?: number; harga?: number }

function brokerFlowComponent(summary?: BrokerSummaryData, history: BrokerHistoryRow[] = []): AnalysisComponent {
  const weight = 25;
  if (!summary) return { key: 'brokerFlow', label: 'Broker Flow', weight, score: null, available: false, metrics: [] };
  const detector = summary.detector;
  const concentration = finite(Number(detector.top3.percent));
  const breadth = detector.total_buyer + detector.total_seller > 0
    ? detector.total_buyer / (detector.total_buyer + detector.total_seller)
    : 0.5;
  const persistence = assessBrokerPersistence(history.map(row => ({ date: row.from_date, broker: row.bandar, netValue: row.barang_bandar, averagePrice: row.rata_rata_bandar })));
  const concentrationRisk = concentration >= BROKER_FLOW_POLICY.extremeTop3ConcentrationPercent;
  const score = persistence.available ? clamp((persistence.score ?? 0) * .8 + breadth * 20 - (concentrationRisk ? 10 : 0)) : null;

  return {
    key: 'brokerFlow', label: 'Broker Persistence', weight, score: score === null ? null : Math.round(score), available: score !== null,
    role: 'ranking_factor', horizon: 'swing', sampleSize: persistence.sampleSize, methodologyVersion: persistence.methodologyVersion,
    warnings: [...persistence.warnings, ...(concentrationRisk ? ['Konsentrasi top-3 ekstrem meningkatkan risiko exit.'] : [])],
    metrics: [
      metric('accdist', 'Label Snapshot (Informasional)', detector.broker_accdist || '-', 'neutral', 'Label provider tidak digunakan untuk menentukan skor.'),
      metric('top3Concentration', 'Konsentrasi Top 3', concentration, concentrationRisk ? 'negative' : 'neutral', 'Konsentrasi ekstrem adalah risiko likuiditas, bukan bukti smart money.', '%'),
      metric('buyerBreadth', 'Breadth Buyer', Math.round(breadth * 1000) / 10, breadth >= 0.55 ? 'positive' : breadth <= 0.45 ? 'negative' : 'neutral', 'Perbandingan jumlah buyer terhadap seluruh broker aktif.', '%'),
      metric('persistence', 'Sesi Akumulasi 10 Sesi', persistence.accumulationSessions.d10, persistence.available ? 'neutral' : 'unavailable', 'Jumlah sesi dengan net accumulation setelah sort dan dedup tanggal.', 'sesi'),
      metric('brokerPersistence', 'Persistensi Broker', persistence.persistence, persistence.persistence === null ? 'unavailable' : persistence.persistence >= 60 ? 'positive' : 'neutral', `Sample ${persistence.sampleSize}; missing ${persistence.missingSessions} sesi.`, '%'),
    ],
  };
}

function liquidityComponent(orderbook: OrderbookSnapshot | undefined, lastPrice: number, history: HistoricalSummaryItem[], observedAt?: string | null, now?: Date, ara?: number | null, arb?: number | null): AnalysisComponent {
  const weight = 10;
  if (!orderbook || lastPrice <= 0) {
    return { key: 'liquidity', label: 'Likuiditas & Orderbook', weight, score: null, available: false, metrics: [] };
  }
  const execution = assessExecution({ orderbook, history, lastPrice, observedAt, now, ara, arb });
  const reference = execution.scenarios.find(x => x.notional === 50_000_000) ?? execution.scenarios[0];

  return {
    key: 'liquidity', label: 'Kualitas Eksekusi', weight, score: execution.score, available: execution.available,
    role: EXECUTION_POLICY.role, horizon: EXECUTION_POLICY.horizon, methodologyVersion: execution.methodologyVersion, execution, warnings: execution.warnings,
    metrics: [
      metric('spread', 'Bid–Ask Spread', execution.spreadPercent, execution.spreadPercent === null ? 'unavailable' : execution.spreadPercent <= .5 ? 'positive' : execution.spreadPercent >= 1.5 ? 'negative' : 'neutral', 'Biaya eksekusi; locked/crossed/limit book tidak dianggap normal.', '%'),
      metric('nearImbalance', 'Near-touch Imbalance (Informasional)', execution.nearTouchImbalancePercent, execution.nearTouchImbalancePercent === null ? 'unavailable' : 'neutral', 'Konteks snapshot saja; kontribusi directional = 0.', '%'),
      metric('buySlippage', 'Slippage Beli Skenario Rp50 jt', reference?.estimatedBuySlippagePercent ?? null, reference?.estimatedBuySlippagePercent === null ? 'unavailable' : 'neutral', 'Skenario referensi, bukan rekomendasi personal.', '%'),
      metric('sellSlippage', 'Slippage Jual Skenario Rp50 jt', reference?.estimatedSellSlippagePercent ?? null, reference?.estimatedSellSlippagePercent === null ? 'unavailable' : 'neutral', 'Exit feasibility dihitung terpisah.', '%'),
      metric('medianDailyValue20d', 'Median Nilai Transaksi 20D', execution.medianDailyValue20d, execution.medianDailyValue20d === null ? 'unavailable' : 'neutral', 'Median mengurangi pengaruh hari abnormal.', 'Rp'),
    ],
  };
}

function technicalComponent(history: HistoricalSummaryItem[]): AnalysisComponent {
  const weight = 20;
  const rows = [...history].filter((x) => x.close > 0).sort((a, b) => a.date.localeCompare(b.date));
  if (rows.length < 5) return { key: 'technical', label: 'Tren & Risiko', weight, score: null, available: false, metrics: [] };
  const latest = rows.at(-1)!;
  const historicalFeatures = calculateHistoricalFeatures(rows);
  const r5 = historicalFeatures.return5d;
  const r20 = historicalFeatures.return20d;
  const window20 = rows.slice(-20);
  const sma20 = historicalFeatures.sma20 ?? window20.reduce((sum, x) => sum + x.close, 0) / window20.length;
  const atrResult = calculateWilderAtr(rows, latest.close);
  const atrPct = atrResult?.atrPercent ?? 0;
  const volumes = window20.map((x) => x.volume).filter((x) => x > 0);
  const averageVolume = volumes.length ? volumes.reduce((a, b) => a + b, 0) / volumes.length : 0;
  const volumeRatio = historicalFeatures.relativeVolume ?? (averageVolume > 0 ? latest.volume / averageVolume : 1);
  const netForeign = window20.reduce((sum, x) => sum + finite(x.net_foreign), 0);
  let score = 50;
  if (r5 !== null) score += clamp(r5, -10, 10) * 1.2;
  if (r20 !== null) score += clamp(r20, -20, 20) * 0.6;
  score += latest.close >= sma20 ? 8 : -8;
  score -= Math.max(0, atrPct - 5) * 2;
  if (volumeRatio >= 1.2 && (r5 ?? 0) > 0) score += 5;

  return {
    key: 'technical', label: 'Tren & Risiko', weight, score: Math.round(clamp(score)), available: true,
    metrics: [
      metric('return5d', 'Return 5 Hari', r5 === null ? null : Math.round(r5 * 10) / 10, r5 === null ? 'unavailable' : r5 > 2 ? 'positive' : r5 < -2 ? 'negative' : 'neutral', 'Momentum harga jangka pendek.', '%'),
      metric('return20d', 'Return 20 Hari', r20 === null ? null : Math.round(r20 * 10) / 10, r20 === null ? 'unavailable' : r20 > 5 ? 'positive' : r20 < -5 ? 'negative' : 'neutral', 'Momentum harga sekitar satu bulan.', '%'),
      metric('sma20', 'Posisi vs MA20', Math.round(((latest.close / sma20) - 1) * 1000) / 10, latest.close >= sma20 ? 'positive' : 'negative', 'Jarak harga terakhir terhadap rata-rata 20 sesi.', '%'),
      metric('atr', 'ATR 14 (Wilder)', atrResult === null ? null : Math.round(atrPct * 10) / 10, atrResult === null ? 'unavailable' : atrPct <= 4 ? 'positive' : atrPct >= 7 ? 'negative' : 'neutral', 'ATR Wilder 14 sesi terhadap harga referensi.', '%'),
      metric('atrNominal', 'ATR Nominal', atrResult === null ? null : Math.round(atrResult.atr * 100) / 100, atrResult === null ? 'unavailable' : 'neutral', 'ATR Wilder dalam satuan harga.', 'Rp'),
      metric('volumeRatio', 'Relative Volume', Math.round(volumeRatio * 100) / 100, volumeRatio >= 1.2 ? 'positive' : volumeRatio < 0.6 ? 'negative' : 'neutral', 'Volume terakhir dibanding rata-rata 20 sesi.', 'x'),
      metric('netForeign20d', 'Net Foreign 20 Hari', Math.round(netForeign), netForeign > 0 ? 'positive' : netForeign < 0 ? 'negative' : 'neutral', 'Akumulasi net foreign pada data historis.', 'share'),
    ],
  };
}

const parseValue = (raw: string) => {
  const cleaned = raw.replace(/,/g, '').replace(/%/g, '').trim();
  const value = Number.parseFloat(cleaned.replace(/[^0-9.+-]/g, ''));
  return Number.isFinite(value) ? value : null;
};

function findStat(data: KeyStatsData, patterns: RegExp[]) {
  const items = Object.values(data).filter((value): value is KeyStatsData[keyof Omit<KeyStatsData, 'warning'>] => Array.isArray(value)).flat();
  const found = items.find((item) => patterns.some((pattern) => pattern.test(item.name.toLowerCase())));
  return found ? { name: found.name, value: parseValue(found.value), raw: found.value } : null;
}

function fundamentalComponents(data?: KeyStatsData, context: { symbol?: string; sector?: string | null; subsector?: string | null; peers?: PeerObservation[]; cutoff?: string } = {}): AnalysisComponent[] {
  const unavailable = (key: 'fundamental' | 'valuation', label: string, weight: number): AnalysisComponent => ({ key, label, weight, score: null, available: false, metrics: [] });
  if (!data) return [unavailable('fundamental', 'Fundamental', 20), unavailable('valuation', 'Valuasi', 10)];
  const roe = findStat(data, [/return on equity/, /^roe/]);
  const margin = findStat(data, [/net profit margin/, /net margin/]);
  const debt = findStat(data, [/debt.*equity/, /^der/]);
  const revenueGrowth = findStat(data, [/revenue growth/, /sales growth/]);
  const pe = findStat(data, [/price.*earnings/, /^p\/e/, /^per/]);
  const pbv = findStat(data, [/price.*book/, /^p\/b/, /^pbv/]);
  const peers = context.peers ?? [], cutoff = context.cutoff ?? new Date(0).toISOString();
  const relative = (name: 'roe'|'netMargin'|'revenueGrowth'|'debtToEquity'|'per'|'pbv', value: number | null | undefined, lower = false) => sectorRelativeMetric({ symbol: context.symbol ?? '', metric: name, value: value ?? null, sector: context.sector, subsector: context.subsector, compatibleIndustry: sectorFamily(context.sector), cutoff, peers, lowerIsBetter: lower });
  const roeRel = relative('roe', roe?.value), marginRel = relative('netMargin', margin?.value), growthRel = relative('revenueGrowth', revenueGrowth?.value);
  // DER is deliberately not interpreted for financials; banks require a
  // capital-quality metric (CAR/NPL) that this feed does not currently expose.
  const debtRel = sectorFamily(context.sector) === 'financials' ? null : relative('debtToEquity', debt?.value, true);
  const qualityScores = [roeRel, marginRel, growthRel, debtRel].filter((x): x is NonNullable<typeof x> => Boolean(x?.available));
  const fScore = qualityScores.length >= 2 ? qualityScores.reduce((s,x)=>s+(x.score ?? 0),0)/qualityScores.length : null;
  const fundamental: AnalysisComponent = {
    key: 'fundamental', label: 'Kualitas Perusahaan (Sector-relative)', weight: 20, score: fScore === null ? null : Math.round(fScore), available: fScore !== null,
    role: 'risk_modifier', horizon: 'context_only', sampleSize: qualityScores.length ? Math.min(...qualityScores.map(x=>x.peerSampleSize)) : 0, benchmarkScope: qualityScores[0]?.benchmarkScope ?? null,
    methodologyVersion: SECTOR_PEER_POLICY.version, warnings: [...qualityScores.flatMap(x=>x.warnings), ...(sectorFamily(context.sector)==='financials' && debt ? ['DER bank tidak dinilai dengan interpretasi perusahaan non-keuangan.'] : [])],
    metrics: [roe, margin, debt, revenueGrowth].filter(Boolean).map((x) => metric(x!.name, x!.name, x!.raw, 'neutral', 'Raw value; skor hanya berasal dari peer point-in-time yang memenuhi minimum sample.')),
  };
  const perRel = relative('per', pe?.value, true), pbvRel = relative('pbv', pbv?.value, true), valuationScores = [perRel, pbvRel].filter(x=>x.available);
  const vScore = valuationScores.length >= 1 ? valuationScores.reduce((s,x)=>s+(x.score ?? 0),0)/valuationScores.length : null;
  const valuation: AnalysisComponent = {
    key: 'valuation', label: 'Valuasi Sector-relative', weight: 10, score: vScore === null ? null : Math.round(vScore), available: vScore !== null,
    role: 'informational', horizon: 'context_only', sampleSize: valuationScores.length ? Math.min(...valuationScores.map(x=>x.peerSampleSize)) : 0, benchmarkScope: valuationScores[0]?.benchmarkScope ?? null,
    methodologyVersion: SECTOR_PEER_POLICY.version, warnings: [...perRel.warnings, ...pbvRel.warnings],
    metrics: [pe, pbv].filter(Boolean).map((x) => metric(x!.name, x!.name, x!.raw, x === pe && (x!.value ?? 1) <= 0 ? 'negative' : 'neutral', x === pe && (x!.value ?? 1) <= 0 ? 'PER negatif menandakan earnings negatif dan tidak dianggap murah.' : 'Raw value; konteks beli tidak diturunkan dari valuasi saja.')),
  };
  return [fundamental, valuation];
}

export function buildComprehensiveAnalysis(input: {
  brokerSummary?: BrokerSummaryData;
  orderbook?: OrderbookSnapshot;
  lastPrice: number;
  history?: HistoricalSummaryItem[];
  keyStats?: KeyStatsData;
  brokerHistory?: BrokerHistoryRow[];
  benchmarkHistory?: HistoricalSummaryItem[];
  catalyst?: { matriks_story?: Array<{ potensi_dampak_harga?: string }>; kesimpulan?: string; swot_analysis?: { ai_scoring?: AiStoryScoring }; created_at?: string } | null;
  now?: Date;
  sourceTimestamps?: Partial<Record<FreshnessSource, string | null>>;
  sector?: string | null;
  subsector?: string | null;
  peerSnapshot?: PeerObservation[];
  informationCutoffAt?: string;
  ara?: number | null;
  arb?: number | null;
}): ComprehensiveAnalysis {
  const now = input.now ?? new Date();
  const regime = calculateMarketRegime(input.benchmarkHistory ?? []);
  const aiScoring = input.catalyst?.swot_analysis?.ai_scoring;
  const catalystComponent: AnalysisComponent = aiScoring ? {
    key: 'catalyst', label: 'Katalis & Kepemilikan', weight: 10,
    score: Math.round(clamp(aiScoring.score)), available: true,
    metrics: [
      metric('storySentiment', 'Sentimen AI', aiScoring.sentiment === 'positive' ? 'Positif' : aiScoring.sentiment === 'negative' ? 'Negatif' : 'Netral', aiScoring.sentiment === 'positive' ? 'positive' : aiScoring.sentiment === 'negative' ? 'negative' : 'neutral', aiScoring.rationale),
      metric('aiStoryScore', 'AI Story Score', Math.round(clamp(aiScoring.score)), aiScoring.score >= 60 ? 'positive' : aiScoring.score < 45 ? 'negative' : 'neutral', aiScoring.rationale, '/100'),
      metric('aiStoryConfidence', 'AI Confidence', Math.round(clamp(aiScoring.confidence)), aiScoring.confidence >= 70 ? 'positive' : aiScoring.confidence < 50 ? 'negative' : 'neutral', 'Keyakinan AI berdasarkan kecukupan dan konsistensi sumber berita.', '%'),
      metric('ownership', 'Perubahan Kepemilikan', null, 'unavailable', 'Feed ownership terstruktur belum tersedia.'),
    ],
  } : { key: 'catalyst', label: 'Katalis & Kepemilikan', weight: 10, score: null, available: false, metrics: [] };
  const marketComponent: AnalysisComponent = regime.label !== 'unavailable' ? {
    key: 'marketRegime', label: 'Market Regime IHSG', weight: 5, score: regime.score, available: true,
    metrics: [
      metric('marketRegimeLabel', 'Regime', regime.label, regime.label === 'bullish' ? 'positive' : regime.label === 'bearish' ? 'negative' : 'neutral', regime.reasons.join(' ')),
      metric('marketReturn5d', 'Return IHSG 5D', regime.features.return5d, regime.features.return5d! > 0 ? 'positive' : 'negative', 'Return penutupan IHSG selama lima sesi.', '%'),
      metric('marketReturn20d', 'Return IHSG 20D', regime.features.return20d, regime.features.return20d! > 0 ? 'positive' : 'negative', 'Return penutupan IHSG selama 20 sesi.', '%'),
      metric('marketSma20Trend', 'Tren SMA20 IHSG', regime.features.sma20Trend, regime.features.sma20Trend === null ? 'unavailable' : regime.features.sma20Trend > 0 ? 'positive' : 'negative', 'Perubahan SMA20 selama lima sesi.', '%'),
    ],
  } : { key: 'marketRegime', label: 'Market Regime IHSG', weight: 5, score: null, available: false, metrics: [metric('marketRegimeLabel', 'Regime', 'unavailable', 'unavailable', regime.reasons.join(' '))] };
  const rawComponents: AnalysisComponent[] = [
    brokerFlowComponent(input.brokerSummary, input.brokerHistory),
    technicalComponent(input.history ?? []),
    ...fundamentalComponents(input.keyStats, { sector: input.sector, subsector: input.subsector, peers: input.peerSnapshot, cutoff: input.informationCutoffAt ?? now.toISOString() }),
    liquidityComponent(input.orderbook, input.lastPrice, input.history ?? [], input.sourceTimestamps?.orderbook ?? input.orderbook?.observedAt ?? now.toISOString(), now, input.ara, input.arb),
    catalystComponent,
    marketComponent,
  ];
  const requiredByComponent: Record<AnalysisComponent['key'], string[]> = {
    brokerFlow: ['accdist', 'top3Concentration', 'buyerBreadth', 'persistence'],
    technical: ['return5d', 'return20d', 'sma20', 'atr', 'volumeRatio'],
    fundamental: ['roe', 'margin', 'debt', 'growth'],
    valuation: ['per', 'pbv'],
    liquidity: ['bid', 'offer', 'spread', 'depth', 'slippage'],
    catalyst: ['status', 'freshness', 'sources', 'structuredScore'],
    marketRegime: ['return5d', 'return20d', 'sma20Trend', 'history'],
  };
  const freshnessSourceByComponent: Record<AnalysisComponent['key'], FreshnessSource> = { brokerFlow: 'brokerSummary', technical: 'historicalPrice', fundamental: 'fundamental', valuation: 'fundamental', liquidity: 'orderbook', catalyst: 'catalyst', marketRegime: 'benchmark' };
  const latestHistory = input.history?.filter((row) => row.date).map((row) => row.date).sort().at(-1);
  const latestBenchmark = input.benchmarkHistory?.filter((row) => row.date).map((row) => row.date).sort().at(-1);
  const inferredTimestamps: Partial<Record<FreshnessSource, string | null>> = { historicalPrice: latestHistory ? `${latestHistory}T16:00:00+07:00` : null, benchmark: latestBenchmark ? `${latestBenchmark}T16:00:00+07:00` : null, catalyst: input.catalyst?.created_at ?? null, ...input.sourceTimestamps };
  const components = rawComponents.map((component): AnalysisComponent => {
    const required = requiredByComponent[component.key];
    const metricAvailable = (key: string) => component.metrics.some((item) => item.key.toLowerCase().includes(key.toLowerCase()) && item.value !== null && item.signal !== 'unavailable');
    const values: Record<string, unknown> = {};
    for (const key of required) values[key] = metricAvailable(key) ? true : null;
    if (component.key === 'liquidity' && component.available) Object.assign(values, { bid: true, offer: true, depth: true });
    if (component.key === 'catalyst' && component.available) Object.assign(values, { status: true, structuredScore: true, freshness: inferredTimestamps.catalyst ?? null, sources: input.catalyst?.matriks_story?.length ? true : null });
    if (component.key === 'marketRegime' && component.available) Object.assign(values, { return5d: regime.features.return5d, return20d: regime.features.return20d, sma20Trend: regime.features.sma20Trend, history: regime.features.sessions >= 20 ? true : null });
    if (component.key === 'fundamental' || component.key === 'valuation') component.metrics.forEach((item, index) => { values[required[index] ?? item.key] = item.value; });
    const coverage = calculateComponentCoverage(required, values);
    const direction = normalizeComponentDirection(component.score, component.key === 'marketRegime' && regime.label === 'bearish');
    const freshness = calculateFreshness(freshnessSourceByComponent[component.key], inferredTimestamps[freshnessSourceByComponent[component.key]], now);
    return { ...component, ...coverage, ...direction, freshness, reliability: { score: coverage.coverage, issues: coverage.missingMetrics.map((key) => `${key} tidak tersedia`), fallbackUsed: false, sampleSizes: {} } };
  });
  const available = components.filter((x) => x.available && x.score !== null);
  const availableWeight = available.reduce((sum, x) => sum + x.weight, 0);
  const score = availableWeight > 0
    ? Math.round(available.reduce((sum, x) => sum + (x.score ?? 0) * x.weight, 0) / availableWeight)
    : 50;
  const freshnessSources = (['orderbook', 'marketPrice', 'brokerSummary', 'historicalPrice', 'fundamental', 'catalyst', 'benchmark'] as FreshnessSource[]).map((source) => calculateFreshness(source, inferredTimestamps[source], now));
  const quality = buildAnalysisQuality({ components, now, freshness: freshnessSources, historySamples: input.history?.length ?? 0, brokerHistorySamples: input.brokerHistory?.length ?? 0, catalystConfidence: aiScoring?.confidence ?? null });
  const dataCompleteness = quality.completeness;
  const confidence = quality.confidence;
  const agreement = quality.agreement.score ?? 0;
  const label: ComprehensiveAnalysis['label'] = score >= 75 ? 'Kuat' : score >= 60 ? 'Positif' : score >= 45 ? 'Netral' : score >= 30 ? 'Hati-hati' : 'Lemah';
  const missing = components.filter((x) => !x.available).map((x) => x.label);
  return {
    score, dataCompleteness, confidence, agreement, quality, methodologyVersion: `${ANALYSIS_QUALITY_VERSION}+${ACTIVE_STRATEGY_PROFILE.version}`, label, horizon: 'Swing 5–20 hari', generatedAt: now.toISOString(), components,
    warnings: [...(missing.length ? [`Komponen belum tersedia dan tidak dihitung: ${missing.join(', ')}.`] : []), ...quality.warnings],
  };
}
