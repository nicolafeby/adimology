import { getFraksi } from './calculations';
import type { ComprehensiveAnalysis, StockAnalysisResult, TradeDecision } from './types';

const roundDownToTick = (price: number) => {
  const tick = getFraksi(Math.max(1, price));
  return Math.max(tick, Math.floor(price / tick) * tick);
};

const roundUpToTick = (price: number) => {
  const tick = getFraksi(Math.max(1, price));
  return Math.max(tick, Math.ceil(price / tick) * tick);
};

function metricNumber(analysis: ComprehensiveAnalysis, key: string) {
  const value = analysis.components.flatMap((component) => component.metrics)
    .find((item) => item.key === key)?.value;
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** Builds a conservative swing plan from the existing multi-factor analysis. */
export function buildTradeDecision(result: StockAnalysisResult): TradeDecision | null {
  const analysis = result.comprehensiveAnalysis;
  const currentPrice = result.marketData.harga;
  const rawTarget = result.calculated.targetRealistis1;
  if (!analysis || !Number.isFinite(currentPrice) || currentPrice <= 0 || !Number.isFinite(rawTarget)) return null;

  const bestOffer = result.orderbook?.offer
    .filter((level) => level.price > 0)
    .reduce<number | null>((best, level) => best === null ? level.price : Math.min(best, level.price), null);
  const entryLow = roundDownToTick(currentPrice);
  const entryCeiling = Math.min(rawTarget, currentPrice * 1.01);
  const entryHigh = Math.max(entryLow, roundUpToTick(Math.min(bestOffer ?? currentPrice, entryCeiling)));
  const referenceEntry = (entryLow + entryHigh) / 2;

  const atrPct = metricNumber(analysis, 'atr');
  const stopDistancePct = Math.min(10, Math.max(3, (atrPct ?? 3) * 1.5));
  const stop = roundDownToTick(entryLow * (1 - stopDistancePct / 100));
  const target = roundDownToTick(rawTarget);
  const risk = referenceEntry - stop;
  const reward = target - referenceEntry;
  const riskReward = risk > 0 && reward > 0 ? Math.round((reward / risk) * 10) / 10 : null;

  const completeness = analysis.dataCompleteness ?? analysis.confidence;
  let verdict: TradeDecision['verdict'] = 'WAIT';
  if (analysis.score < 45 || target <= referenceEntry || (riskReward !== null && riskReward < 1)) verdict = 'AVOID';
  else if (analysis.score >= 60 && completeness >= 60 && (riskReward ?? 0) >= 1.5) verdict = 'ACTIONABLE';

  const verdictLabel = verdict === 'ACTIONABLE' ? 'Layak dipertimbangkan' : verdict === 'AVOID' ? 'Hindari setup' : 'Tunggu konfirmasi';
  const rationale = verdict === 'ACTIONABLE'
    ? `Skor ${analysis.score}/100, kelengkapan ${completeness}%, dan imbal hasil terhadap risiko memadai.`
    : verdict === 'AVOID'
      ? `Target atau profil risiko belum memberi margin yang layak pada harga sekarang.`
      : `Setup belum memenuhi seluruh ambang skor, kelengkapan data, dan risk–reward.`;

  return {
    verdict, verdictLabel, rationale, entryLow, entryHigh, stop, target, riskReward,
    invalidation: `Setup batal jika harga ditutup di bawah Rp ${stop.toLocaleString('id-ID')} atau skor multi-faktor turun di bawah 45.`,
  };
}
