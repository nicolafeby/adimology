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
  const text = `${detector.broker_accdist} ${detector.top3.accdist}`.toLowerCase();
  const accumulation = /acc|akum|buy/.test(text);
  const distribution = /dist|distrib|sell/.test(text);
  const concentration = finite(Number(detector.top3.percent));
  const breadth = detector.total_buyer + detector.total_seller > 0
    ? detector.total_buyer / (detector.total_buyer + detector.total_seller)
    : 0.5;
  let score = 50 + (accumulation ? 20 : 0) - (distribution ? 20 : 0);
  score += clamp(concentration, 0, 50) * 0.2;
  score += (breadth - 0.5) * 30;
  const recent = history.slice(0, 10);
  const dominantBroker = recent[0]?.bandar;
  const persistence = dominantBroker && recent.length
    ? recent.filter((row) => row.bandar === dominantBroker).length / recent.length
    : null;
  if (persistence !== null) score += (persistence - 0.3) * 15;

  return {
    key: 'brokerFlow', label: 'Broker Flow', weight, score: Math.round(clamp(score)), available: true,
    metrics: [
      metric('accdist', 'Akumulasi/Distribusi', detector.broker_accdist || '-', accumulation ? 'positive' : distribution ? 'negative' : 'neutral', 'Sinyal agregat dari broker detector.'),
      metric('top3Concentration', 'Konsentrasi Top 3', concentration, concentration >= 20 ? 'positive' : 'neutral', 'Porsi aktivitas tiga broker teratas.', '%'),
      metric('buyerBreadth', 'Breadth Buyer', Math.round(breadth * 1000) / 10, breadth >= 0.55 ? 'positive' : breadth <= 0.45 ? 'negative' : 'neutral', 'Perbandingan jumlah buyer terhadap seluruh broker aktif.', '%'),
      metric('persistence', 'Persistensi Broker 10 Hari', persistence === null ? null : Math.round(persistence * 100), persistence === null ? 'unavailable' : persistence >= 0.5 ? 'positive' : 'neutral', 'Frekuensi broker dominan terbaru kembali menjadi top buyer.', '%'),
    ],
  };
}

function liquidityComponent(orderbook: OrderbookSnapshot | undefined, lastPrice: number): AnalysisComponent {
  const weight = 10;
  if (!orderbook || orderbook.bid.length === 0 || orderbook.offer.length === 0 || lastPrice <= 0) {
    return { key: 'liquidity', label: 'Likuiditas & Orderbook', weight, score: null, available: false, metrics: [] };
  }
  const bids = [...orderbook.bid].sort((a, b) => b.price - a.price);
  const offers = [...orderbook.offer].sort((a, b) => a.price - b.price);
  const bestBid = bids[0].price;
  const bestOffer = offers[0].price;
  const mid = (bestBid + bestOffer) / 2;
  const spreadPct = mid > 0 ? ((bestOffer - bestBid) / mid) * 100 : 0;
  const nearBid = bids.filter((x) => x.price >= bestBid * 0.99).reduce((sum, x) => sum + x.volume, 0);
  const nearOffer = offers.filter((x) => x.price <= bestOffer * 1.01).reduce((sum, x) => sum + x.volume, 0);
  const imbalance = nearBid + nearOffer > 0 ? ((nearBid - nearOffer) / (nearBid + nearOffer)) * 100 : 0;

  const slippage = (levels: typeof bids, shares: number) => {
    let remaining = shares;
    let value = 0;
    for (const level of levels) {
      const filled = Math.min(remaining, level.volume);
      value += filled * level.price;
      remaining -= filled;
      if (remaining <= 0) break;
    }
    if (remaining > 0 || value <= 0) return null;
    const average = value / shares;
    return Math.abs((average - levels[0].price) / levels[0].price) * 100;
  };
  const buySlippage = slippage(offers, 10_000);
  let score = 55 - Math.min(spreadPct, 5) * 8 + clamp(imbalance, -50, 50) * 0.25;
  if (buySlippage !== null) score -= Math.min(buySlippage, 5) * 5;

  return {
    key: 'liquidity', label: 'Likuiditas & Orderbook', weight, score: Math.round(clamp(score)), available: true,
    metrics: [
      metric('spread', 'Bid–Ask Spread', Math.round(spreadPct * 100) / 100, spreadPct <= 0.5 ? 'positive' : spreadPct >= 1.5 ? 'negative' : 'neutral', 'Spread lebih kecil menandakan biaya eksekusi lebih rendah.', '%'),
      metric('nearImbalance', 'Near-touch Imbalance', Math.round(imbalance * 10) / 10, imbalance >= 15 ? 'positive' : imbalance <= -15 ? 'negative' : 'neutral', 'Keseimbangan depth dalam jarak 1% dari best bid/offer.', '%'),
      metric('buySlippage', 'Estimasi Slippage Beli 100 lot', buySlippage === null ? null : Math.round(buySlippage * 100) / 100, buySlippage === null ? 'unavailable' : buySlippage <= 0.5 ? 'positive' : buySlippage >= 1.5 ? 'negative' : 'neutral', 'Estimasi dampak harga untuk market buy 100 lot.', '%'),
    ],
  };
}

function technicalComponent(history: HistoricalSummaryItem[]): AnalysisComponent {
  const weight = 20;
  const rows = [...history].filter((x) => x.close > 0).sort((a, b) => a.date.localeCompare(b.date));
  if (rows.length < 5) return { key: 'technical', label: 'Tren & Risiko', weight, score: null, available: false, metrics: [] };
  const latest = rows.at(-1)!;
  const change = (days: number) => rows.length > days ? ((latest.close / rows[rows.length - 1 - days].close) - 1) * 100 : null;
  const r5 = change(5);
  const r20 = change(20);
  const window20 = rows.slice(-20);
  const sma20 = window20.reduce((sum, x) => sum + x.close, 0) / window20.length;
  const atrRows = rows.slice(-15);
  const ranges = atrRows.slice(1).map((x, i) => Math.max(x.high - x.low, Math.abs(x.high - atrRows[i].close), Math.abs(x.low - atrRows[i].close)));
  const atrPct = ranges.length ? (ranges.reduce((a, b) => a + b, 0) / ranges.length / latest.close) * 100 : 0;
  const volumes = window20.map((x) => x.volume).filter((x) => x > 0);
  const averageVolume = volumes.length ? volumes.reduce((a, b) => a + b, 0) / volumes.length : 0;
  const volumeRatio = averageVolume > 0 ? latest.volume / averageVolume : 1;
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
      metric('atr', 'ATR 14', Math.round(atrPct * 10) / 10, atrPct <= 4 ? 'positive' : atrPct >= 7 ? 'negative' : 'neutral', 'Estimasi volatilitas harian terhadap harga.', '%'),
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
  const items = Object.values(data).flat();
  const found = items.find((item) => patterns.some((pattern) => pattern.test(item.name.toLowerCase())));
  return found ? { name: found.name, value: parseValue(found.value), raw: found.value } : null;
}

function fundamentalComponents(data?: KeyStatsData): AnalysisComponent[] {
  const unavailable = (key: 'fundamental' | 'valuation', label: string, weight: number): AnalysisComponent => ({ key, label, weight, score: null, available: false, metrics: [] });
  if (!data) return [unavailable('fundamental', 'Fundamental', 20), unavailable('valuation', 'Valuasi', 10)];
  const roe = findStat(data, [/return on equity/, /^roe/]);
  const margin = findStat(data, [/net profit margin/, /net margin/]);
  const debt = findStat(data, [/debt.*equity/, /^der/]);
  const revenueGrowth = findStat(data, [/revenue growth/, /sales growth/]);
  const pe = findStat(data, [/price.*earnings/, /^p\/e/, /^per/]);
  const pbv = findStat(data, [/price.*book/, /^p\/b/, /^pbv/]);
  const fundamentalStats = [roe, margin, debt, revenueGrowth].filter(Boolean) as NonNullable<typeof roe>[];
  let fScore = 50;
  if (roe?.value !== null && roe) fScore += clamp(roe.value, -10, 30) * 0.6;
  if (margin?.value !== null && margin) fScore += clamp(margin.value, -10, 25) * 0.35;
  if (debt?.value !== null && debt) fScore -= Math.max(0, debt.value - 1) * 8;
  if (revenueGrowth?.value !== null && revenueGrowth) fScore += clamp(revenueGrowth.value, -20, 30) * 0.4;
  const fundamental = fundamentalStats.length ? {
    key: 'fundamental' as const, label: 'Fundamental', weight: 20, score: Math.round(clamp(fScore)), available: true,
    metrics: fundamentalStats.map((x) => metric(x.name, x.name, x.raw, 'neutral', 'Nilai terbaru dari Key Statistics Stockbit.')),
  } : unavailable('fundamental', 'Fundamental', 20);

  const valuationStats = [pe, pbv].filter(Boolean) as NonNullable<typeof pe>[];
  let vScore = 50;
  if (pe?.value !== null && pe) vScore += pe.value > 0 && pe.value <= 15 ? 12 : pe.value > 30 ? -12 : 0;
  if (pbv?.value !== null && pbv) vScore += pbv.value > 0 && pbv.value <= 2 ? 8 : pbv.value > 5 ? -8 : 0;
  const valuation = valuationStats.length ? {
    key: 'valuation' as const, label: 'Valuasi', weight: 10, score: Math.round(clamp(vScore)), available: true,
    metrics: valuationStats.map((x) => metric(x.name, x.name, x.raw, 'neutral', 'Valuasi absolut; perbandingan sektor tetap diperlukan.')),
  } : unavailable('valuation', 'Valuasi', 10);
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
}): ComprehensiveAnalysis {
  const benchmark = technicalComponent(input.benchmarkHistory ?? []);
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
  const marketComponent: AnalysisComponent = benchmark.available ? {
    ...benchmark, key: 'marketRegime', label: 'Market Regime', weight: 5,
  } : { key: 'marketRegime', label: 'Market Regime', weight: 5, score: null, available: false, metrics: [] };
  const components: AnalysisComponent[] = [
    brokerFlowComponent(input.brokerSummary, input.brokerHistory),
    technicalComponent(input.history ?? []),
    ...fundamentalComponents(input.keyStats),
    liquidityComponent(input.orderbook, input.lastPrice),
    catalystComponent,
    marketComponent,
  ];
  const available = components.filter((x) => x.available && x.score !== null);
  const availableWeight = available.reduce((sum, x) => sum + x.weight, 0);
  const score = availableWeight > 0
    ? Math.round(available.reduce((sum, x) => sum + (x.score ?? 0) * x.weight, 0) / availableWeight)
    : 50;
  const dataCompleteness = Math.round((availableWeight / components.reduce((sum, x) => sum + x.weight, 0)) * 100);
  const componentConfidence = (component: AnalysisComponent) => {
    if (component.key === 'catalyst' && aiScoring) return clamp(aiScoring.confidence);
    if (!component.metrics.length) return 0;
    const usableMetrics = component.metrics.filter((item) => item.signal !== 'unavailable' && item.value !== null).length;
    return (usableMetrics / component.metrics.length) * 100;
  };
  const confidence = availableWeight > 0
    ? Math.round(available.reduce((sum, component) => sum + componentConfidence(component) * component.weight, 0) / availableWeight)
    : 0;
  const agreement = available.length >= 2
    ? Math.round(clamp(100 - (available.reduce((sum, component) => sum + Math.abs((component.score ?? score) - score) * component.weight, 0) / availableWeight) * 2))
    : 0;
  const label: ComprehensiveAnalysis['label'] = score >= 75 ? 'Kuat' : score >= 60 ? 'Positif' : score >= 45 ? 'Netral' : score >= 30 ? 'Hati-hati' : 'Lemah';
  const missing = components.filter((x) => !x.available).map((x) => x.label);
  return {
    score, dataCompleteness, confidence, agreement, label, horizon: 'Swing 5–20 hari', generatedAt: new Date().toISOString(), components,
    warnings: missing.length ? [`Komponen belum tersedia dan tidak dihitung: ${missing.join(', ')}.`] : [],
  };
}
