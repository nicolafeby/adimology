'use client';

import { useState, useEffect, ReactNode } from 'react';
import { Lock, Eye, EyeOff, Loader2, AlertCircle } from 'lucide-react';

interface PasswordGateProps {
  children: ReactNode;
}

export default function PasswordGate({ children }: PasswordGateProps) {
  const [status, setStatus] = useState<'loading' | 'locked' | 'unlocked'>('loading');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    checkPasswordStatus();
  }, []);

  const checkPasswordStatus = async () => {
    try {
      const res = await fetch('/api/auth/check-password');
      const data = await res.json();

      console.log('Password status:', { enabled: data.enabled, authenticated: data.isAuthenticated });
      
      if (data.success && data.enabled && !data.isAuthenticated) {
        setStatus('locked');
      } else {
        setStatus('unlocked');
      }
    } catch {
      // If check fails, allow access to prevent locking out on network error
      setStatus('unlocked');
    }
  };

  const handleUnlock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password || verifying) return;

    setVerifying(true);
    setError('');

    try {
      const res = await fetch('/api/auth/verify-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });

      const data = await res.json();

      if (data.success && data.valid) {
        setStatus('unlocked');
      } else {
        setError('Password salah. Coba lagi.');
        setPassword('');
      }
    } catch {
      setError('Gagal memverifikasi password.');
    } finally {
      setVerifying(false);
    }
  };

  if (status === 'loading') {
    return (
      <div className="password-gate">
        <div className="password-gate-card">
          <div className="password-gate-spinner">
            <Loader2 size={32} className="password-spin" />
          </div>
        </div>
      </div>
    );
  }

  if (status === 'unlocked') {
    return <>{children}</>;
  }

  return (
    <div className="password-gate">
      <div className="password-gate-card">
        <div className="password-gate-icon">
          <Lock size={40} />
        </div>
        <h2 className="password-gate-title">Cocokologi</h2>
        <p className="password-gate-subtitle">Masukkan password untuk mengakses aplikasi</p>

        <form onSubmit={handleUnlock} className="password-gate-form">
          <div className="password-input-wrapper">
            <input
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => { setPassword(e.target.value); setError(''); }}
              placeholder="Password"
              className="password-gate-input"
              autoFocus
              disabled={verifying}
            />
            <button
              type="button"
              className="password-eye-btn"
              onClick={() => setShowPassword(!showPassword)}
              tabIndex={-1}
            >
              {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>

          <button
            type="submit"
            className="solid-btn"
            disabled={!password || verifying}
            style={{
              width: '100%',
              height: '42px',
              fontSize: '0.95rem',
              fontWeight: '600',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '0.5rem',
              borderRadius: '12px',
              cursor: (!password || verifying) ? 'not-allowed' : 'pointer',
              background: 'var(--accent-primary)',
              color: 'white',
              border: '1px solid var(--accent-primary)',
              boxShadow: '0 4px 12px rgba(124, 58, 237, 0.3)',
              opacity: (!password || verifying) ? 0.6 : 1,
              marginTop: '0.5rem'
            }}
          >
            {verifying ? (
              <><Loader2 size={16} className="password-spin" /> Verifying...</>
            ) : (
              'Unlock'
            )}
          </button>

          {error && (
            <p className="password-gate-error">
              <AlertCircle size={14} />
              {error}
            </p>
          )}
        </form>

        <p className="password-gate-hint">
          Lupa password? Reset melalui Supabase.{' '}
          <a
            href="https://github.com/bhaktiutama/adimology/wiki/Reset-Password"
            target="_blank"
            rel="noopener noreferrer"
          >
            Lihat panduan
          </a>
        </p>
      </div>
    </div>
  );
}
