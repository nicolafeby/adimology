'use client';
import { useState } from 'react';
import { buildTradeDecision } from '@/lib/decision';
import type { StockAnalysisResult, TradingDecision } from '@/lib/types';
const price = (v: number | null) => v === null ? '—' : `Rp ${v.toLocaleString('id-ID')}`;
const rr = (v: number | null) => v === null ? '—' : `1 : ${v.toFixed(2)}`;
const kind = { price: 'Harga', signal: 'Sinyal', time: 'Waktu' } as const;
const rupiahInput = (value?: number) => value === undefined ? '' : `Rp ${value.toLocaleString('id-ID')}`;
const parseRupiahInput = (value: string) => {
  const digits = value.replace(/\D/g, '');
  return digits ? Number(digits) : undefined;
};

export function DecisionCardView({ decision, symbol, currentPrice, allowSizing = false }: { decision: TradingDecision; symbol: string; currentPrice: number; allowSizing?: boolean }) {
  const displayedCurrentPrice = typeof decision.inputs.currentPrice === 'number' ? decision.inputs.currentPrice : currentPrice;
  return <section className={`decision-card decision-${decision.verdict}`}>
    <header className="decision-header"><div><span>Decision Card · Swing 5–20 hari</span><h3>{symbol.toUpperCase()}</h3></div><div className="decision-verdict"><small>Keputusan</small><strong>{decision.verdictLabel}</strong></div></header>
    {decision.freshness.refreshRequired && <p className="decision-refresh">Refresh required · data eksekusi sudah kedaluwarsa</p>}
    {decision.freshness.executionDataStatus === 'historical_unavailable' && <p className="decision-historical">Snapshot historis · orderbook live tidak diterapkan pada tanggal ini</p>}
    <p className="decision-rationale">{decision.reasons.join(' ')}</p>
    <div className="decision-levels">
      <div><span>Zona entry</span><strong>{price(decision.entry.lower)} – {price(decision.entry.upper)}</strong><small>Referensi {price(decision.entry.reference)} · kini {price(displayedCurrentPrice)}</small></div>
      <div><span>Stop-loss</span><strong className="decision-negative">{price(decision.stop.price)}</strong><small>Risiko {decision.stop.riskPercent === null ? '—' : `${decision.stop.riskPercent.toFixed(2)}%`}</small></div>
      <div><span>Target 1</span><strong className="decision-positive">{price(decision.targets.target1)}</strong><small>{decision.targets.rewardPercent1 ?? '—'}% · RR {rr(decision.riskReward.target1)}</small></div>
      <div><span>Target 2</span><strong className="decision-positive">{price(decision.targets.target2)}</strong><small>{decision.targets.rewardPercent2 ?? '—'}% · RR {rr(decision.riskReward.target2)}</small></div>
    </div>
    <div className="decision-meta"><span>Valid {decision.validUntil.tradingSessions} sesi</span><span>Confidence {decision.confidence}%</span><span>Data {decision.dataCompleteness}%</span><span>Umur {decision.freshness.dataAgeMinutes ?? '—'} menit</span></div>
    <div className="decision-invalidation"><span>Invalid jika</span><ul>{decision.invalidations.map((x) => <li key={`${x.kind}-${x.condition}`}><strong>{kind[x.kind]}:</strong> {x.condition}</li>)}</ul></div>
    {decision.warnings.length > 0 && <div className="decision-warnings"><strong>Peringatan</strong><ul>{decision.warnings.map((x) => <li key={x}>{x}</li>)}</ul></div>}
    {allowSizing && decision.positionSizing && <div className="decision-sizing-result"><div><span>Ukuran rekomendasi</span><strong>{decision.positionSizing.recommendedLots.toLocaleString('id-ID')} lot ({decision.positionSizing.recommendedShares.toLocaleString('id-ID')} saham)</strong></div><div><span>Risk budget</span><strong>{price(decision.positionSizing.riskBudget)}</strong></div><div><span>Estimasi rugi + fee</span><strong>{price(decision.positionSizing.estimatedLossAfterFees)}</strong></div><div><span>Alokasi modal</span><strong>{decision.positionSizing.capitalAllocationPercent.toFixed(2)}%</strong></div><div><span>Fee beli / jual@stop</span><strong>{price(decision.positionSizing.estimatedBuyFee)} / {price(decision.positionSizing.estimatedSellFeeAtStop)}</strong></div><small>Pembatas: {decision.positionSizing.limitingFactors.join(', ')}</small></div>}
    {allowSizing && !decision.positionSizing && <p className="decision-refresh">Lengkapi profil risiko dan available cash untuk menghitung jumlah lot.</p>}
    <p className="decision-disclaimer">Rencana berbasis data yang tersedia, bukan rekomendasi investasi atau jaminan hasil.</p>
  </section>;
}

export default function DecisionCard({ result }: { result: StockAnalysisResult }) {
  const [accountSize, setAccountSize] = useState<number | undefined>(1_000_000); const [availableCash, setAvailableCash] = useState<number | undefined>(1_000_000); const [riskPercent, setRiskPercent] = useState(1); const [allocation, setAllocation] = useState(20); const [atrMultiplier, setAtrMultiplier] = useState(1.5);
  const decision = buildTradeDecision(result, { accountSize, availableCash, riskPercent, maxAllocationPercent: allocation, atrMultiplier, buyFeePercent: 0.15, sellFeePercent: 0.25, liquidityPercentOfAdv: 1 });
  return <div><DecisionCardView decision={decision} symbol={result.input.emiten} currentPrice={result.marketData.harga} allowSizing /><div className="decision-sizing"><strong>Profil risiko opsional</strong><div className="decision-sizing-inputs"><label>Modal trading (Rp)<input type="text" inputMode="numeric" value={rupiahInput(accountSize)} placeholder="Wajib untuk sizing" onChange={(e) => setAccountSize(parseRupiahInput(e.target.value))} /></label><label>Available cash (Rp)<input type="text" inputMode="numeric" value={rupiahInput(availableCash)} placeholder="Wajib untuk sizing" onChange={(e) => setAvailableCash(parseRupiahInput(e.target.value))} /></label><label>Risiko maksimum (%)<input type="number" min="0" max="100" step="0.1" value={riskPercent} onChange={(e) => setRiskPercent(Number(e.target.value))} /></label><label>Alokasi maksimum (%)<input type="number" min="0" max="100" step="1" value={allocation} onChange={(e) => setAllocation(Number(e.target.value))} /></label><label>ATR multiplier<input type="number" min="0.1" step="0.1" value={atrMultiplier} onChange={(e) => setAtrMultiplier(Number(e.target.value))} /></label></div><small>Default yang dapat diubah: risiko 1%, alokasi 20%, ATR 1,5×, fee beli 0,15%, fee jual 0,25%, likuiditas 1% ADV. Nilai modal tidak diasumsikan atau disimpan.</small></div></div>;
}
