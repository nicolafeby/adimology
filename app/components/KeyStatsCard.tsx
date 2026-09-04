'use client';

import type { KeyStatsData, KeyStatsItem } from '@/lib/types';

interface KeyStatsCardProps {
  emiten: string;
  keyStats: KeyStatsData;
}

export default function KeyStatsCard({ emiten, keyStats }: KeyStatsCardProps) {
  const itemCount = keyStats.currentValuation.length + keyStats.incomeStatement.length + keyStats.balanceSheet.length + keyStats.profitability.length + keyStats.growth.length;
  // Helper to render a stats section
  const renderSection = (title: string, items: KeyStatsItem[], maxItems: number = 5) => {
    if (!items || items.length === 0) return null;
    
    const displayItems = items.slice(0, maxItems);
    
    return (
      <div className="keystats-section">
        <div className="keystats-section-title">{title}</div>
        <table className="keystats-table">
          <tbody>
            {displayItems.map((item) => (
              <tr key={item.id}>
                <td className="keystats-label">{formatLabel(item.name)}</td>
                <td className="keystats-value">{item.value || '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  };

  // Format label to be shorter
  const formatLabel = (name: string): string => {
    return name
      .replace('Current ', '')
      .replace(' (TTM)', '')
      .replace(' (Quarter)', '')
      .replace(' (Quarter YoY Growth)', ' YoY')
      .replace('Price to ', 'P/')
      .replace('Ratio', '');
  };

  return (
    <div className="keystats-card">
      {/* Header */}
      <div className="compact-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--accent-primary)' }}>
            <line x1="18" y1="20" x2="18" y2="10"></line>
            <line x1="12" y1="20" x2="12" y2="4"></line>
            <line x1="6" y1="20" x2="6" y2="14"></line>
          </svg>
          <div className="compact-ticker" style={{ fontSize: '0.85rem', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Key Stats</div>
        </div>
        <div className="compact-date">{emiten.toUpperCase()}</div>
      </div>

      {/* Sections */}
      {itemCount === 0 && <div className="keystats-empty"><strong>Data belum tersedia</strong><p>{keyStats.warning ?? 'Stockbit tidak mengembalikan Key Stats untuk emiten ini.'}</p></div>}
      {renderSection('Current Valuation', keyStats.currentValuation, 6)}
      {renderSection('Income Statement', keyStats.incomeStatement, 4)}
      {renderSection('Balance Sheet', keyStats.balanceSheet, 5)}
      {renderSection('Profitability', keyStats.profitability, 3)}
      {renderSection('Growth', keyStats.growth, 3)}
    </div>
  );
}
