'use client';

import { useEffect, useRef, useState } from 'react';

type GeminiStatus = {
  configured: boolean;
  connected: boolean;
  model: string;
  checkedAt: string;
  message: string;
};

export default function GeminiStatusIndicator() {
  const [status, setStatus] = useState<GeminiStatus | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;

    const fetchStatus = async () => {
      try {
        const response = await fetch('/api/gemini-status', { cache: 'no-store' });
        if (!response.ok) throw new Error(`Status request failed: ${response.status}`);
        const data: GeminiStatus = await response.json();
        if (active) setStatus(data);
      } catch (error) {
        console.error('Failed to fetch Gemini status:', error);
        if (active) {
          setStatus({
            configured: false,
            connected: false,
            model: 'gemini-3-flash-preview',
            checkedAt: new Date().toISOString(),
            message: 'Unable to check the Gemini API status.',
          });
        }
      }
    };

    fetchStatus();
    const intervalId = window.setInterval(fetchStatus, 60_000);
    return () => {
      active = false;
      window.clearInterval(intervalId);
    };
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

  const connected = status?.connected === true;
  const label = status ? (connected ? 'Gemini Connected' : 'Gemini Offline') : 'Gemini Checking';
  const statusClass = status ? (connected ? 'good' : 'error') : 'warning';
  const statusColor = status
    ? connected
      ? 'var(--accent-success)'
      : '#ff4d4d'
    : 'var(--accent-orange)';

  return (
    <div className="status-indicator-container" ref={containerRef}>
      <button
        type="button"
        className="token-status-pill status-pill-button"
        onClick={() => setShowDetails((visible) => !visible)}
        aria-expanded={showDetails}
        aria-label="Gemini API status"
      >
        <span className={`token-dot ${statusClass}`} />
        <span style={{ color: statusColor, whiteSpace: 'nowrap' }}>{label}</span>
      </button>

      {showDetails && (
        <div className="token-popup">
          <div className="token-popup-title">
            <span>Gemini API</span>
            <span className={`token-dot ${statusClass}`} />
          </div>

          <div className="token-info-row">
            <span>Status:</span>
            <span className={connected ? 'status-valid' : status ? 'status-error' : 'status-warning'}>
              {status ? (connected ? 'Connected' : 'Disconnected') : 'Checking'}
            </span>
          </div>

          <div className="token-info-row">
            <span>Last Checked:</span>
            <span className="token-info-value">
              {status
                ? new Date(status.checkedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                : '—'}
            </span>
          </div>

          <div className="token-info-row">
            <span>Model:</span>
            <span className="token-info-value gemini-model-name">{status?.model ?? 'gemini-3-flash-preview'}</span>
          </div>

          <div className="token-popup-footer">
            <p>{status?.message ?? 'Checking Gemini API connectivity…'}</p>
            <a
              href="https://aistudio.google.com/app/apikey"
              target="_blank"
              rel="noopener noreferrer"
              className="token-action-btn"
            >
              Open Google AI Studio
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
