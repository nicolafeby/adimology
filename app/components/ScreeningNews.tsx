'use client';

import { NEWS_LABELS, safeNewsUrl, unavailableNewsEnrichment, type ClassifiedNews, type NewsEnrichment } from '@/lib/news';

export const newsStatusLabel = { completed: 'Berita tersedia', no_relevant_news: 'Tidak ditemukan berita relevan', source_unavailable: 'Sumber berita tidak tersedia', failed: 'Pengambilan berita gagal', timestamp_unverified: 'Waktu publikasi tidak dapat diverifikasi', pending: 'Pengayaan berita diproses' };
export const displayTimestamp = (value: unknown) => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? `${new Date(value).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })} WIB` : 'Tidak terverifikasi';
function NewsItem({ item }: { item: ClassifiedNews }) {
  const url = safeNewsUrl(item.url);
  return <details className="screening-news-item">
    <summary><span>{item.title}</span><span className="screening-news-labels">{item.labels.map(label => <span className={`screening-news-badge news-${label}`} key={label}>{NEWS_LABELS[label]}</span>)}{item.labels.length === 0 && <span className="screening-news-badge">Belum terklasifikasi</span>}</span></summary>
    <p>{item.publisher || 'Publisher tidak terverifikasi'} · {item.source_type} · {item.verification_status.replaceAll('_', ' ')}</p>
    {item.labels.map(label => <p key={label}><strong>{NEWS_LABELS[label]}:</strong> {item.classification_reasons[label]}</p>)}
    <p>Publikasi asli: {displayTimestamp(item.effective_published_at)} · pertama terlihat: {displayTimestamp(item.first_seen_at)}</p>
    <p>Diambil: {displayTimestamp(item.fetched_at)} · tersedia: {displayTimestamp(item.available_at)}</p>
    <p>Freshness: {item.freshness} · arah dampak: {item.impact_direction ?? 'unknown'} · {item.decision_eligible ? 'Tersedia pada cutoff' : item.temporal_validity === 'after_cutoff' ? 'Pembaruan setelah cutoff; khusus monitoring' : 'Bukan bukti keputusan: timestamp tidak terverifikasi'}</p>
    {item.event_risk && <p>Risiko {item.event_risk.category} · severity {item.event_risk.severity} · waktu peristiwa {displayTimestamp(item.event_at)}</p>}
    <div className="screening-news-links">{url && <a href={url} target="_blank" rel="noopener noreferrer">Sumber berita</a>}{safeNewsUrl(item.primary_confirmation?.url) && <a href={safeNewsUrl(item.primary_confirmation?.url)!} target="_blank" rel="noopener noreferrer">Konfirmasi primer</a>}{safeNewsUrl(item.event_risk?.source_url) && <a href={safeNewsUrl(item.event_risk?.source_url)!} target="_blank" rel="noopener noreferrer">Sumber risiko</a>}</div>
  </details>;
}
export function ScreeningNews({ enrichment, compact = false }: { enrichment?: NewsEnrichment | null; compact?: boolean }) {
  const news = enrichment ?? unavailableNewsEnrichment();
  return <section className="screening-news" aria-label="Label berita" data-testid="news-enrichment" data-status={news.status}>
    <p className="ranking-note"><strong>{newsStatusLabel[news.status]}</strong>{!compact && <> · {news.reason}</>}</p>
    {news.items.map(item => <NewsItem key={item.news_id} item={item} />)}
    {!compact && news.monitoring_updates.length > 0 && <details><summary>Pembaruan monitoring setelah cutoff ({news.monitoring_updates.length})</summary>{news.monitoring_updates.map(item => <NewsItem key={item.news_id} item={item} />)}</details>}
  </section>;
}
