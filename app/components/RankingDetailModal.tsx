'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import type { AgentStoryResult, AnalysisMetric, StockRanking } from '@/lib/types';
import type { ScreeningResult } from '@/lib/screening';
import type { StrategyScreeningAssessment } from '@/lib/strategy-screening';
import { getStrategyProfile, isStrategyId, providerStrategySupport } from '@/lib/strategies';
import { safeNewsUrl, unverifiedStoryNewsEnrichment, type NewsEnrichment } from '@/lib/news';
import { DecisionCardView } from './DecisionCard';
import { ScreeningNews, displayTimestamp } from './ScreeningNews';

export interface RankingDetailData { ranking: StockRanking | null; story: AgentStoryResult | null; screening?: ScreeningResult & { point_in_time_valid?: boolean; backtest_eligible?: boolean; backtest_ineligibility_reasons?: Array<{ code: string; message?: string }> }; run?: Record<string, unknown> | null }
const formatMetric = (metric: AnalysisMetric) => metric.value === null ? 'Belum tersedia' : `${typeof metric.value === 'number' ? metric.value.toLocaleString('id-ID', { maximumFractionDigits: 2 }) : metric.value}${metric.unit ? ` ${metric.unit}` : ''}`;
export default function RankingDetailModal({ data, loading, error, onClose }: { data: RankingDetailData | null; loading: boolean; error: string; onClose: () => void }) {
  const ranking = data?.ranking;
  const strategyId = ranking?.strategy_id ?? data?.screening?.strategy_id ?? data?.run?.strategy_id;
  const profile = isStrategyId(strategyId) ? getStrategyProfile(strategyId) : null;
  const support = ranking?.strategy_support ?? data?.screening?.strategy_support ?? (profile ? providerStrategySupport(profile.id) : null);
  const runId = ranking?.run_id ?? data?.screening?.run_id ?? data?.run?.id;
  const symbol = ranking?.symbol ?? data?.screening?.symbol;
  const cutoff = ranking?.information_cutoff_at ?? data?.run?.information_cutoff_at;
  const historical = data?.run?.execution_mode === 'historical_replay';
  const assessment = data?.screening?.strategy_assessment ?? ranking?.strategy_assessment as StrategyScreeningAssessment | null | undefined;
  const officialAra = assessment?.officialAra;
  const [story, setStory] = useState<AgentStoryResult | null>(data?.story ?? null);
  const [news, setNews] = useState<NewsEnrichment | null>(ranking?.news_enrichment ?? data?.screening?.news_enrichment ?? null);
  const [storyLoading, setStoryLoading] = useState(false), [storyError, setStoryError] = useState('');
  const modalRef = useRef<HTMLElement>(null), epochRef = useRef(0), controllerRef = useRef<AbortController | null>(null);
  useEffect(() => {
    epochRef.current++; controllerRef.current?.abort();
    setStory(data?.story ?? null); setNews(data?.ranking?.news_enrichment ?? data?.screening?.news_enrichment ?? null); setStoryError(''); setStoryLoading(false);
    return () => { epochRef.current++; controllerRef.current?.abort(); };
  }, [data]);
  useEffect(() => {
    const previous = document.body.style.overflow, previousFocus = document.activeElement as HTMLElement | null;
    document.body.style.overflow = 'hidden';
    modalRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (event.key !== 'Tab') return;
      const elements = Array.from(modalRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input, select, summary, [tabindex="0"]') ?? []).filter(element => element.getClientRects().length > 0);
      const first = elements[0], last = elements[elements.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    window.addEventListener('keydown', onKey);
    return () => { document.body.style.overflow = previous; window.removeEventListener('keydown', onKey); previousFocus?.focus(); };
  }, [onClose]);
  const refreshEnrichment = useCallback(async (signal: AbortSignal) => {
    if (!runId || !symbol || !profile) return;
    const epoch = epochRef.current;
    const query = new URLSearchParams({ strategyId: profile.id, runId: String(runId) });
    const response = await fetch(`/api/rankings/${encodeURIComponent(symbol)}?${query}`, { cache: 'no-store', signal });
    const json = await response.json();
    if (!response.ok || !json.success) throw new Error('Pengayaan belum dapat dimuat.');
    if (signal.aborted || epoch !== epochRef.current) return;
    // Only enrichment changes. Quantitative prediction displayed above remains immutable.
    setStory(json.data?.story ?? null);
    setNews(json.data?.ranking?.news_enrichment ?? json.data?.screening?.news_enrichment ?? null);
  }, [profile, runId, symbol]);
  const pending = story?.status === 'pending' || story?.status === 'processing' || news?.status === 'pending';
  useEffect(() => {
    if (!pending || historical || !runId || !profile || !symbol) return;
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout>; let attempts = 0;
    const tick = async () => {
      attempts++;
      try { await refreshEnrichment(controller.signal); } catch { /* Bounded retry; never replace saved quantitative results. */ }
      if (controller.signal.aborted) return;
      if (attempts >= 60) { setStoryError('Pembaruan otomatis dijeda. Tutup dan buka detail untuk memuat status terbaru.'); return; }
      timer = setTimeout(tick, 5000);
    };
    timer = setTimeout(tick, 3000);
    return () => { controller.abort(); clearTimeout(timer); };
  }, [pending, historical, runId, profile, symbol, refreshEnrichment]);
  const startStoryAnalysis = async () => {
    if (!runId || !profile || !symbol || historical) return;
    const epoch = epochRef.current, controller = new AbortController(); controllerRef.current?.abort(); controllerRef.current = controller;
    setStoryLoading(true); setStoryError('');
    try {
      const response = await fetch(`/api/screener/runs/${encodeURIComponent(String(runId))}/enrichment`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ strategyId: profile.id, symbol }), signal: controller.signal });
      const json = await response.json();
      if (!response.ok || !json.success) throw new Error('Pengambilan berita gagal.');
      await refreshEnrichment(controller.signal);
    } catch { if (!controller.signal.aborted && epoch === epochRef.current) setStoryError('Pengambilan berita gagal. Hasil kuantitatif tetap tersimpan; coba pengayaan lagi.'); }
    finally { if (!controller.signal.aborted && epoch === epochRef.current) setStoryLoading(false); }
  };
  const displayedNews = news ?? (profile && symbol && typeof cutoff === 'string' ? unverifiedStoryNewsEnrichment(story, { strategyId: profile.id, symbol, informationCutoffAt: cutoff }) : null);

  return <div className="ranking-modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}><section ref={modalRef} className="ranking-modal" role="dialog" aria-modal="true" aria-label="Detail analisis screening">
    <button className="ranking-modal-close" onClick={onClose} aria-label="Tutup detail"><X size={20} /></button>
    {loading && <div role="status" className="ranking-modal-state">Memuat seluruh parameter analisis…</div>}
    {error && <div role="alert" className="ranking-modal-state ranking-error">{error}</div>}
    {data && <><header className="ranking-detail-head"><div><span className="ranking-eyebrow">{profile?.name ?? 'Strategi legacy tidak terverifikasi'} · {ranking?.analysis_date ?? data.screening?.analysis_date}</span><h2>{symbol}</h2><p>{profile?.description ?? 'Identitas strategi snapshot lama tidak dapat dibuktikan.'}</p></div>{ranking && <div className="ranking-detail-score"><strong>{ranking.analysis_score ?? ranking.score}</strong><span>/100 Analisis</span><small>{ranking.data_completeness}% data tersedia</small></div>}</header>
      <section className="screening-detail-provenance"><h3>Cutoff dan dukungan data</h3><p>Cutoff informasi: {displayTimestamp(cutoff)} · waktu screening: {displayTimestamp(data.run?.screened_at ?? data.run?.started_at)}</p><p>Mode: {String(data.run?.execution_mode ?? 'legacy_unverified')} · sesi: {String(data.run?.market_session ?? 'tidak terverifikasi')} · Asia/Jakarta</p><p>Dukungan: {support?.level ?? 'unavailable'} · {support?.reasons.join(' ') ?? 'Provenance strategi tidak tersedia.'}</p><p>Horizon: {profile?.horizon ?? 'Tidak terverifikasi'} · validitas sinyal: {ranking?.decision?.signalExpiresAt ? displayTimestamp(ranking.decision.signalExpiresAt) : profile ? `berakhir pada jendela entry ${profile.entry.end} WIB sesuai sesi strategi` : 'Tidak terverifikasi'}</p><p>Kelayakan backtest: {data.screening?.backtest_eligible === true ? 'Snapshot memenuhi syarat; outcome tetap memerlukan data setelah cutoff.' : data.screening?.backtest_eligible === false ? `Belum memenuhi syarat: ${data.screening.backtest_ineligibility_reasons?.map(reason => reason.message ?? reason.code).join(' · ') || 'provenance belum lengkap'}` : 'Belum terverifikasi; hanya arsip point-in-time dan outcome valid yang dapat dievaluasi.'}</p><p>Versi strategi: {ranking?.strategy_version ?? String(data.run?.strategy_version ?? 'legacy_unverified')} · konfigurasi: {ranking?.configuration_version ?? String(data.run?.configuration_version ?? 'unverified')}</p><p>Eksekusi: {ranking?.execution_model ?? String(data.run?.execution_model ?? 'unverified')} · outcome: {ranking?.outcome_definition ?? String(data.run?.outcome_definition ?? 'unverified')}</p></section>
      {profile?.id === 'ara' && <section className="screening-detail-provenance"><h3>Status ARA</h3><p>{assessment?.monitoring === 'locked' ? 'Terkunci di ARA · monitoring' : assessment?.monitoring === 'already_touched' ? 'Sudah menyentuh ARA · monitoring' : assessment?.monitoring === 'candidate' ? 'Kandidat menuju ARA' : 'Status belum terverifikasi'}. {ranking?.decision?.executionEligible === true ? 'Kelayakan eksekusi memenuhi aturan snapshot.' : 'Eksekusi belum memenuhi syarat.'} Posisi antrean tidak diketahui; fill tidak dijamin.</p>{officialAra ? <><p>Batas resmi Rp {officialAra.price.toLocaleString('id-ID')} · sesi {officialAra.sessionDate} · papan {officialAra.board} · harga referensi Rp {officialAra.referencePrice.toLocaleString('id-ID')}</p><p>Diamati {displayTimestamp(officialAra.observedAt)} · tersedia {displayTimestamp(officialAra.availableAt)} · versi aturan {officialAra.rulesVersion}</p>{safeNewsUrl(officialAra.sourceUrl) && <a href={safeNewsUrl(officialAra.sourceUrl)!} target="_blank" rel="noopener noreferrer">Sumber batas ARA resmi</a>}</> : <p>Batas ARA resmi beserta provenance sumber belum tersedia.</p>}</section>}
      {data.screening && <section className="ranking-detail-verdict"><h3>Kelayakan: {data.screening.screening_status ?? 'belum dievaluasi'}</h3>{(data.screening.eligibility_rules ?? data.screening.failed_rules).map(rule => <p key={rule.key}><strong>{rule.passed ? '✓' : '✕'} {rule.label}:</strong> {rule.explanation}<small> Aktual: {rule.category === 'process' ? 'Proses belum selesai' : typeof rule.actualValue === 'object' && rule.actualValue !== null ? JSON.stringify(rule.actualValue) : String(rule.actualValue ?? 'Tidak tersedia')} · syarat: {typeof rule.requiredValue === 'object' ? JSON.stringify(rule.requiredValue) : String(rule.requiredValue)}</small></p>)}</section>}
      {ranking && <><section className="ranking-detail-verdict"><h3>Kualitas analisis</h3><div className="ranking-reasons"><span>Kelengkapan: {ranking.data_completeness}%</span><span>Agreement: {ranking.signal_agreement == null ? 'Belum tersedia' : `${ranking.signal_agreement}%`}</span><span>Confidence: {ranking.confidence == null ? 'Belum tersedia' : `${ranking.confidence}%`}</span><span>Arah dominan: {ranking.dominant_direction ?? 'Belum tersedia'}</span><span>Freshness: {ranking.freshness == null ? 'Belum tersedia' : `${ranking.freshness}%`}</span><span>Reliability: {ranking.reliability == null ? 'Belum tersedia' : `${ranking.reliability}%`}</span></div>{ranking.analysis_quality?.freshness.sources.map(source => <p className="ranking-note" key={source.source}>{source.source}: {source.status} · diamati {displayTimestamp(source.observedAt)}</p>)}{ranking.conflicts?.map(conflict => <p className="ranking-risk" key={conflict.key}>{conflict.message}</p>)}</section>
        <section className="ranking-detail-verdict"><h3>{profile?.id === 'ara' ? 'Skor heuristik dan probabilitas ARA' : profile?.id === 'swing' ? 'Kalibrasi probabilitas 10 sesi' : `Kalibrasi ${profile?.horizon ?? 'belum terverifikasi'}`}</h3>{profile?.id === 'swing' && ranking.probability_calibration ? <><p>Peluang net return positif: {ranking.model_probability == null ? 'Belum tersedia' : `${(ranking.model_probability * 100).toFixed(1)}%`} · n={ranking.probability_calibration.sampleSize} outcome</p><p>Interval 95%: {ranking.probability_calibration.confidenceInterval.lower == null ? 'Belum tersedia' : `${(ranking.probability_calibration.confidenceInterval.lower * 100).toFixed(1)}–${(ranking.probability_calibration.confidenceInterval.upper! * 100).toFixed(1)}%`} · cutoff kalibrasi {ranking.probability_calibration.calibrationCutoff}</p>{ranking.probability_calibration.warnings.map(warning => <p className="ranking-risk" key={warning}>{warning}</p>)}</> : <p>Probabilitas belum tersedia: sampel valid untuk strategi dan definisi outcome ini belum cukup. Skor heuristik tidak boleh dibaca sebagai probabilitas.</p>}</section>
        <section className="ranking-detail-verdict"><h3>Alasan hasil screening</h3><p>{buildDetailSummary(ranking)}</p><div className="ranking-reasons">{ranking.reasons.map(reason => <span className={reason.positive ? 'positive' : ''} key={reason.label}>{reason.label}: {reason.value}</span>)}</div>{ranking.risk_flags.length > 0 && <p className="ranking-risk">Risiko: {ranking.risk_flags.join(' · ')}</p>}</section>
        {ranking.decision && <DecisionCardView decision={ranking.decision} symbol={ranking.symbol} currentPrice={ranking.last_price} strategyId={profile?.id} />}
        <section><div className="ranking-detail-section-title"><div><span className="ranking-eyebrow">Rincian faktor</span><h3>Ranking, kualitas, eksekusi, dan konteks</h3></div><span>Skor ranking bukan probabilitas</span></div><div className="ranking-component-grid">{ranking.components.map(component => <article className={`ranking-component-card ${component.available ? '' : 'unavailable'}`} key={component.key}><header><div><h4>{component.label}</h4><span>{component.role?.replaceAll('_', ' ') ?? 'legacy'} · {component.horizon?.replaceAll('_', ' ') ?? 'horizon legacy'} · bobot {component.weight}%</span></div><strong>{component.score ?? '—'}</strong></header>{component.benchmarkScope && <p>Peer: {component.benchmarkScope} · sampel {component.sampleSize ?? '—'}</p>}{component.metrics.length ? <div>{component.metrics.map(metric => <div className="ranking-detail-metric" key={metric.key} title={metric.description}><span>{metric.label}<small>{metric.description}</small></span><strong className={`analysis-signal-${metric.signal}`}>{formatMetric(metric)}</strong></div>)}</div> : <p>Data tidak tersedia; tidak diganti dengan nol.</p>}{component.execution?.scenarios.map(scenario => <div className="ranking-detail-metric" key={scenario.notional}><span>Skenario Rp {scenario.notional.toLocaleString('id-ID')}<small>Beli/jual, partisipasi, dan kedalaman orderbook.</small></span><strong>{scenario.executionStatus} · {scenario.estimatedBuySlippagePercent ?? '—'}% / {scenario.estimatedSellSlippagePercent ?? '—'}%</strong></div>)}{component.warnings?.map(warning => <p className="ranking-risk" key={warning}>{warning}</p>)}</article>)}</div></section>
      </>}
      <section className="ranking-news-section"><h3>Berita dan pengayaan sumber</h3><ScreeningNews enrichment={displayedNews} /><p className="ranking-note">Ringkasan AI membantu membaca sumber. Timestamp atau konfirmasi primer yang tidak terbukti tetap ditandai tidak terverifikasi. Pembaruan setelah cutoff hanya menjadi monitoring dan tidak mengubah snapshot keputusan.</p>{story?.status === 'completed' && <><div className="ranking-news-grid">{(story.matriks_story ?? []).map((item, index) => <article key={`${item.kategori_story}-${index}`}><span>{item.kategori_story}</span><h4>{item.deskripsi_katalis}</h4><p>{item.logika_ekonomi_pasar}</p><strong>{item.potensi_dampak_harga}</strong></article>)}</div>{story.kesimpulan && <p>{story.kesimpulan}</p>}<div className="ranking-news-sources">{(Array.isArray(story.sources) ? story.sources.filter(source => source && typeof source.uri === 'string') : []).map((source, index) => safeNewsUrl(source.uri) ? <a href={safeNewsUrl(source.uri)!} target="_blank" rel="noopener noreferrer" key={`${source.uri}-${index}`}>{source.title}</a> : null)}</div></>}{storyError && <p role="alert" className="ranking-error">{storyError}</p>}{historical ? <p className="ranking-note">Historical replay hanya menggunakan arsip pada cutoff; retry berita live tidak tersedia.</p> : runId && profile ? <button className="ranking-run-btn" onClick={startStoryAnalysis} disabled={storyLoading || pending} data-testid="retry-enrichment">{storyLoading || pending ? 'Pengayaan diproses…' : 'Coba pengayaan berita'}</button> : <p className="ranking-note">Run dengan identitas strategi diperlukan untuk pengayaan yang dapat diaudit.</p>}</section>
    </>}
  </section></div>;
}
export function buildDetailSummary(ranking: StockRanking) {
  const strongest = ranking.components.filter(component => component.available && component.score !== null && component.key !== 'catalyst' && component.role !== 'informational').sort((a, b) => (b.score ?? 0) - (a.score ?? 0)).slice(0, 3);
  const strengths = strongest.map(component => `${component.label} ${component.score}/100`).join(', ');
  const signalText = ranking.signal === 'confirmed_uptrend' ? 'Sinyal uptrend terkonfirmasi' : ranking.signal === 'early_uptrend' ? 'Sinyal awal uptrend' : ranking.signal === 'avoid' ? 'Status avoid: risiko atau kelengkapan data belum memadai' : 'Status watch: konfirmasi belum lengkap';
  return `${signalText}. Skor analisis ${ranking.analysis_score ?? ranking.score}/100 didukung ${strengths || 'komponen yang tersedia'}. Kelengkapan data ${ranking.data_completeness}%; input yang tidak tersedia tidak dianggap nol.`;
}
