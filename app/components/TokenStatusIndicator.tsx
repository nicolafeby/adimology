'use client';

import { useState, useEffect, useRef } from 'react';

type TokenStatusData = {
  exists: boolean;
  isValid: boolean;
  expiresAt?: string;
  lastUsedAt?: string;
  updatedAt?: string;
  isExpiringSoon: boolean;
  isExpired: boolean;
  hoursUntilExpiry?: number;
};

let inFlightFetch: Promise<any> | null = null;

export default function TokenStatusIndicator() {
  const [status, setStatus] = useState<TokenStatusData | null>(null);
  const [loading, setLoading] = useState(true);
  const [showDetails, setShowDetails] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const prevIsValidRef = useRef<boolean | null>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setShowDetails(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    const fetchStatus = async () => {
      if (inFlightFetch) {
        const data = await inFlightFetch;
        if (data && data.isValid !== undefined) {
          prevIsValidRef.current = data.isValid;
          setStatus(data);
        }
        return data;
      }

      inFlightFetch = (async () => {
        try {
          const res = await fetch('/api/token-status');
          if (res.ok) {
            const data: TokenStatusData = await res.json();

            // Check for transition from invalid/none to valid
            if (data.isValid && prevIsValidRef.current === false) {
              console.log('Token became valid, dispatching refresh event');
              window.dispatchEvent(new CustomEvent('token-refreshed'));
            }

            prevIsValidRef.current = data.isValid;
            setStatus(data);
            return data;
          }
        } catch (error) {
          console.error('Failed to fetch token status', error);
          throw error;
        } finally {
          setLoading(false);
          inFlightFetch = null;
        }
      })();

      return inFlightFetch;
    };

    fetchStatus();

    // Fixed interval to prevent loops from status.isValid dependency
    const intervalId = setInterval(fetchStatus, 30000); 

    return () => clearInterval(intervalId);
  }, []);

  if (loading || !status) return null;

  const isGood = status.exists && status.isValid && !status.isExpired && !status.isExpiringSoon;
  const isWarning = status.exists && status.isValid && status.isExpiringSoon && !status.isExpired;
  const isError = !status.exists || !status.isValid || status.isExpired;

  return (
    <div style={{ position: 'relative' }} ref={containerRef}>
      <div
        className="token-status-pill"
        onClick={() => setShowDetails(!showDetails)}
      >
        <div className={`token-dot ${isError ? 'error' : isWarning ? 'warning' : 'good'}`} />
        <span style={{ color: isError ? '#ff4d4d' : isWarning ? 'var(--accent-orange)' : 'var(--accent-success)' }}>
          {isError ? 'Token Invalid' : isWarning ? 'Token Expiring' : 'Connected'}
        </span>
      </div>

      {showDetails && (
        <div className="token-popup">
          <div className="token-popup-title">
            <span>Stockbit Link</span>
            <div className={`token-dot ${isError ? 'error' : isWarning ? 'warning' : 'good'}`} />
          </div>

          <div className="token-info-row">
            <span>Status:</span>
            <span className={isError ? 'status-error' : 'status-valid'}>
              {isError ? 'Disconnected' : 'Connected'}
            </span>
          </div>

          {status.lastUsedAt && (
            <div className="token-info-row">
              <span>Last Used:</span>
              <span className="token-info-value">
                {new Date(status.lastUsedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
            </div>
          )}

          {status.expiresAt && (
            <div className="token-info-row">
              <span>Expires:</span>
              <span className={`token-info-value ${isWarning ? 'status-warning' : ''}`}>
                {new Date(status.expiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
            </div>
          )}

          <div style={{ marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid var(--border-color)' }}>
            <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', lineHeight: '1.4', marginBottom: '0.75rem' }}>
              {isError
                ? 'Token has expired or is invalid. Please login to Stockbit via the extension to refresh.'
                : 'Connection is active. Token will be automatically refreshed by the extension.'}
            </p>
            <a
              href="https://stockbit.com/login"
              target="_blank"
              rel="noopener noreferrer"
              className="token-action-btn"
            >
              {isError ? 'Login to Stockbit' : 'Open Stockbit'}
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
