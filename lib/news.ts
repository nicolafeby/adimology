import { getStrategyProfile, type StrategyId } from './strategies';

export const NEWS_CLASSIFICATION_VERSION = 'news-evidence-v1';
export const NEWS_LABELS = {
  verified_catalyst: 'Katalis terverifikasi', rumor: 'Rumor', old_news: 'Berita lama', event_risk: 'Risiko peristiwa',
} as const;
export type NewsLabel = keyof typeof NEWS_LABELS;
export type NewsSourceType = 'exchange' | 'issuer' | 'regulator' | 'media' | 'social' | 'ai_summary' | 'unknown';
export type NewsStatus = 'completed' | 'no_relevant_news' | 'source_unavailable' | 'failed' | 'timestamp_unverified' | 'pending';
export interface NewsInput {
  news_id: string; symbol: string; title: string; publisher: string | null; url: string | null; source_type: NewsSourceType;
  published_at: string | null; original_published_at?: string | null; first_seen_at: string | null; fetched_at: string | null; available_at: string | null;
  event_at?: string | null; duplicate_group?: string | null; event_group?: string | null;
  /** A provider must attest an actual primary announcement; a domain/citation alone is insufficient. */
  primary_confirmation?: { event_confirmed: boolean; url: string; available_at: string; source_type: 'exchange' | 'issuer' | 'regulator' } | null;
  unconfirmed_claim?: boolean;
  impact_direction?: 'positive' | 'negative' | 'mixed' | 'unknown';
  event_risk?: { category: string; severity: 'low' | 'medium' | 'high'; reason: string; source_url: string; active_until?: string | null } | null;
  ai_version?: string | null;
}
export interface ClassifiedNews extends NewsInput {
  verification_status: 'primary_confirmed' | 'unconfirmed_claim' | 'unverified';
  freshness: 'fresh' | 'old' | 'unknown'; labels: NewsLabel[]; classification_reasons: Partial<Record<NewsLabel, string>>;
  temporal_validity: 'valid_at_cutoff' | 'after_cutoff' | 'timestamp_unverified'; decision_eligible: boolean;
  classification_version: string; effective_published_at: string | null;
}
export interface NewsEnrichment {
  status: NewsStatus; items: ClassifiedNews[]; monitoring_updates: ClassifiedNews[];
  information_cutoff_at: string | null; fetched_at: string | null; classification_version: string; reason: string;
}
export interface NewsClassificationContext {
  symbol: string; strategyId: StrategyId; informationCutoffAt: string; horizonEndAt?: string | null;
  freshnessHours?: number; sourceStatus?: 'available' | 'unavailable' | 'failed' | 'pending'; fetchedAt?: string | null;
}

const timestamp = (value: string | null | undefined) => value && /T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value)) ? Date.parse(value) : null;
/** Only ordinary public web links. React renders external text as text, never HTML. */
export function safeNewsUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : null; } catch { return null; }
}
export function unavailableNewsEnrichment(informationCutoffAt: string | null = null, status: 'source_unavailable' | 'failed' | 'pending' = 'source_unavailable'): NewsEnrichment {
  return { status, items: [], monitoring_updates: [], information_cutoff_at: informationCutoffAt, fetched_at: null, classification_version: NEWS_CLASSIFICATION_VERSION,
    reason: status === 'failed' ? 'Pengambilan berita gagal; hasil kuantitatif tetap tersedia.' : status === 'pending' ? 'Pengayaan berita sedang diproses.' : 'Sumber berita terstruktur dengan waktu publikasi dan bukti sumber primer belum tersedia.' };
}

/** Pure classification. No model output is used as an eligibility or confirmation gate. */
export function classifyNews(input: NewsInput[], context: NewsClassificationContext): NewsEnrichment {
  if (context.sourceStatus && context.sourceStatus !== 'available') return unavailableNewsEnrichment(context.informationCutoffAt, context.sourceStatus === 'unavailable' ? 'source_unavailable' : context.sourceStatus);
  if (!Array.isArray(input) || input.some(item => !item || typeof item.news_id !== 'string' || typeof item.symbol !== 'string' || typeof item.title !== 'string')) return unavailableNewsEnrichment(context.informationCutoffAt, 'failed');
  const cutoff = timestamp(context.informationCutoffAt);
  const horizon = timestamp(context.horizonEndAt) ?? cutoff;
  const freshHours = context.freshnessHours ?? getStrategyProfile(context.strategyId).freshness.newsHours;
  const relevant = input.filter(item => item.symbol.toUpperCase() === context.symbol.toUpperCase());
  // A later fetched duplicate may not modify the knowledge of an earlier decision.
  const originalByGroup = new Map<string, number>();
  for (const item of relevant) {
    const available = timestamp(item.available_at), fetched = timestamp(item.fetched_at), published = timestamp(item.original_published_at ?? item.published_at);
    if (!item.duplicate_group || cutoff === null || available === null || available > cutoff || fetched === null || fetched > cutoff || published === null || published > cutoff) continue;
    originalByGroup.set(item.duplicate_group, Math.min(originalByGroup.get(item.duplicate_group) ?? Infinity, published));
  }
  const classified = relevant.map((item): ClassifiedNews => {
    const available = timestamp(item.available_at), fetched = timestamp(item.fetched_at), published = timestamp(item.published_at), firstSeen = timestamp(item.first_seen_at);
    const original = timestamp(item.original_published_at ?? item.published_at);
    const temporal: ClassifiedNews['temporal_validity'] = cutoff === null || [available, fetched, published, firstSeen, original].some(value => value === null)
      ? 'timestamp_unverified' : [available!, fetched!, published!, firstSeen!, original!].some(value => value > cutoff) ? 'after_cutoff' : 'valid_at_cutoff';
    const effective = item.duplicate_group && temporal === 'valid_at_cutoff' ? originalByGroup.get(item.duplicate_group) ?? original : original;
    const freshness = effective === null || cutoff === null ? 'unknown' : cutoff - effective > freshHours * 3_600_000 ? 'old' : 'fresh';
    const confirmation = item.primary_confirmation;
    const verified = !!confirmation?.event_confirmed && !!safeNewsUrl(confirmation.url) && ['exchange', 'issuer', 'regulator'].includes(confirmation.source_type) && timestamp(confirmation.available_at) !== null && cutoff !== null && timestamp(confirmation.available_at)! <= cutoff && item.source_type !== 'ai_summary';
    const labels: NewsLabel[] = [], reasons: ClassifiedNews['classification_reasons'] = {};
    if (verified) { labels.push('verified_catalyst'); reasons.verified_catalyst = 'Peristiwa dikonfirmasi pengumuman sumber primer yang dapat ditelusuri. Dampak harga dan keuntungan tidak terjamin.'; }
    else if (item.unconfirmed_claim) { labels.push('rumor'); reasons.rumor = 'Klaim spesifik belum dikonfirmasi sumber primer; label ini tidak menyatakan informasinya palsu.'; }
    if (freshness === 'old') { labels.push('old_news'); reasons.old_news = `Publikasi substansi asli melewati kebijakan freshness ${freshHours} jam; publikasi ulang tidak mengubah umur berita.`; }
    const eventAt = timestamp(item.event_at), activeUntil = timestamp(item.event_risk?.active_until);
    const inHorizon = cutoff !== null && horizon !== null && ((eventAt !== null && eventAt >= cutoff && eventAt <= horizon) || (eventAt !== null && eventAt <= cutoff && activeUntil !== null && activeUntil >= cutoff));
    if (item.event_risk && safeNewsUrl(item.event_risk.source_url) && inHorizon) {
      labels.push('event_risk'); reasons.event_risk = `${item.event_risk.reason}${item.event_risk.category.toUpperCase() === 'UMA' ? ' UMA tidak otomatis berarti pelanggaran atau suspensi.' : ''}`;
    }
    return { ...item, title: String(item.title).slice(0, 1000), publisher: item.publisher?.slice(0, 300) ?? null, url: safeNewsUrl(item.url),
      primary_confirmation: confirmation ? { ...confirmation, url: safeNewsUrl(confirmation.url) ?? '' } : null,
      event_risk: item.event_risk ? { ...item.event_risk, source_url: safeNewsUrl(item.event_risk.source_url) ?? '' } : null,
      verification_status: verified ? 'primary_confirmed' : item.unconfirmed_claim ? 'unconfirmed_claim' : 'unverified', freshness, labels, classification_reasons: reasons,
      impact_direction: item.impact_direction ?? 'unknown', temporal_validity: temporal, decision_eligible: temporal === 'valid_at_cutoff',
      classification_version: NEWS_CLASSIFICATION_VERSION, effective_published_at: effective === null ? null : new Date(effective).toISOString(), ai_version: item.ai_version ?? null };
  });
  const items = classified.filter(item => item.temporal_validity !== 'after_cutoff');
  const monitoring_updates = classified.filter(item => item.temporal_validity === 'after_cutoff');
  const status: NewsStatus = items.some(item => item.temporal_validity === 'timestamp_unverified') ? 'timestamp_unverified' : items.length ? 'completed' : 'no_relevant_news';
  return { status, items, monitoring_updates, information_cutoff_at: context.informationCutoffAt, fetched_at: context.fetchedAt ?? null, classification_version: NEWS_CLASSIFICATION_VERSION,
    reason: status === 'timestamp_unverified' ? 'Waktu publikasi atau ketersediaan sebagian berita tidak dapat diverifikasi; berita tersebut tidak menjadi bukti keputusan.' : status === 'no_relevant_news' ? 'Tidak ditemukan berita relevan yang tersedia pada cutoff dari sumber yang berhasil diperiksa.' : 'Label berasal dari bukti terstruktur; verifikasi, freshness, arah dampak, dan risiko dinilai terpisah.' };
}

/** Existing AI citations lack original publication times/primary confirmation. Preserve that uncertainty. */
export function unverifiedStoryNewsEnrichment(story: { sources?: Array<{ title: string; uri: string }>; status?: string; created_at?: string } | null, context: NewsClassificationContext): NewsEnrichment {
  if (!story) return unavailableNewsEnrichment(context.informationCutoffAt);
  if (story.status === 'error') return unavailableNewsEnrichment(context.informationCutoffAt, 'failed');
  if (story.status === 'processing' || story.status === 'pending') return unavailableNewsEnrichment(context.informationCutoffAt, 'pending');
  if (story.sources != null && !Array.isArray(story.sources)) return unavailableNewsEnrichment(context.informationCutoffAt, 'failed');
  if (!story.sources?.length) return unavailableNewsEnrichment(context.informationCutoffAt);
  const sources = story.sources.filter(source => source && typeof source.title === 'string' && typeof source.uri === 'string');
  if (sources.length !== story.sources.length) return unavailableNewsEnrichment(context.informationCutoffAt, 'failed');
  return classifyNews(sources.map((source, index) => ({ news_id: `ai-citation:${context.symbol}:${source.uri}:${index}`, symbol: context.symbol,
    title: source.title, publisher: null, url: source.uri, source_type: 'ai_summary', published_at: null, first_seen_at: null, fetched_at: null, available_at: null })), context);
}
