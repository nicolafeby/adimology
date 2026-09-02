'use client';

import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import type { AgentStoryResult, AnalysisMetric, StockRanking } from '@/lib/types';

export interface RankingDetailData { ranking: StockRanking; story: AgentStoryResult | null }

const formatMetric = (metric: AnalysisMetric) => {
  if (metric.value === null) return 'Belum tersedia';
  const value = typeof metric.value === 'number' ? metric.value.toLocaleString('id-ID', { maximumFractionDigits: 2 }) : metric.value;
  return metric.unit ? `${value} ${metric.unit}` : value;
};

export default function RankingDetailModal({ data, loading, error, onClose }: { data: RankingDetailData | null; loading: boolean; error: string; onClose: () => void }) {
  const [story, setStory] = useState<AgentStoryResult | null>(data?.story ?? null);
  const [storyLoading, setStoryLoading] = useState(false);
  const [storyError, setStoryError] = useState('');
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => { setStory(data?.story ?? null); }, [data]);
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => { document.body.style.overflow = previous; window.removeEventListener('keydown', onKey); if (pollingRef.current) clearInterval(pollingRef.current); };
  }, [onClose]);

  const pollStory = (symbol: string) => {
    if (pollingRef.current) clearInterval(pollingRef.current);
    let attempts = 0;
    const check = async () => {
      attempts++;
      try {
        const response = await fetch(`/api/analyze-story?emiten=${encodeURIComponent(symbol)}`, { cache: 'no-store' });
        const json = await response.json();
        const latest = Array.isArray(json.data) ? json.data[0] as AgentStoryResult : null;
        if (latest) setStory(latest);
        if (latest?.status === 'completed') {
          setStoryLoading(false); setStoryError('');
          if (pollingRef.current) clearInterval(pollingRef.current);
        } else if (latest?.status === 'error') {
          setStoryLoading(false); setStoryError(latest.error_message || 'Analisis good news gagal.');
          if (pollingRef.current) clearInterval(pollingRef.current);
        } else if (attempts >= 60) {
          setStoryLoading(false); setStoryError('Analisis masih berjalan. Tutup dan buka detail lagi beberapa saat lagi.');
          if (pollingRef.current) clearInterval(pollingRef.current);
        }
      } catch { /* transient polling error; retry on the next tick */ }
    };
    void check();
    pollingRef.current = setInterval(check, 5000);
  };

  useEffect(() => {
    if (data && (data.story?.status === 'pending' || data.story?.status === 'processing')) {
      setStoryLoading(true);
      pollStory(data.ranking.symbol);
    }
    // Polling is keyed to the persisted story id; pollStory intentionally owns
    // and replaces the interval for this modal instance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.ranking.symbol, data?.story?.id, data?.story?.status]);

  const startStoryAnalysis = async () => {
    if (!data) return;
    setStoryLoading(true); setStoryError('');
    try {
      const response = await fetch('/api/analyze-story', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ emiten: data.ranking.symbol }) });
      const json = await response.json();
      if (!response.ok || !json.success) throw new Error(json.error || 'Gagal memulai analisis good news');
      setStory(json.data);
      pollStory(data.ranking.symbol);
    } catch (reason) { setStoryLoading(false); setStoryError(reason instanceof Error ? reason.message : 'Gagal memulai analisis good news'); }
  };

  return <div className="ranking-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="ranking-modal" role="dialog" aria-modal="true" aria-label="Detail analisis ranking">
      <button className="ranking-modal-close" onClick={onClose} aria-label="Tutup detail"><X size={20} /></button>
      {loading && <div className="ranking-modal-state">Memuat seluruh parameter analisis…</div>}
      {error && <div className="ranking-modal-state ranking-error">{error}</div>}
      {data && <>
        <header className="ranking-detail-head"><div><span className="ranking-eyebrow">Peringkat #{data.ranking.rank} · {data.ranking.analysis_date}</span><h2>{data.ranking.symbol}</h2><p>Analisis multifaktor untuk horizon swing 5–20 hari.</p></div><div className="ranking-detail-score"><strong>{data.ranking.score}</strong><span>/100</span><small>{data.ranking.data_completeness}% data tersedia</small></div></header>
        <section className="ranking-detail-verdict"><h3>Kenapa masuk ranking?</h3><p>{buildDetailSummary(data.ranking)}</p><div className="ranking-reasons">{data.ranking.reasons.map((reason) => <span className={reason.positive ? 'positive' : ''} key={reason.label}>{reason.label}: {reason.value}</span>)}</div>{data.ranking.risk_flags.length > 0 && <p className="ranking-risk">Risiko yang perlu diperhatikan: {data.ranking.risk_flags.join(' · ')}</p>}</section>
        <section><div className="ranking-detail-section-title"><div><span className="ranking-eyebrow">Parameter lengkap</span><h3>Semua sektor penilaian</h3></div><span>Bobot tersedia dinormalisasi menjadi skor akhir</span></div><div className="ranking-component-grid">{data.ranking.components.map((component) => <article className={`ranking-component-card ${component.available ? '' : 'unavailable'}`} key={component.key}><header><div><h4>{component.label}</h4><span>Bobot {component.weight}%</span></div><strong>{component.score ?? '—'}</strong></header>{component.metrics.length ? <div>{component.metrics.map((metric) => <div className="ranking-detail-metric" key={metric.key} title={metric.description}><span>{metric.label}<small>{metric.description}</small></span><strong className={`analysis-signal-${metric.signal}`}>{formatMetric(metric)}</strong></div>)}</div> : <p>Data komponen belum tersedia pada saat screening.</p>}</article>)}</div></section>
        <section className="ranking-news-section"><div className="ranking-detail-section-title"><div><span className="ranking-eyebrow">Katalis terbaru</span><h3>Good News & Story Analysis</h3></div>{story?.created_at && <span>Diperbarui {new Date(story.created_at).toLocaleDateString('id-ID')}</span>}</div>{story?.status === 'completed' ? <>{story.swot_analysis?.ai_scoring && <div className="ranking-ai-score"><div><span>AI Story Score</span><strong>{story.swot_analysis.ai_scoring.score}/100</strong></div><div><span>AI Confidence</span><strong>{story.swot_analysis.ai_scoring.confidence}%</strong></div><div><span>Sentimen</span><strong>{story.swot_analysis.ai_scoring.sentiment}</strong></div><p>{story.swot_analysis.ai_scoring.rationale}</p></div>}<div className="ranking-news-grid">{(story.matriks_story ?? []).map((item, index) => <article key={`${item.kategori_story}-${index}`}><span>{item.kategori_story}</span><h4>{item.deskripsi_katalis}</h4><p>{item.logika_ekonomi_pasar}</p><strong>{item.potensi_dampak_harga}</strong></article>)}</div>{story.kesimpulan && <div className="ranking-news-conclusion"><strong>Kesimpulan story</strong><p>{story.kesimpulan}</p></div>}{story.sources && story.sources.length > 0 && <div className="ranking-news-sources">{story.sources.map((source) => <a href={source.uri} target="_blank" rel="noopener noreferrer" key={source.uri}>{source.title}</a>)}</div>}</> : <div className="ranking-news-empty"><strong>{storyLoading || story?.status === 'pending' || story?.status === 'processing' ? 'Good news sedang dianalisis…' : 'Good news belum dianalisis'}</strong><p>{storyLoading || story?.status === 'pending' || story?.status === 'processing' ? 'Gemini sedang mencari berita terbaru, memeriksa katalis, dan menyusun dampaknya. Modal akan diperbarui otomatis.' : 'Jalankan analisis untuk mencari berita dan katalis terbaru. Hasilnya akan disimpan dan dipakai pada screening berikutnya.'}</p>{storyError && <p className="ranking-error">{storyError}</p>}<button className="ranking-run-btn" onClick={startStoryAnalysis} disabled={storyLoading || story?.status === 'pending' || story?.status === 'processing'}>{storyLoading || story?.status === 'pending' || story?.status === 'processing' ? 'Analisis berjalan…' : story?.status === 'error' ? 'Coba Analisis Lagi' : 'Analisis Good News Sekarang'}</button></div>}</section>
      </>}
    </section>
  </div>;
}

export function buildDetailSummary(ranking: StockRanking) {
  const strongest = ranking.components.filter((component) => component.available && component.score !== null).sort((a, b) => (b.score ?? 0) - (a.score ?? 0)).slice(0, 3);
  const strengths = strongest.map((component) => `${component.label} ${component.score}/100`).join(', ');
  const signalText = ranking.signal === 'confirmed_uptrend' ? 'Sinyal uptrend terkonfirmasi' : ranking.signal === 'early_uptrend' ? 'Sinyal awal uptrend' : 'Status Watch: menarik untuk dipantau, tetapi konfirmasi momentum belum lengkap';
  const aiReason = ranking.reasons.find((reason) => reason.label === 'AI Story');
  return `${signalText}. Saham ini masuk urutan kandidat karena skor gabungan ${ranking.score}/100, terutama ditopang oleh ${strengths || 'komponen data yang tersedia'}.${aiReason ? ` Validasi AI Story: ${aiReason.value}.` : ''} Kelengkapan data ${ranking.data_completeness}%, sehingga bagian yang belum tersedia tidak dianggap bernilai nol.`;
}
