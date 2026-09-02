'use client';

import { useState, useEffect, useRef } from 'react';
import type { BackgroundJobLog } from '@/lib/types';

let inFlightFetch: Promise<any> | null = null;

export default function JobStatusIndicator() {
  const [latestLog, setLatestLog] = useState<BackgroundJobLog | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  const [isRetrying, setIsRetrying] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const fetchStatus = async () => {
    if (inFlightFetch) {
      const data = await inFlightFetch;
      if (data && data.success && data.data.length > 0) {
        setLatestLog(data.data[0]);
      }
      return data;
    }

    inFlightFetch = (async () => {
      try {
        const res = await fetch('/api/job-logs?limit=1');
        const data = await res.json();
        if (data.success && data.data.length > 0) {
          setLatestLog(data.data[0]);
        }
        return data;
      } catch (error) {
        console.error('Failed to fetch job status', error);
        throw error;
      } finally {
        inFlightFetch = null;
      }
    })();

    return inFlightFetch;
  };

  const handleRetry = async () => {
    if (!latestLog || isRetrying) return;

    setIsRetrying(true);
    try {
      const supportedJobs = ['analyze-watchlist', 'analyze-story'];
      if (!supportedJobs.includes(latestLog.job_name)) {
        alert(`Retry belum didukung untuk job: ${latestLog.job_name}`);
        return;
      }

      const emiten = [...(latestLog.log_entries || [])]
        .reverse()
        .find((entry) => entry.emiten)?.emiten;

      if (latestLog.job_name === 'analyze-story' && !emiten) {
        alert('Kode emiten tidak ditemukan pada log job ini.');
        return;
      }

      const res = await fetch('/api/job-retry', { 
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobName: latestLog.job_name, emiten })
      });
      const data = await res.json();
      
      if (res.ok && data.success) {
        // Immediately fetch status to show "running"
        await fetchStatus();
      } else {
        alert(`Failed to retry job: ${data.error || 'Unknown error'}`);
      }
    } catch (error) {
      console.error('Failed to retry job', error);
      alert('Failed to retry job. check console for details.');
    } finally {
      setIsRetrying(false);
    }
  };

  useEffect(() => {
    fetchStatus();
    const intervalId = setInterval(fetchStatus, 30000); // 30s
    return () => clearInterval(intervalId);
  }, []);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setShowDetails(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  if (!latestLog) return null;

  const isRunning = latestLog.status === 'running';
  const isFailed = latestLog.status === 'failed';
  const isCompleted = latestLog.status === 'completed';

  const statusClass = isRunning ? 'warning' : isFailed ? 'error' : 'good';
  const statusLabel = isRunning ? 'Job Running' : isFailed ? 'Job Failed' : 'Jobs Idle';

  return (
    <div style={{ position: 'relative' }} ref={containerRef}>
      <div
        className="token-status-pill"
        onClick={() => setShowDetails(!showDetails)}
        style={{ cursor: 'pointer' }}
      >
        <div className={`token-dot ${statusClass}`} />
        <span style={{ 
          color: isFailed ? '#ff4d4d' : isRunning ? 'var(--accent-orange)' : 'var(--accent-success)',
          whiteSpace: 'nowrap'
        }}>
          {statusLabel}
        </span>
      </div>

      {showDetails && (
        <div className="token-popup" style={{ width: '320px', padding: '1rem' }}>
          <div className="token-popup-title">
            <span>Latest Job Run</span>
            <div className={`token-dot ${statusClass}`} />
          </div>

          <div className="token-info-row">
            <span>Job:</span>
            <span className="token-info-value">{latestLog.job_name}</span>
          </div>

          <div className="token-info-row">
            <span>Started:</span>
            <span className="token-info-value">
              {new Date(latestLog.started_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
          </div>

          <div className="token-info-row">
            <span>Stats:</span>
            <span className="token-info-value">
              <span style={{ color: 'var(--accent-success)' }}>✓{latestLog.success_count}</span>
              {latestLog.error_count > 0 && (
                <span style={{ color: '#ff4d4d', marginLeft: '8px' }}>✕{latestLog.error_count}</span>
              )}
            </span>
          </div>

          {latestLog.status === 'failed' && latestLog.error_message && (
            <div className="job-error-banner" style={{ marginTop: '0.75rem' }}>
              <span className="error-icon">⚠</span>
              {latestLog.error_message}
            </div>
          )}

          <div style={{ marginTop: '1rem', borderTop: '1px solid var(--border-color)', paddingTop: '0.75rem' }}>
            <div style={{ 
              fontSize: '0.65rem', 
              color: 'var(--text-muted)', 
              marginBottom: '0.5rem',
              textTransform: 'uppercase',
              letterSpacing: '0.5px'
            }}>
              Recent logs
            </div>
            <div 
              style={{ 
                maxHeight: '150px', 
                overflowY: 'auto',
                fontSize: '0.65rem',
                fontFamily: 'monospace'
              }}
              className="log-entries-scroll"
            >
              {latestLog.log_entries && latestLog.log_entries.length > 0 ? (
                latestLog.log_entries.slice(-5).map((entry, idx) => (
                  <div key={idx} className={`log-entry-line level-${entry.level}`}>
                    <span>[{entry.emiten || 'SYS'}]</span>
                    <span>{entry.message}</span>
                  </div>
                ))
              ) : (
                <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '1rem' }}>
                  No logs available
                </div>
              )}
            </div>
          </div>

          {!isRunning && (
            <button 
              className="token-action-btn"
              style={{ 
                marginTop: '1rem',
                opacity: isRetrying ? 0.7 : 1,
                cursor: isRetrying ? 'not-allowed' : 'pointer'
              }}
              onClick={handleRetry}
              disabled={isRetrying}
            >
              {isRetrying ? 'Triggering...' : isFailed ? 'Retry Failed Job' : 'Run Job Again'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
