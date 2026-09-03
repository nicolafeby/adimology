'use client';

import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X, Shield, ShieldCheck, Eye, EyeOff, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';

interface PasswordSettingModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function PasswordSettingModal({ isOpen, onClose }: PasswordSettingModalProps) {
  const [enabled, setEnabled] = useState(false);
  const [hasPassword, setHasPassword] = useState(false);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    return () => setMounted(false);
  }, []);

  useEffect(() => {
    if (isOpen) {
      fetchStatus();
      setPassword('');
      setConfirmPassword('');
      setError('');
      setSuccess('');
      document.body.classList.add('modal-open');
    } else {
      document.body.classList.remove('modal-open');
    }
  }, [isOpen]);

  const fetchStatus = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/auth/check-password');
      const data = await res.json();
      if (data.success) {
        setEnabled(data.enabled);
        setHasPassword(data.hasPassword);
      }
    } catch {
      setError('Gagal memuat status password.');
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    setError('');
    setSuccess('');

    if (enabled) {
      if (!password) {
        setError('Password tidak boleh kosong.');
        return;
      }
      if (password.length < 12) {
        setError('Password minimal 12 karakter.');
        return;
      }
      if (password !== confirmPassword) {
        setError('Password tidak cocok.');
        return;
      }
    }

    setSaving(true);
    try {
      const res = await fetch('/api/auth/set-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password, enabled }),
      });

      const data = await res.json();

      if (data.success) {
        setSuccess(enabled ? 'Password berhasil disimpan.' : 'Proteksi password dinonaktifkan.');
        setHasPassword(enabled);
        setPassword('');
        setConfirmPassword('');
        // Clear session so gate re-checks
        sessionStorage.removeItem('app_unlocked');
        // Force reload to trigger PasswordGate re-evaluation
        window.location.reload();
      } else {
        setError(data.error || 'Gagal menyimpan.');
      }
    } catch {
      setError('Gagal menyimpan password.');
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = () => {
    const newEnabled = !enabled;
    setEnabled(newEnabled);
    setError('');
    setSuccess('');
    if (!newEnabled) {
      setPassword('');
      setConfirmPassword('');
    }
  };

  if (!isOpen || !mounted) return null;

  const modalContent = (
    <div className="password-modal-overlay" onClick={onClose}>
      <div className="password-modal" onClick={(e) => e.stopPropagation()}>
        <div className="password-modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            {enabled ? <ShieldCheck size={20} style={{ color: 'var(--accent-success)' }} /> : <Shield size={20} />}
            <h3 style={{ margin: 0, textTransform: 'none', letterSpacing: 0, color: 'var(--text-primary)' }}>
              Password Protection
            </h3>
          </div>
          <button className="password-modal-close" onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        {loading ? (
          <div style={{ display: 'flex', justifyContent: 'center', padding: '2rem' }}>
            <Loader2 size={24} className="password-spin" />
          </div>
        ) : (
          <div className="password-modal-body">
            <div className="password-toggle-row">
              <div>
                <div style={{ fontWeight: 500, fontSize: '0.9rem' }}>Aktifkan Proteksi Password</div>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>
                  Aplikasi akan meminta password setiap kali dibuka jika session sebelumnya telah habis
                </div>
              </div>
              <button
                className={`password-toggle-switch ${enabled ? 'active' : ''}`}
                onClick={handleToggle}
                role="switch"
                aria-checked={enabled}
              >
                <span className="password-toggle-knob" />
              </button>
            </div>

            {enabled && (
              <div className="password-form-section">
                <div className="password-input-group">
                  <label className="password-label">
                    {hasPassword ? 'Password Baru' : 'Password'}
                  </label>
                  <div className="password-input-wrapper">
                    <input
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={(e) => { setPassword(e.target.value); setError(''); }}
                      placeholder="Minimal 4 karakter"
                      className="password-gate-input"
                    />
                    <button
                      type="button"
                      className="password-eye-btn"
                      onClick={() => setShowPassword(!showPassword)}
                      tabIndex={-1}
                    >
                      {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </div>

                <div className="password-input-group">
                  <label className="password-label">Konfirmasi Password</label>
                  <div className="password-input-wrapper">
                    <input
                      type={showPassword ? 'text' : 'password'}
                      value={confirmPassword}
                      onChange={(e) => { setConfirmPassword(e.target.value); setError(''); }}
                      placeholder="Ulangi password"
                      className="password-gate-input"
                    />
                  </div>
                </div>
              </div>
            )}

            <button
              className="solid-btn"
              onClick={handleSave}
              disabled={saving}
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
                cursor: saving ? 'not-allowed' : 'pointer',
                background: 'var(--accent-primary)',
                color: 'white',
                border: '1px solid var(--accent-primary)',
                boxShadow: '0 4px 12px rgba(124, 58, 237, 0.3)',
                opacity: saving ? 0.6 : 1,
                marginTop: '1rem'
              }}
            >
              {saving ? (
                <><Loader2 size={16} className="password-spin" /> Menyimpan...</>
              ) : (
                'Simpan'
              )}
            </button>

            {error && (
              <p className="password-gate-error">
                <AlertCircle size={14} />
                {error}
              </p>
            )}
            
            {success && (
              <p className="password-gate-success">
                <CheckCircle2 size={14} className="password-success-icon" />
                {success}
              </p>
            )}

            {enabled && (
              <p style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '0.75rem', textAlign: 'center' }}>
                Jika lupa password, reset melalui Supabase.{' '} 
                <a
                  href="https://github.com/bhaktiutama/adimology/wiki/Reset-Password"
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: 'var(--accent-primary)' }}
                >
                  Lihat panduan
                </a>
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );

  return createPortal(modalContent, document.body);
}
