import type { ComprehensiveAnalysis } from '@/lib/types';

const formatMetric = (value: number | string | null, unit?: string) => {
  if (value === null) return '—';
  const formatted = typeof value === 'number' ? value.toLocaleString('id-ID') : value;
  return unit ? `${formatted} ${unit}` : formatted;
};

export default function AnalysisScoreCard({ analysis }: { analysis: ComprehensiveAnalysis }) {
  const quality = analysis.quality;
  const completeness = analysis.dataCompleteness;
  const show = (value: number | null | undefined) => value == null ? 'Belum tersedia pada versi analisis ini' : `${value}%`;
  const indicators = [
    { label: 'Kelengkapan data', value: completeness, title: 'Berapa banyak input yang tersedia, termasuk coverage internal tiap komponen.' },
    { label: 'Kesepakatan sinyal', value: quality?.agreement.score, title: 'Seberapa selaras arah bullish, netral, atau bearish antar-komponen.' },
    { label: 'Confidence', value: quality?.confidence ?? analysis.confidence, title: 'Seberapa layak hasil dipercaya berdasarkan completeness, agreement, freshness, reliability, dan penalty.' },
    { label: 'Freshness', value: quality?.freshness.score, title: 'Kesegaran sumber yang memiliki timestamp asli.' },
    { label: 'Reliability', value: quality?.reliability.score, title: 'Kualitas, validitas, fallback, dan ukuran sampel data.' },
  ];
  return (
    <section className="analysis-score-card">
      <div className="analysis-score-header">
        <div><span>Analisis Multi-Faktor · {analysis.horizon}</span><h3>{analysis.label}</h3></div>
        <div className="analysis-score-gauge" aria-label={`Skor ${analysis.score} dari 100`}><strong>{analysis.score}</strong><span>/100</span></div>
      </div>
      <div className="analysis-indicators">
        {indicators.map((indicator) => (
          <div className="analysis-indicator" key={indicator.label} title={indicator.title}>
            <span>{indicator.label}</span><strong>{show(indicator.value)}</strong>
            <div><i style={{ width: `${indicator.value ?? 0}%` }} /></div>
          </div>
        ))}
      </div>
      {quality && <div className="analysis-warning"><strong>Arah dominan: {quality.dominantDirection}</strong> · Agreement {quality.agreement.label}</div>}
      {quality?.conflicts.length ? <div className="analysis-warning"><strong>Konflik utama:</strong><ul>{quality.conflicts.map((conflict) => <li key={conflict.key}>{conflict.message} ({conflict.severity})</li>)}</ul></div> : null}
      <div className="analysis-components">
        {analysis.components.map((component) => (
          <details className="analysis-component" key={component.key}>
            <summary>
              <span>{component.label} <small>{component.weight}%</small></span>
              <strong className={component.available ? '' : 'unavailable'}>{component.score === null ? 'Belum tersedia' : component.score}</strong>
            </summary>
            {component.metrics.length ? (
              <div className="analysis-metrics">{component.metrics.map((item) => (
                <div key={item.key} title={item.description}><span>{item.label}</span><strong className={`analysis-signal-${item.signal}`}>{formatMetric(item.value, item.unit)}</strong></div>
              ))}</div>
            ) : <p>Feed terstruktur belum tersedia; bobot ini tidak dimasukkan ke skor.</p>}
          </details>
        ))}
      </div>
      {analysis.warnings.map((warning) => <p className="analysis-warning" key={warning}>{warning}</p>)}
      <p className="analysis-disclaimer">Skor adalah alat bantu berbasis data, bukan rekomendasi membeli atau menjual.</p>
    </section>
  );
}
