'use client';

import { useState } from 'react';
import { buildTradeDecision, DEFAULT_POSITION_SIZING } from '@/lib/decision';
import type { StockAnalysisResult } from '@/lib/types';

const price = (value: number) => `Rp ${value.toLocaleString('id-ID')}`;
const rupiahInput = (value: number) => Math.round(value).toLocaleString('id-ID');

export default function DecisionCard({ result }: { result: StockAnalysisResult }) {
  const [accountSize, setAccountSize] = useState(DEFAULT_POSITION_SIZING.accountSize);
  const [riskPercent, setRiskPercent] = useState(DEFAULT_POSITION_SIZING.riskPercent);
  const decision = buildTradeDecision(result, { accountSize, riskPercent });
  if (!decision) return null;

  return (
    <section className={`decision-card decision-${decision.verdict.toLowerCase()}`}>
      <header className="decision-header">
        <div><span>Decision Card · Swing 5–20 hari</span><h3>{result.input.emiten.toUpperCase()}</h3></div>
        <div className="decision-verdict"><small>Verdict</small><strong>{decision.verdictLabel}</strong></div>
      </header>
      <p className="decision-rationale">{decision.rationale}</p>
      <div className="decision-levels">
        <div><span>Entry</span><strong>{price(decision.entryLow)} – {price(decision.entryHigh)}</strong><small>Zona eksekusi, bukan harga tunggal</small></div>
        <div><span>Stop</span><strong className="decision-negative">{price(decision.stop)}</strong><small>{decision.atrPercent === null ? 'Fallback 3%' : `${decision.atrMultiplier}× ATR ${decision.atrPercent.toFixed(1)}%`} · jarak {decision.stopDistancePercent.toFixed(1)}%</small></div>
        <div><span>Target</span><strong className="decision-positive">{price(decision.target)}</strong><small>Target realistis</small></div>
        <div><span>Risk–Reward</span><strong>{decision.riskReward === null ? 'Tidak layak' : `1 : ${decision.riskReward.toFixed(1)}`}</strong><small>Dihitung dari tengah zona entry</small></div>
      </div>
      <div className="decision-sizing">
        <div className="decision-sizing-inputs">
          <label>Modal trading (Rp)<input type="text" inputMode="numeric" autoComplete="off" value={rupiahInput(accountSize)} onChange={(event) => { const digits = event.target.value.replace(/\D/g, ''); setAccountSize(digits ? Number(digits) : 0); }} aria-label="Modal trading dalam rupiah" /></label>
          <label>Risiko per transaksi (%)<input type="number" min="0" max="100" step="0.1" value={riskPercent} onChange={(event) => setRiskPercent(Math.min(100, Math.max(0, Number(event.target.value))))} /></label>
        </div>
        <div className="decision-sizing-result">
          <div><span>Ukuran posisi</span><strong>{decision.positionLots.toLocaleString('id-ID')} lot</strong><small>{decision.positionShares.toLocaleString('id-ID')} saham</small></div>
          <div><span>Nilai posisi maks.</span><strong>{price(decision.positionValue)}</strong><small>Pada entry atas {price(decision.entryHigh)}</small></div>
          <div><span>Risiko posisi</span><strong>{price(decision.positionRisk)}</strong><small>Batas {price(decision.riskBudget)} · {price(decision.riskPerShare)}/saham</small></div>
        </div>
        {decision.positionLots === 0 && <p className="decision-sizing-warning">Modal atau batas risiko belum cukup untuk minimum 1 lot pada jarak stop ini.</p>}
      </div>
      <div className="decision-invalidation"><span>Invalidation</span><p>{decision.invalidation}</p></div>
      <p className="decision-disclaimer">Rencana berbasis data yang tersedia, bukan rekomendasi investasi. Sesuaikan ukuran posisi dengan batas risiko Anda.</p>
    </section>
  );
}
