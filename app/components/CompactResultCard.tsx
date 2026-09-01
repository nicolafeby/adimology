'use client';

import type { StockAnalysisResult } from '@/lib/types';

interface CompactResultCardProps {
  result: StockAnalysisResult;
  onCopyText?: () => void;
  onCopyImage?: () => void;
  copiedText?: boolean;
  copiedImage?: boolean;
}

export default function CompactResultCard({ 
  result, 
  onCopyText, 
  onCopyImage, 
  copiedText, 
  copiedImage 
}: CompactResultCardProps) {
  const { input, stockbitData, marketData, calculated } = result;

  const formatNumber = (num: number | null | undefined) => num?.toLocaleString() ?? '-';
  
  const calculateGain = (target: number) => {
    const gain = ((target - marketData.harga) / marketData.harga) * 100;
    return `${gain >= 0 ? '+' : ''}${gain.toFixed(2)}`;
  };

  return (
    <div className="compact-card" style={{ display: 'flex', flexDirection: 'column', padding: 0 }}>
      {/* Content Wrapper */}
      <div style={{ flex: 1, overflow: 'hidden', padding: '1rem' }}>
        {/* Header */}
        <div className="compact-header">
          <div style={{ display: 'flex', gap: '1rem', alignItems: 'flex-start', flex: 1, minWidth: 0 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="compact-ticker">+ {input.emiten.toUpperCase()}</div>
              {result.sector && (
                <div style={{ 
                  fontSize: '0.7rem', 
                  color: 'var(--text-muted)', 
                  marginTop: '2px',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis'
                }}>
                  {result.sector}
                </div>
              )}
            </div>
          </div>
          
          <div style={{ textAlign: 'right' }}>
            <div style={{ 
              fontSize: '0.85rem', 
              fontWeight: 800, 
              color: 'var(--text-muted)',
              textTransform: 'uppercase',
              letterSpacing: '1px',
              marginBottom: '4px',
              opacity: 0.8
            }}>
              Cocokologi
            </div>
            <div className="compact-date">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.7 }}>
                <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
                <line x1="16" y1="2" x2="16" y2="6"></line>
                <line x1="8" y1="2" x2="8" y2="6"></line>
                <line x1="3" y1="10" x2="21" y2="10"></line>
              </svg>
              {input.fromDate} — {input.toDate}
            </div>
          </div>
        </div>

        {/* Top Broker Section */}
        <div className="compact-section">
          <div className="compact-section-title">Top Broker</div>
          <div className="compact-grid-3">
            <div className="compact-cell">
              <span className="compact-label">Bandar</span>
              <span className="compact-value compact-badge-primary">{stockbitData.bandar}</span>
            </div>
            <div className="compact-cell">
              <span className="compact-label">Barang</span>
              <span className="compact-value">{formatNumber(stockbitData.barangBandar)} lot</span>
            </div>
            <div className="compact-cell">
              <span className="compact-label">Avg Harga</span>
              <span className="compact-value">Rp {formatNumber(stockbitData.rataRataBandar)}</span>
              {stockbitData.rataRataBandar && marketData.harga && (
                <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)', marginTop: '2px', display: 'block' }}>
                  {marketData.harga >= stockbitData.rataRataBandar ? '+' : ''}{(((marketData.harga - stockbitData.rataRataBandar) / stockbitData.rataRataBandar) * 100).toFixed(1)}%
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Market Data Section */}
        <div className="compact-section">
          <div className="compact-section-title">Market Data</div>
          <div className="compact-grid-3">
            <div className="compact-cell">
              <span className="compact-label">Harga</span>
              <span className="compact-value">Rp {formatNumber(marketData.harga)}</span>
            </div>
            <div className="compact-cell">
              <span className="compact-label">Offer Max</span>
              <span className="compact-value">Rp {formatNumber(marketData.offerTeratas)}</span>
            </div>
            <div className="compact-cell">
              <span className="compact-label">Bid Min</span>
              <span className="compact-value">Rp {formatNumber(marketData.bidTerbawah)}</span>
            </div>
          </div>
          <div className="compact-grid-3">
            <div className="compact-cell">
              <span className="compact-label">Fraksi</span>
              <span className="compact-value">{formatNumber(marketData.fraksi)}</span>
            </div>
            <div className="compact-cell">
              <span className="compact-label">Total Bid</span>
              <span className="compact-value">{formatNumber(marketData.totalBid / 100)}</span>
            </div>
            <div className="compact-cell">
              <span className="compact-label">Total Offer</span>
              <span className="compact-value">{formatNumber(marketData.totalOffer / 100)}</span>
            </div>
          </div>
        </div>

        {/* Calculations Section */}
        <div className="compact-section">
          <div className="compact-section-title">Calculations</div>
          <div className="compact-grid-2">
            <div className="compact-cell">
              <span className="compact-label">Total Papan</span>
              <span className="compact-value">{formatNumber(calculated.totalPapan)}</span>
            </div>
            <div className="compact-cell">
              <span className="compact-label">Rata² Bid/Offer</span>
              <span className="compact-value">{formatNumber(calculated.rataRataBidOfer)}</span>
            </div>
          </div>
          <div className="compact-grid-2">
            <div className="compact-cell">
              <span className="compact-label">a (5% avg bandar)</span>
              <span className="compact-value">{formatNumber(calculated.a)}</span>
            </div>
            <div className="compact-cell">
              <span className="compact-label">p (Barang/Avg)</span>
              <span className="compact-value">{formatNumber(calculated.p)}</span>
            </div>
          </div>
        </div>

        {/* Target Section */}
        <div className="compact-section" style={{ borderBottom: 'none', marginBottom: 0, paddingBottom: '1.5rem' }}>
          <div className="compact-section-title">Target Prices</div>
          <div className="compact-grid-2">
            <div className="compact-cell compact-target-cell">
              <span className="compact-label">Target Realistis</span>
              <div className="compact-target">
                <span className="compact-target-value compact-badge-success">{calculated.targetRealistis1}</span>
                <span className="compact-target-gain">{calculateGain(calculated.targetRealistis1)}%</span>
              </div>
            </div>
            <div className="compact-cell compact-target-cell">
              <span className="compact-label">Target Max</span>
              <div className="compact-target">
                <span className="compact-target-value compact-badge-warning">{calculated.targetMax}</span>
                <span className="compact-target-gain">{calculateGain(calculated.targetMax)}%</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Actions Footer - Fixed at bottom */}
      <div className="compact-footer" data-html2canvas-ignore="true" style={{ margin: 0, borderRadius: '0 0 20px 20px' }}>
        <button 
          className={`compact-action-btn ${copiedText ? 'active' : ''}`}
          onClick={onCopyText}
        >
          {copiedText ? (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12"></polyline>
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
            </svg>
          )}
          {copiedText ? 'Copied Text' : 'Copy Text'}
        </button>
        <button 
          className={`compact-action-btn ${copiedImage ? 'active' : ''}`}
          onClick={onCopyImage}
        >
          {copiedImage ? (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12"></polyline>
            </svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
              <circle cx="8.5" cy="8.5" r="1.5"></circle>
              <polyline points="21 15 16 10 5 21"></polyline>
            </svg>
          )}
          {copiedImage ? 'Copied Image' : 'Copy Image'}
        </button>
      </div>
    </div>
  );
}
