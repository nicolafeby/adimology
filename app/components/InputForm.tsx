'use client';

import { useState, useEffect } from 'react';
import type { StockInput } from '@/lib/types';
import { getDefaultDate } from '@/lib/utils';
import { Check, X, Minus } from 'lucide-react';

interface InputFormProps {
  onSubmit: (data: StockInput) => void;
  loading: boolean;
  initialEmiten?: string | null;
  fromDate: string;
  toDate: string;
  onDateChange: (fromDate: string, toDate: string) => void;
  // Action Button Props
  onCopyText?: () => void;
  onCopyImage?: () => void;
  onAnalyzeAI?: () => void;
  copiedText?: boolean;
  copiedImage?: boolean;
  storyStatus?: 'idle' | 'pending' | 'processing' | 'completed' | 'error';
  hasResult?: boolean;
}

let inFlightFlagFetch: Record<string, Promise<any>> = {};

export default function InputForm({
  onSubmit,
  loading,
  initialEmiten,
  fromDate,
  toDate,
  onDateChange,
  onCopyText,
  onCopyImage,
  onAnalyzeAI,
  copiedText,
  copiedImage,
  storyStatus,
  hasResult
}: InputFormProps) {
  const [emiten, setEmiten] = useState('SOCI');
  const [currentFlag, setCurrentFlag] = useState<'OK' | 'NG' | 'Neutral' | null>(null);

  useEffect(() => {
    if (initialEmiten) {
      setEmiten(initialEmiten.toUpperCase());
    }
  }, [initialEmiten]);

  // Fetch current flag when emiten changes
  useEffect(() => {
    const fetchFlag = async () => {
      // Standard IDX ticker is 4 characters
      if (!emiten || emiten.length !== 4) {
        setCurrentFlag(null);
        return;
      }

      // Check if this specific emiten is already being fetched
      const existingFetch = inFlightFlagFetch[emiten];
      if (existingFetch) {
        const json = await existingFetch;
        if (json && json.success) {
          setCurrentFlag(json.flag);
        }
        return;
      }

      const fetchPromise = (async () => {
        try {
          const res = await fetch(`/api/emiten/flag?emiten=${emiten}`);
          const json = await res.json();
          if (json.success) {
            setCurrentFlag(json.flag);
          }
          return json;
        } catch (err) {
          console.error('Error fetching flag:', err);
          throw err;
        } finally {
          delete inFlightFlagFetch[emiten];
        }
      })();

      inFlightFlagFetch[emiten] = fetchPromise;
      await fetchPromise;
    };
    fetchFlag();
  }, [emiten]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({ emiten, fromDate, toDate });
  };

  const setDateRange = (days: number) => {
    const end = new Date();
    const start = new Date();

    // If days is 0 (1D), it means just today for both
    if (days === 0) {
      // both are today, already default
      // but maybe we want to force reset to today
    } else {
      start.setDate(end.getDate() - days);
    }

    // Format YYYY-MM-DD
    const formatDate = (d: Date) => d.toISOString().split('T')[0];

    onDateChange(formatDate(start), formatDate(end));
  };

  const handleFlag = async (flag: 'OK' | 'NG' | 'Neutral') => {
    if (!emiten) return;
    try {
      const res = await fetch('/api/emiten/flag', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ emiten, flag }),
      });
      if (res.ok) {
        setCurrentFlag(flag);
        // Dispatch custom event to notify other components (like WatchlistSidebar)
        window.dispatchEvent(new CustomEvent('emiten-flagged', {
          detail: { emiten, flag }
        }));
      }
    } catch (err) {
      console.error('Error flagging emiten:', err);
    }
  };

  return (
    <div className="glass-card-static compact-form">
      <form onSubmit={handleSubmit}>
        <div className="compact-form-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--accent-primary)' }}>
              <circle cx="11" cy="11" r="8"></circle>
              <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
            </svg>
            <h3 style={{ textTransform: 'uppercase', letterSpacing: '1px', fontSize: '0.85rem' }}>Analyze Stock</h3>
          </div>
          <div className="quick-dates">
            <button type="button" onClick={() => setDateRange(0)} className="quick-date-btn">1D</button>
            <button type="button" onClick={() => setDateRange(7)} className="quick-date-btn">1W</button>
            <button type="button" onClick={() => setDateRange(30)} className="quick-date-btn">1M</button>
          </div>
        </div>

        <div className="compact-form-row">
          <div className="input-group compact-group" style={{ flex: '1 1 140px', minWidth: '120px' }}>
            <label htmlFor="emiten" className="input-label compact-label">
              Emiten
            </label>
            <div className="input-field compact-input emiten-focus-wrapper" style={{
              display: 'flex',
              alignItems: 'center',
              padding: '0 0.5rem',
              gap: '0.2rem',
              transition: 'all 0.2s ease',
              position: 'relative'
            }}>
              <input
                id="emiten"
                type="text"
                value={emiten}
                onChange={(e) => setEmiten(e.target.value.toUpperCase())}
                onFocus={(e) => e.currentTarget.parentElement?.style.setProperty('border-color', 'var(--accent-primary)')}
                onBlur={(e) => e.currentTarget.parentElement?.style.setProperty('border-color', 'var(--border-color)')}
                placeholder="CODE"
                required
                style={{
                  flex: 1,
                  background: 'transparent',
                  border: 'none',
                  outline: 'none',
                  padding: '4px 0',
                  color: 'inherit',
                  fontSize: '0.85rem',
                  fontWeight: '700',
                  width: '100%',
                  letterSpacing: '0.5px'
                }}
              />
              <div style={{ display: 'flex', alignItems: 'center', opacity: currentFlag ? 1 : 0, transition: 'opacity 0.2s' }}>
                {currentFlag === 'OK' && <Check size={14} color="#3b82f6" strokeWidth={3} />}
                {currentFlag === 'NG' && <X size={14} color="#f97316" strokeWidth={3} />}
                {currentFlag === 'Neutral' && <Minus size={14} color="var(--text-secondary)" strokeWidth={3} />}
              </div>
            </div>
          </div>

          <div className="input-group compact-group" style={{ flex: '1 1 210px', minWidth: '200px' }}>
            <label className="input-label compact-label">
              Date Range
            </label>
            <div className="date-range-group" style={{ height: '38px', borderRadius: '12px' }}>
              <input
                id="fromDate"
                type="date"
                className="input-field compact-input"
                style={{ padding: '0', fontSize: '0.75rem', width: '95px', textAlign: 'center' }}
                value={fromDate}
                onChange={(e) => onDateChange(e.target.value, toDate)}
                onClick={(e) => e.currentTarget.showPicker()}
                required
              />
              <span className="date-separator" style={{ margin: '0 1px', padding: 0 }}>→</span>
              <input
                id="toDate"
                type="date"
                className="input-field compact-input"
                style={{ padding: '0', fontSize: '0.75rem', width: '95px', textAlign: 'center' }}
                value={toDate}
                onChange={(e) => onDateChange(fromDate, e.target.value)}
                onClick={(e) => e.currentTarget.showPicker()}
                required
              />
            </div>
          </div>

          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <button
              type="submit"
              disabled={loading}
              className="solid-btn"
              style={{
                minWidth: '100px',
                height: '38px',
                fontSize: '0.8rem',
                fontWeight: '600',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: '8px',
                cursor: loading ? 'not-allowed' : 'pointer',
                background: 'var(--accent-primary)',
                color: 'white',
                border: '1px solid var(--accent-primary)',
                boxShadow: '0 4px 12px rgba(124, 58, 237, 0.3)',
                opacity: loading ? 0.6 : 1
              }}
            >
              {loading ? '...' : 'Cocokologi'}
            </button>

            <button
              type="button"
              onClick={onAnalyzeAI}
              disabled={storyStatus === 'pending' || storyStatus === 'processing' || !hasResult}
              className="solid-btn"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '0.4rem',
                padding: '0 1rem',
                fontSize: '0.8rem',
                fontWeight: '600',
                borderRadius: '8px',
                background: '#4f46e5', // Solid shade for Analyze
                color: 'white',
                border: '1px solid #4f46e5',
                cursor: 'pointer',
                opacity: hasResult ? 1 : 0.5,
                pointerEvents: hasResult ? 'auto' : 'none',
                whiteSpace: 'nowrap',
                boxShadow: '0 4px 12px rgba(79, 70, 229, 0.3)'
              }}
            >
              {storyStatus === 'pending' || storyStatus === 'processing' ? (
                <span style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                  ⏳ Analyzing...
                </span>
              ) : (
                <>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 2L15.09 8.26L22 9.27L17 14.14L18.18 21.02L12 17.77L5.82 21.02L7 14.14L2 9.27L8.91 8.26L12 2Z"></path>
                  </svg>
                  Analyze Story
                </>
              )}
            </button>
          </div>

          {/* Flagging Buttons */}
          <div className="flag-container" style={{ 
            display: 'flex', 
            gap: '0.4rem', 
            marginLeft: 'auto', 
            borderLeft: '1px solid var(--border-color)', 
            paddingLeft: '0.8rem',
            alignItems: 'center'
          }}>
            <button
              type="button"
              onClick={() => handleFlag('OK')}
              title="Mark as OK"
              className="flag-btn"
              style={{
                width: '38px',
                height: '38px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: '8px',
                cursor: 'pointer',
                background: currentFlag === 'OK' ? '#3b82f6' : 'rgba(59, 130, 246, 0.1)',
                color: currentFlag === 'OK' ? 'white' : '#3b82f6',
                border: `1px solid ${currentFlag === 'OK' ? '#3b82f6' : 'rgba(59, 130, 246, 0.3)'}`,
                boxShadow: currentFlag === 'OK' ? '0 4px 10px rgba(59, 130, 246, 0.4)' : 'none'
              }}
            >
              <Check size={22} strokeWidth={3} />
            </button>
            <button
              type="button"
              onClick={() => handleFlag('NG')}
              title="Mark as NG"
              className="flag-btn"
              style={{
                width: '38px',
                height: '38px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: '8px',
                cursor: 'pointer',
                background: currentFlag === 'NG' ? '#f97316' : 'rgba(249, 115, 22, 0.1)',
                color: currentFlag === 'NG' ? 'white' : '#f97316',
                border: `1px solid ${currentFlag === 'NG' ? '#f97316' : 'rgba(249, 115, 22, 0.3)'}`,
                boxShadow: currentFlag === 'NG' ? '0 4px 10px rgba(249, 115, 22, 0.4)' : 'none'
              }}
            >
              <X size={22} strokeWidth={3} />
            </button>
            <button
              type="button"
              onClick={() => handleFlag('Neutral')}
              title="Mark as Neutral"
              className="flag-btn"
              style={{
                width: '38px',
                height: '38px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: '8px',
                cursor: 'pointer',
                background: currentFlag === 'Neutral' ? 'var(--text-secondary)' : 'var(--glass-inner-glow)',
                color: currentFlag === 'Neutral' ? 'white' : 'var(--text-secondary)',
                border: `1px solid ${currentFlag === 'Neutral' ? 'var(--text-secondary)' : 'var(--border-color)'}`,
                boxShadow: currentFlag === 'Neutral' ? '0 4px 10px rgba(0, 0, 0, 0.1)' : 'none'
              }}
            >
              <Minus size={22} strokeWidth={3} />
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
