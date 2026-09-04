'use client';

interface TargetCardProps {
  emiten: string;
  sector?: string;
  currentPrice: number;
  targetRealistis: number | null;
  targetMax: number | null;
}

export default function TargetCard({ emiten, sector, currentPrice, targetRealistis, targetMax }: TargetCardProps) {
  const calculateGain = (target: number | null) => {
    if (target === null || currentPrice <= 0) return null;
    const gain = ((target - currentPrice) / currentPrice) * 100;
    return `${gain >= 0 ? '+' : ''}${gain.toFixed(2)}`;
  };

  return (
    <div className="glass-card">
      <h3>🎯 Target Prices</h3>
      <div style={{ marginTop: '0.5rem', marginBottom: '1rem' }}>
        <div style={{ fontSize: '1.25rem', fontWeight: '700', color: 'var(--accent-primary)' }}>
          {emiten}
        </div>
        {sector && (
          <div style={{ fontSize: '0.75rem', color: '#999', marginTop: '0.25rem' }}>
            {sector}
          </div>
        )}
      </div>
      
      <div className="grid grid-2" style={{ marginTop: '1rem' }}>
        {/* Target Realistis */}
        <div style={{
          background: 'var(--gradient-success)',
          borderRadius: '16px',
          padding: '2rem',
          textAlign: 'center',
          boxShadow: '0 4px 20px rgba(56, 239, 125, 0.3)'
        }}>
          <div style={{ 
            fontSize: '0.875rem', 
            fontWeight: '600',
            marginBottom: '0.5rem',
            textTransform: 'uppercase',
            letterSpacing: '1px'
          }}>
            Target Realistis
          </div>
          <div style={{ 
            fontSize: '3rem', 
            fontWeight: '700',
            marginBottom: '0.5rem'
          }}>
            {targetRealistis?.toLocaleString('id-ID') ?? '—'}
          </div>
          <div style={{ 
            fontSize: '1rem',
            opacity: 0.9
          }}>
            {calculateGain(targetRealistis) === null ? 'Depth pasar tidak tersedia' : `${calculateGain(targetRealistis)}% gain`}
          </div>
        </div>

        {/* Target Max */}
        <div style={{
          background: 'var(--gradient-warning)',
          borderRadius: '16px',
          padding: '2rem',
          textAlign: 'center',
          boxShadow: '0 4px 20px rgba(245, 87, 108, 0.3)'
        }}>
          <div style={{ 
            fontSize: '0.875rem', 
            fontWeight: '600',
            marginBottom: '0.5rem',
            textTransform: 'uppercase',
            letterSpacing: '1px'
          }}>
            Target Max
          </div>
          <div style={{ 
            fontSize: '3rem', 
            fontWeight: '700',
            marginBottom: '0.5rem'
          }}>
            {targetMax?.toLocaleString('id-ID') ?? '—'}
          </div>
          <div style={{ 
            fontSize: '1rem',
            opacity: 0.9
          }}>
            {calculateGain(targetMax) === null ? 'Depth pasar tidak tersedia' : `${calculateGain(targetMax)}% gain`}
          </div>
        </div>
      </div>
    </div>
  );
}
