'use client';

import { useState, useEffect } from 'react';
import { getBrokerInfo } from '@/lib/brokers';

interface SummaryRecord {
  emiten: string;
  sector?: string;
  tradingDays: number;
  evaluatedDays: number;
  hitR1: number;
  hitMax: number;
  hitRateR1: number | null;
  hitRateMax: number | null;
  totalHitRate: number | null;
  topBandars: { name: string; count: number }[];
}

const ROW_COUNT_OPTIONS = [3, 5, 10, 20, 50];
const HEADER_HEIGHT = 45;
const ROW_HEIGHT = 65;

const getBrokerColor = (code: string) => {
  if (!code) return 'transparent';
  const uCode = code.toUpperCase();

  // Explicit overrides for key brokers to ensure absolute distinction
  const overrides: Record<string, string> = {
    'XL': 'hsla(345, 85%, 82%, 0.45)',  // Soft Red/Pink
    'CC': 'hsla(145, 85%, 82%, 0.45)',  // Soft Emerald Green
    'ZP': 'hsla(265, 85%, 82%, 0.45)',  // Soft Purple/Violet
    'AK': 'hsla(200, 85%, 82%, 0.45)',  // Soft Blue
    'MG': 'hsla(25, 85%, 82%, 0.45)',   // Soft Orange
    'YP': 'hsla(180, 85%, 82%, 0.45)',  // Soft Cyan/Teal
    'PD': 'hsla(55, 85%, 82%, 0.45)',   // Soft Gold/Yellow
    'AZ': 'hsla(100, 85%, 82%, 0.45)',  // Soft Lime
  };

  if (overrides[uCode]) return overrides[uCode];

  // Fallback for other brokers using improved distribution
  let hash = 0;
  for (let i = 0; i < uCode.length; i++) {
    hash += uCode.charCodeAt(i);
    hash += (hash << 10);
    hash ^= (hash >> 6);
  }
  const ratio = 0.618033988749895;
  const hue = Math.floor(((Math.abs(hash) * ratio) % 1) * 360);
  return `hsla(${hue}, 75%, 80%, 0.35)`;
};

export default function EmitenSummaryCard() {
  const [data, setData] = useState<SummaryRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [limit, setLimit] = useState(5);

  useEffect(() => {
    fetchSummary();
  }, [limit]);

  const fetchSummary = async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/summary?limit=${limit}`);
      const json = await response.json();
      if (json.success) {
        setData(json.data || []);
      }
    } catch (error) {
      console.error('Error fetching summary stats:', error);
    } finally {
      setLoading(false);
    }
  };

  const formatPercent = (val: number | null) => val == null ? 'Belum dinilai' : `${val.toFixed(1)}%`;

  const renderBandarCell = (bandarObj?: { name: string; count: number }) => {
    if (!bandarObj) return <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>-</span>;
    const info = getBrokerInfo(bandarObj.name);
    const typeLabel = info.type === 'Smartmoney' ? 'Smart Money' : info.type;

    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <span style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: '0.85rem' }}>{bandarObj.name}</span>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-primary)', fontWeight: 700, opacity: 0.9 }}>({bandarObj.count})</span>
        </div>
        <div style={{
          fontSize: '0.65rem',
          color: 'var(--text-primary)',
          background: 'rgba(255, 255, 255, 0.1)',
          padding: '1px 6px',
          borderRadius: '4px',
          whiteSpace: 'nowrap',
          marginTop: '2px',
          backdropFilter: 'brightness(1.2)'
        }}>
          {typeLabel}
        </div>
      </div>
    );
  };

  if (loading) {
    return (
      <div className="glass-card" style={{ padding: '2rem', textAlign: 'center' }}>
        <div className="spinner" style={{ margin: '0 auto 1rem' }}></div>
        <p style={{ color: 'var(--text-secondary)' }}>Memuat ringkasan performa...</p>
      </div>
    );
  }

  return (
    <div className="glass-card-static" style={{ marginBottom: '1rem' }}>
      <div className="broker-flow-header">
        <span className="broker-flow-title">🎯 Emiten Hit Target Rate ({limit} Hari Terakhir)</span>
        <div className="broker-flow-filters">
          {ROW_COUNT_OPTIONS.map((option) => (
            <button
              key={option}
              onClick={() => setLimit(option)}
              className={`broker-flow-filter-btn ${limit === option ? 'active' : ''}`}
            >
              {option}
            </button>
          ))}
        </div>
      </div>

      <div style={{
        border: '1px solid var(--border-color)',
        borderRadius: '12px',
        overflow: 'hidden',
        background: 'var(--bg-card)'
      }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead style={{ background: 'var(--bg-secondary)', height: `${HEADER_HEIGHT}px`, borderBottom: '1px solid var(--border-color)' }}>
              <tr>
                <th style={{ padding: '0 1rem', textAlign: 'left', fontSize: '0.85rem', color: 'var(--text-secondary)', fontWeight: 600 }}>Emiten</th>
                <th title="Sudah dievaluasi / total data" style={{ padding: '0 1rem', textAlign: 'center', fontSize: '0.85rem', color: 'var(--text-secondary)', fontWeight: 600 }}>Dinilai/Data</th>
                <th style={{ padding: '0 1rem', textAlign: 'center', fontSize: '0.85rem', color: 'var(--text-secondary)', fontWeight: 600 }}>Hit R1</th>
                <th style={{ padding: '0 1rem', textAlign: 'center', fontSize: '0.85rem', color: 'var(--text-secondary)', fontWeight: 600 }}>Hit Max</th>
                <th style={{ padding: '0 1rem', textAlign: 'center', fontSize: '0.85rem', color: 'var(--text-secondary)', fontWeight: 600 }}>R1 Rate</th>
                <th style={{ padding: '0 1rem', textAlign: 'center', fontSize: '0.85rem', color: 'var(--text-secondary)', fontWeight: 600 }}>Max Rate</th>
                <th style={{ padding: '0 1rem', textAlign: 'right', fontSize: '0.85rem', color: 'var(--text-secondary)', fontWeight: 600 }}>Total Rate</th>
                <th style={{ padding: '0 1rem', textAlign: 'center', fontSize: '0.85rem', color: 'var(--text-secondary)', fontWeight: 600, borderLeft: '1px solid var(--border-color)' }}>Top 1</th>
                <th style={{ padding: '0 1rem', textAlign: 'center', fontSize: '0.85rem', color: 'var(--text-secondary)', fontWeight: 600 }}>Top 2</th>
                <th style={{ padding: '0 1rem', textAlign: 'center', fontSize: '0.85rem', color: 'var(--text-secondary)', fontWeight: 600 }}>Top 3</th>
              </tr>
            </thead>
            <tbody>
              {data.map((record, index) => (
                <tr
                  key={record.emiten}
                  className="summary-row"
                  style={{
                    height: `${ROW_HEIGHT}px`,
                    borderBottom: index < data.length - 1 ? '1px solid var(--border-color)' : 'none',
                    background: index % 2 === 0 ? 'transparent' : 'rgba(255, 255, 255, 0.025)',
                    transition: 'background 0.2s ease'
                  }}
                >
                  <td style={{ padding: '0 1rem' }}>
                    <a
                      href={`/?symbol=${record.emiten}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        fontWeight: 700,
                        color: 'var(--accent-primary)',
                        fontSize: '0.9rem',
                        textDecoration: 'none',
                        cursor: 'pointer',
                        display: 'inline-block'
                      }}
                      className="emiten-link"
                    >
                      {record.emiten}
                    </a>
                    {record.sector && (
                      <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '2px' }}>{record.sector}</div>
                    )}
                  </td>
                  <td style={{ padding: '0 1rem', textAlign: 'center', fontSize: '0.85rem', color: 'var(--text-primary)' }}>
                    <span title={`${record.evaluatedDays} dari ${record.tradingDays} data sudah dievaluasi`}>
                      {record.evaluatedDays}/{record.tradingDays}
                    </span>
                  </td>
                  <td style={{ padding: '0 1rem', textAlign: 'center', fontSize: '0.85rem', color: 'var(--accent-success)' }}>
                    {record.evaluatedDays > 0 ? record.hitR1 : '—'}
                  </td>
                  <td style={{ padding: '0 1rem', textAlign: 'center', fontSize: '0.85rem', color: 'var(--accent-warning)' }}>
                    {record.evaluatedDays > 0 ? record.hitMax : '—'}
                  </td>
                  <td style={{ padding: '0 1rem', textAlign: 'center', fontSize: '0.85rem', color: 'var(--accent-success)' }}>
                    {formatPercent(record.hitRateR1)}
                  </td>
                  <td style={{ padding: '0 1rem', textAlign: 'center', fontSize: '0.85rem', color: 'var(--accent-warning)' }}>
                    {formatPercent(record.hitRateMax)}
                  </td>
                  <td style={{ padding: '0 1rem', textAlign: 'right' }}>
                    <div style={{
                      fontSize: '0.85rem',
                      fontWeight: 700,
                      color: 'var(--text-primary)'
                    }}>
                      {formatPercent(record.totalHitRate)}
                    </div>
                  </td>
                  <td style={{
                    padding: '0 1rem',
                    textAlign: 'center',
                    borderLeft: '1px solid var(--border-color)',
                    background: record.topBandars[0] ? getBrokerColor(record.topBandars[0].name) : 'transparent'
                  }}>
                    {renderBandarCell(record.topBandars[0])}
                  </td>
                  <td style={{
                    padding: '0 1rem',
                    textAlign: 'center',
                    background: record.topBandars[1] ? getBrokerColor(record.topBandars[1].name) : 'transparent'
                  }}>
                    {renderBandarCell(record.topBandars[1])}
                  </td>
                  <td style={{
                    padding: '0 1rem',
                    textAlign: 'center',
                    background: record.topBandars[2] ? getBrokerColor(record.topBandars[2].name) : 'transparent'
                  }}>
                    {renderBandarCell(record.topBandars[2])}
                  </td>
                </tr>
              ))}
              {data.length === 0 && (
                <tr>
                  <td colSpan={10} style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                    Tidak ada data performa untuk periode ini.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
