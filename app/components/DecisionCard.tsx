import { buildTradeDecision } from '@/lib/decision';
import type { StockAnalysisResult } from '@/lib/types';

const price = (value: number) => `Rp ${value.toLocaleString('id-ID')}`;

export default function DecisionCard({ result }: { result: StockAnalysisResult }) {
  const decision = buildTradeDecision(result);
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
        <div><span>Stop</span><strong className="decision-negative">{price(decision.stop)}</strong><small>Hard stop berbasis volatilitas</small></div>
        <div><span>Target</span><strong className="decision-positive">{price(decision.target)}</strong><small>Target realistis</small></div>
        <div><span>Risk–Reward</span><strong>{decision.riskReward === null ? 'Tidak layak' : `1 : ${decision.riskReward.toFixed(1)}`}</strong><small>Dihitung dari tengah zona entry</small></div>
      </div>
      <div className="decision-invalidation"><span>Invalidation</span><p>{decision.invalidation}</p></div>
      <p className="decision-disclaimer">Rencana berbasis data yang tersedia, bukan rekomendasi investasi. Sesuaikan ukuran posisi dengan batas risiko Anda.</p>
    </section>
  );
}
