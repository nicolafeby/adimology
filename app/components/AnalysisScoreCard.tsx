import type { ComprehensiveAnalysis } from '@/lib/types';

const formatMetric = (value: number | string | null, unit?: string) => {
  if (value === null) return '—';
  const formatted = typeof value === 'number' ? value.toLocaleString('id-ID') : value;
  return unit ? `${formatted} ${unit}` : formatted;
};

export default function AnalysisScoreCard({ analysis }: { analysis: ComprehensiveAnalysis }) {
  const completeness = analysis.dataCompleteness ?? analysis.confidence;
  const indicators = [
    { label: 'Kelengkapan data', value: completeness, title: 'Persentase bobot komponen yang datanya tersedia.' },
    { label: 'Confidence', value: analysis.confidence, title: 'Reliabilitas bukti di dalam komponen yang tersedia.' },
    { label: 'Agreement', value: analysis.agreement ?? 0, title: 'Keselarasan skor antar-komponen yang tersedia.' },
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
            <span>{indicator.label}</span><strong>{indicator.value}%</strong>
            <div><i style={{ width: `${indicator.value}%` }} /></div>
          </div>
        ))}
      </div>
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
