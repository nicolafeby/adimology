'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import type { BacktestSummary, StockRanking } from '@/lib/types';
import RankingDetailModal, { buildDetailSummary, type RankingDetailData } from '@/app/components/RankingDetailModal';

interface UniverseCompany { symbol: string; company_name: string; sector?: string | null; board?: string | null }

const signalLabel: Record<string, string> = { confirmed_uptrend: 'Confirmed Uptrend', early_uptrend: 'Early Uptrend', watch: 'Watch', avoid: 'Avoid' };
const regimeLabel: Record<string, string> = { bullish: 'Bullish', neutral: 'Neutral', bearish: 'Bearish', unavailable: 'Belum tersedia' };
const signedPercent = (value: number | null | undefined) => value == null ? 'Belum tersedia' : `${value >= 0 ? '+' : ''}${value.toLocaleString('id-ID', { maximumFractionDigits: 1 })}%`;
const percent = (value: number | null | undefined) => value == null ? 'Belum tersedia' : `${(value * 100).toFixed(1)}%`;
const summarizeRunError = (message: string) => message.includes('429') || message.includes('quota') || message.includes('RESOURCE_EXHAUSTED') ? 'Kuota Gemini habis (HTTP 429)' : message.includes('503') || message.includes('high demand') ? 'Gemini sedang sibuk (HTTP 503)' : message.includes('masih diproses') ? 'AI Story masih diproses job sebelumnya' : message.length > 140 ? `${message.slice(0, 137)}…` : message;

export default function RankingsPage() {
  const [rankings, setRankings] = useState<StockRanking[]>([]);
  const [date, setDate] = useState('');
  const [summary, setSummary] = useState<BacktestSummary | null>(null);
  const [alerts, setAlerts] = useState<Array<{ id: number; symbol: string; status: string; created_at: string }>>([]);
  const [universe, setUniverse] = useState<UniverseCompany[]>([]);
  const [universeSearch, setUniverseSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [runMessage, setRunMessage] = useState('');
  const [runErrors, setRunErrors] = useState<Array<{ symbol: string; error: string }>>([]);
  const [error, setError] = useState('');
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [detailData, setDetailData] = useState<RankingDetailData | null>(null);
  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [rankingResponse, backtestResponse, alertResponse, universeResponse] = await Promise.all([fetch('/api/rankings?limit=10', { cache: 'no-store' }), fetch('/api/backtest', { cache: 'no-store' }), fetch('/api/alerts?limit=5', { cache: 'no-store' }), fetch('/api/universe', { cache: 'no-store' })]);
      const rankingJson = await rankingResponse.json();
      const backtestJson = await backtestResponse.json();
      const alertJson = await alertResponse.json();
      const universeJson = await universeResponse.json();
      if (!rankingJson.success) throw new Error(rankingJson.error || 'Ranking tidak dapat dimuat');
      setRankings(rankingJson.data ?? []); setDate(rankingJson.date ?? '');
      if (backtestJson.success) setSummary(backtestJson.summary);
      if (alertJson.success) setAlerts(alertJson.data ?? []);
      if (universeJson.success) setUniverse(universeJson.data ?? []);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Terjadi kesalahan'); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);
  const normalizedSearch = universeSearch.trim().toLowerCase();
  const filteredUniverse = normalizedSearch ? universe.filter((company) => `${company.symbol} ${company.company_name} ${company.sector ?? ''}`.toLowerCase().includes(normalizedSearch)) : universe;
  const runScreener = async () => {
    setRunning(true); setError(''); setRunErrors([]); setRunMessage('Mengambil histori dan menganalisis kandidat. Proses ini dapat memakan beberapa menit…');
    try {
      const response = await fetch('/api/screener/run', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ deepLimit: 50, aiLimit: 10, concurrency: 4 }) });
      const json = await response.json();
      if (!json.success) throw new Error(json.error || 'Screener gagal dijalankan');
      setRunMessage(`Selesai: ${json.progress.analyzed} dianalisis kuantitatif, ${json.progress.aiCompleted}/${json.progress.aiRequested} divalidasi AI Story (${json.progress.aiReused} memakai hasil terbaru), ${json.rankings.length} ditampilkan dalam ranking final, ${json.progress.errors.length} error. Status Watch/Avoid tetap ditampilkan sebagai peringatan, bukan disembunyikan.`);
      setRunErrors(json.progress.errors ?? []);
      await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Screener gagal dijalankan'); setRunMessage(''); }
    finally { setRunning(false); }
  };
  const showDetail = async (ranking: StockRanking) => {
    setDetailOpen(true); setDetailLoading(true); setDetailError(''); setDetailData(null);
    try {
      const response = await fetch(`/api/rankings/${ranking.symbol}?date=${encodeURIComponent(ranking.analysis_date)}`, { cache: 'no-store' });
      const json = await response.json();
      if (!json.success) throw new Error(json.error || 'Detail analisis tidak tersedia');
      setDetailData(json.data);
    } catch (reason) { setDetailError(reason instanceof Error ? reason.message : 'Detail analisis tidak tersedia'); }
    finally { setDetailLoading(false); }
  };

  return (
    <main className="ranking-page">
      <header className="ranking-hero">
        <div><span className="ranking-eyebrow">Market screener · {date || 'belum dijalankan'} · {universe.length.toLocaleString('id-ID')} emiten IDX</span><h1>Top 10 Kandidat Naik</h1><p>Ranking final menggabungkan data kuantitatif, broker flow, fundamental, orderbook, dan validasi AI Story berbasis berita terbaru untuk swing 5–20 hari.</p></div>
        <div className="ranking-actions"><button className="ranking-secondary-btn" onClick={load} disabled={loading || running}>{loading ? 'Memuat…' : 'Refresh'}</button><button className="ranking-run-btn" onClick={runScreener} disabled={loading || running}>{running ? 'Screening berjalan…' : 'Jalankan Screener'}</button></div>
      </header>

      {error && <div className="ranking-empty ranking-error">{error}</div>}
      {runMessage && <div className="ranking-run-status">{runMessage}</div>}
      {runErrors.length > 0 && <details className="ranking-run-errors"><summary>Lihat rincian {runErrors.length} error</summary><div>{runErrors.map((item, index) => <p key={`${item.symbol}-${index}`}><strong>{item.symbol}</strong><span>{summarizeRunError(item.error)}</span></p>)}</div></details>}
      {!error && !loading && rankings.length === 0 && <div className="ranking-empty"><h2>Ranking belum tersedia</h2><p>Klik <strong>Jalankan Screener</strong>. Jika universe masih kosong, sistem akan mengimpor emiten dari cache watchlist Stockbit secara otomatis.</p></div>}

      <section className="ranking-grid">
        {rankings.map((row) => (
          <article className="ranking-card" key={`${row.analysis_date}-${row.symbol}`}>
            <div className="ranking-card-head"><span className="ranking-number">#{row.rank}</span><div><Link href={`/?symbol=${row.symbol}`}>{row.symbol}</Link><span className={`signal-pill signal-${row.signal}`}>{signalLabel[row.signal] ?? row.signal}</span>{row.reasons.some((reason) => reason.label === 'Scoring Model' && reason.value === 'multifactor-regime-rs-v3') && <span className="ai-validated-pill">Regime + RS · v3</span>}</div><strong>{row.score}<small>/100</small></strong></div>
            <div className="ranking-stats"><div><span>Harga</span><strong>Rp {Number(row.last_price).toLocaleString('id-ID')}</strong></div><div><span>Kelengkapan</span><strong>{row.data_completeness}%</strong></div><div><span>Peluang 10D</span><strong>{percent(row.model_probability)}</strong></div></div>
            {row.market_context && <div className="ranking-stats"><div><span>Market Regime</span><strong>{regimeLabel[row.market_context.regime.label]}</strong></div><div><span>RS vs IHSG 20D</span><strong>{signedPercent(row.market_context.relativeStrength.rs20d)}</strong></div><div><span>Gate</span><strong>{row.market_context.gate.applied ? `${signalLabel[row.market_context.gate.signalBeforeGate]} → ${signalLabel[row.market_context.gate.signalAfterGate]}` : 'Tidak mengubah sinyal'}</strong></div></div>}
            <div className="ranking-card-summary"><strong>Resume analisis</strong><p>{buildDetailSummary(row)}</p></div>
            <div className="ranking-reasons">{(row.reasons ?? []).map((reason) => <span className={reason.positive ? 'positive' : ''} key={reason.label}>{reason.label}: {reason.value}</span>)}</div>
            {(row.risk_flags ?? []).length > 0 && <p className="ranking-risk">Risiko: {row.risk_flags.join(' · ')}</p>}
            <button className="ranking-detail-btn" onClick={() => showDetail(row)}>Lihat Detail Analisis</button>
          </article>
        ))}
      </section>

      <section className="ranking-lower-grid">
        <article className="ranking-panel"><h2>Validasi sinyal (neto)</h2>{summary?.sampleSize ? <><p className="ranking-note">Backtest · {summary.configVersion} · {summary.enteredTrades} entered trades · eksekusi {summary.executionModels.join(', ')}</p><div className="backtest-metrics"><div title="Rata-rata hasil bersih seluruh trade valid dalam unit risiko awal (R)."><span>Net expectancy</span><strong>{summary.expectancyR == null ? '—' : `${summary.expectancyR >= 0 ? '+' : ''}${summary.expectancyR.toFixed(2)}R/trade`}</strong></div><div><span>Avg net return</span><strong>{summary.averageReturn10d == null ? '—' : `${summary.averageReturn10d.toFixed(2)}%`}</strong></div><div><span>Net win rate</span><strong>{percent(summary.winRate10d)}</strong></div><div><span>Payoff ratio</span><strong>{summary.payoffRatio?.toFixed(2) ?? '—'}</strong></div><div><span>Profit factor</span><strong>{summary.profitFactor?.toFixed(2) ?? '—'}</strong></div><div title="Penurunan terburuk pada equity index berurutan; bukan simulasi portofolio overlap."><span>Max drawdown</span><strong>{summary.maxDrawdown10d == null ? '—' : `${summary.maxDrawdown10d.toFixed(2)}%`}</strong></div><div><span>No entry</span><strong>{summary.noEntryCount} / {summary.sampleSize}</strong></div><div><span>Ambiguous</span><strong>{summary.ambiguousCount}</strong></div><div title="Maximum Adverse Excursion selama posisi aktif."><span>Avg MAE</span><strong>{summary.averageMae == null ? '—' : `${summary.averageMae.toFixed(2)}%`}</strong></div><div title="Maximum Favorable Excursion selama posisi aktif."><span>Avg MFE</span><strong>{summary.averageMfe == null ? '—' : `${summary.averageMfe.toFixed(2)}%`}</strong></div></div><p className="ranking-note">Asumsi: beli {summary.costAssumptions.buyFeePercent}% · jual {summary.costAssumptions.sellFeePercent}% · slippage {summary.costAssumptions.slippagePercentPerSide}% per sisi ({summary.costAssumptions.slippageModel}). Sesuaikan dengan broker Anda. Drawdown: sequential/indexed approximation. Performa masa lalu tidak menjamin hasil berikutnya.</p></> : <p>Outcome belum cukup. Evaluator hanya mengisi hasil setelah tersedia 20 sesi perdagangan penuh.</p>}</article>
        <article className="ranking-panel"><h2>Alert terbaru</h2>{alerts.length ? <ul className="ranking-alerts">{alerts.map((alert) => <li key={alert.id}><Link href={`/?symbol=${alert.symbol}`}>{alert.symbol}</Link><span>{alert.status} · {new Date(alert.created_at).toLocaleString('id-ID')}</span></li>)}</ul> : <p>Belum ada alert yang lolos rule dan probabilitas minimum.</p>}</article>
      </section>
      <section className="universe-panel">
        <div className="universe-header"><div><span className="ranking-eyebrow">Cakupan screener</span><h2>Seluruh Saham IDX</h2><p>{filteredUniverse.length.toLocaleString('id-ID')} dari {universe.length.toLocaleString('id-ID')} emiten</p></div><input value={universeSearch} onChange={(event) => setUniverseSearch(event.target.value)} placeholder="Cari kode, nama, atau sektor…" aria-label="Cari saham IDX" /></div>
        <div className="universe-list">{filteredUniverse.map((company) => <Link href={`/?symbol=${company.symbol}`} className="universe-item" key={company.symbol}><strong>{company.symbol}</strong><span>{company.company_name || '—'}</span><small>{company.sector || company.board || 'Sektor belum tersedia'}</small></Link>)}</div>
      </section>
      <p className="ranking-disclaimer">Ranking merupakan alat bantu berbasis data, bukan rekomendasi membeli atau menjual saham.</p>
      {detailOpen && <RankingDetailModal data={detailData} loading={detailLoading} error={detailError} onClose={() => setDetailOpen(false)} />}
    </main>
  );
}
