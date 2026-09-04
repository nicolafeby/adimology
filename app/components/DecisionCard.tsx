'use client';
import { useState } from 'react';
import { buildTradeDecision } from '@/lib/decision';
import type { StockAnalysisResult, TradingDecision } from '@/lib/types';
const price = (v: number | null) => v === null ? '—' : `Rp ${v.toLocaleString('id-ID')}`;
const rr = (v: number | null) => v === null ? '—' : `1 : ${v.toFixed(2)}`;
const kind = { price: 'Harga', signal: 'Sinyal', time: 'Waktu' } as const;

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
    {allowSizing && decision.positionSizing && <div className="decision-sizing-result"><div><span>Ukuran maksimum</span><strong>{decision.positionSizing.maximumLots.toLocaleString('id-ID')} lot</strong></div><div><span>Risk budget</span><strong>{price(decision.positionSizing.riskBudget)}</strong></div><div><span>Risiko posisi</span><strong>{price(decision.positionSizing.positionRisk)}</strong></div></div>}
    <p className="decision-disclaimer">Rencana berbasis data yang tersedia, bukan rekomendasi investasi atau jaminan hasil.</p>
  </section>;
}

export default function DecisionCard({ result }: { result: StockAnalysisResult }) {
  const [accountSize, setAccountSize] = useState<number>(); const [riskPercent, setRiskPercent] = useState<number>();
  const decision = buildTradeDecision(result, { accountSize, riskPercent });
  return <div><DecisionCardView decision={decision} symbol={result.input.emiten} currentPrice={result.marketData.harga} allowSizing /><div className="decision-sizing"><strong>Position sizing opsional</strong><div className="decision-sizing-inputs"><label>Modal trading (Rp)<input type="number" min="0" value={accountSize ?? ''} placeholder="Tidak diisi" onChange={(e) => setAccountSize(e.target.value ? Number(e.target.value) : undefined)} /></label><label>Risiko maksimum (%)<input type="number" min="0" max="100" step="0.1" value={riskPercent ?? ''} placeholder="Tidak diisi" onChange={(e) => setRiskPercent(e.target.value ? Number(e.target.value) : undefined)} /></label></div></div></div>;
}
