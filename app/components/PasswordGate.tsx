'use client';

import { useState, useEffect, useCallback, useRef, ReactNode } from 'react';
import { Lock, Eye, EyeOff, Loader2, AlertCircle } from 'lucide-react';
import { SESSION_EXPIRED_EVENT } from '@/lib/client-session';
import { AUTH_REQUEST_TIMEOUT_MS } from '@/lib/auth-timeouts';

interface PasswordGateProps {
  children: ReactNode;
}

export default function PasswordGate({ children }: PasswordGateProps) {
  const [status, setStatus] = useState<'loading' | 'locked' | 'unlocked' | 'unavailable'>('loading');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [verifying, setVerifying] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const activeCheck = useRef<AbortController | null>(null);
  const activeLogin = useRef<AbortController | null>(null);
  const recovering = useRef(false);

  const checkPasswordStatus = useCallback(async (expired = false) => {
    activeCheck.current?.abort();
    const controller = new AbortController();
    activeCheck.current = controller;
    let timedOut = false;
    const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, AUTH_REQUEST_TIMEOUT_MS);
    setStatus('loading');
    try {
      const res = await fetch('/api/auth/check-password', { cache: 'no-store', credentials: 'same-origin', signal: controller.signal });
      const data = await res.json();
      if (!controller.signal.aborted && res.status === 503 && data?.code === 'AUTH_SETTINGS_TIMEOUT') {
        setError('Layanan pengaturan login belum merespons. Coba lagi setelah koneksi layanan pulih.');
        setStatus('unavailable');
        return;
      }
      if (!res.ok || data?.success !== true || typeof data.enabled !== 'boolean' || typeof data.isAuthenticated !== 'boolean') throw new Error('Security status unavailable');
      if (controller.signal.aborted) return;
      if (data.enabled && (!data.isAuthenticated || expired)) {
        setError(expired ? 'Sesi berakhir. Masukkan password untuk melanjutkan.' : '');
        setStatus('locked');
      } else if (data.isAuthenticated) {
        setError('');
        setStatus('unlocked');
      } else {
        throw new Error('Session was not established');
      }
    } catch {
      if (controller.signal.aborted && !timedOut) return;
      setError(timedOut ? 'Pemeriksaan login terlalu lama. Periksa koneksi lalu coba lagi.' : 'Status login belum dapat diperiksa. Coba lagi.');
      setStatus('unavailable');
    } finally {
      clearTimeout(timeout);
      if (activeCheck.current === controller) recovering.current = false;
    }
  }, []);

  useEffect(() => {
    void checkPasswordStatus();
    const recover = () => {
      if (recovering.current) return;
      recovering.current = true;
      void checkPasswordStatus(true);
    };
    window.addEventListener(SESSION_EXPIRED_EVENT, recover);
    return () => { activeCheck.current?.abort(); activeLogin.current?.abort(); window.removeEventListener(SESSION_EXPIRED_EVENT, recover); };
  }, [checkPasswordStatus]);

  const handleUnlock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password || verifying) return;

    setVerifying(true);
    setError('');
    const controller = new AbortController();
    activeLogin.current = controller;
    let timedOut = false;
    const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, AUTH_REQUEST_TIMEOUT_MS);

    try {
      const res = await fetch('/api/auth/verify-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
        signal: controller.signal,
      });

      const data = await res.json();
      if (controller.signal.aborted) return;

      if (res.ok && data?.success === true && data.valid === true) {
        setPassword('');
        setError('');
        setStatus('unlocked');
      } else if (!res.ok || data?.success !== true) {
        setError('Login belum dapat diproses. Coba lagi.');
      } else {
        setError('Password salah. Coba lagi.');
        setPassword('');
      }
    } catch {
      if (controller.signal.aborted && !timedOut) return;
      setError(timedOut ? 'Login terlalu lama. Periksa koneksi lalu coba lagi.' : 'Gagal memverifikasi password.');
    } finally {
      clearTimeout(timeout);
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
          <p role="status">Memeriksa sesi login…</p>
        </div>
      </div>
    );
  }

  if (status === 'unlocked') {
    return <>{children}</>;
  }

  if (status === 'unavailable') return (
    <div className="password-gate"><div className="password-gate-card">
      <p role="alert">{error}</p>
      <button type="button" className="btn btn-primary password-gate-btn" onClick={() => void checkPasswordStatus()}>Periksa login kembali</button>
    </div></div>
  );

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
              aria-label="Password aplikasi"
              autoComplete="current-password"
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
            <p className="password-gate-error" role="alert">
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
