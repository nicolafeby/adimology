'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import TokenStatusIndicator from './TokenStatusIndicator';
import JobStatusIndicator from './JobStatusIndicator';
import StockbitFetchingIndicator from './StockbitFetchingIndicator';
import GeminiStatusIndicator from './GeminiStatusIndicator';
import ThemeToggle from './ThemeToggle';
import PasswordSettingModal from './PasswordSettingModal';
import { Github, Menu, X, Shield } from 'lucide-react';

const Navbar = () => {
  const pathname = usePathname();
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isPasswordModalOpen, setIsPasswordModalOpen] = useState(false);

  const toggleMenu = () => setIsMenuOpen(!isMenuOpen);

  return (
    <nav className="navbar">
      <div className="navbar-container">
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <div className="navbar-logo-icon" style={{ background: 'transparent', display: 'flex', alignItems: 'center' }}>
            <svg width="42" height="42" viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg">
              <rect x="49" y="10" width="2" height="80" fill="currentColor" />
              <rect x="44" y="32" width="12" height="38" fill="currentColor" />
              <path d="M22 30C40 18 60 22 80 32" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
              <path d="M22 30C18 30 16 38 22 42C24 44 28 42 28 38" stroke="currentColor" strokeLinecap="round" strokeWidth="2.5" />
              <line stroke="currentColor" strokeWidth="1.5" x1="22" x2="44" y1="30" y2="70" />
              <line stroke="currentColor" strokeWidth="1.5" x1="80" x2="56" y1="32" y2="70" />
            </svg>
          </div>
          <div className="navbar-content">
            <h1 className="navbar-title">Cocoklogi Saham</h1>
            <p className="navbar-subtitle">Analyze stock targets based on broker summary</p>
          </div>
        </div>

        {/* Desktop View */}
        <div className="nav-desktop-actions">
          <div className="nav-links">
            <Link
              href="/" 
              style={{
                textDecoration: 'none',
                color: pathname === '/' ? 'var(--text-primary)' : 'var(--text-secondary)',
                fontWeight: pathname === '/' ? 600 : 400,
                fontSize: '0.9rem',
                borderBottom: pathname === '/' ? '2px solid var(--accent-primary)' : '2px solid transparent',
                paddingBottom: '2px',
                transition: 'all 0.2s'
              }}
            >
              Calculator
            </Link>
            <Link
              href="/rankings"
              style={{
                textDecoration: 'none', color: pathname === '/rankings' ? 'var(--text-primary)' : 'var(--text-secondary)',
                fontWeight: pathname === '/rankings' ? 600 : 400, fontSize: '0.9rem',
                borderBottom: pathname === '/rankings' ? '2px solid var(--accent-primary)' : '2px solid transparent', paddingBottom: '2px'
              }}
            >
              Top 10
            </Link>
            <Link
              href="/history" 
              style={{
                textDecoration: 'none',
                color: pathname === '/history' ? 'var(--text-primary)' : 'var(--text-secondary)',
                fontWeight: pathname === '/history' ? 600 : 400,
                fontSize: '0.9rem',
                borderBottom: pathname === '/history' ? '2px solid var(--accent-primary)' : '2px solid transparent',
                paddingBottom: '2px',
                transition: 'all 0.2s'
              }}
            >
              History
            </Link>
            <Link
              href="/summary" 
              style={{
                textDecoration: 'none',
                color: pathname === '/summary' ? 'var(--text-primary)' : 'var(--text-secondary)',
                fontWeight: pathname === '/summary' ? 600 : 400,
                fontSize: '0.9rem',
                borderBottom: pathname === '/summary' ? '2px solid var(--accent-primary)' : '2px solid transparent',
                paddingBottom: '2px',
                transition: 'all 0.2s'
              }}
            >
              Summary
            </Link>
            <a 
              href="https://github.com/nicolafeby/adimology" 
              target="_blank" 
              rel="noopener noreferrer"
              style={{
                display: 'flex',
                alignItems: 'center',
                color: 'var(--text-secondary)',
                transition: 'color 0.2s',
                paddingBottom: '2px',
              }}
              className="github-link"
              title="View on GitHub"
            >
              <Github size={20} />
            </a>
          </div>
          <div className="nav-status-group">
            <StockbitFetchingIndicator />
            <JobStatusIndicator />
            <TokenStatusIndicator />
            <GeminiStatusIndicator />
            <ThemeToggle />
            <button
              onClick={() => setIsPasswordModalOpen(true)}
              className="theme-toggle-btn"
              title="Password Protection"
              style={{ 
                background: 'var(--bg-card)', 
                border: '1px solid var(--border-color)', 
                color: 'var(--text-primary)', 
                cursor: 'pointer', 
                display: 'flex', 
                alignItems: 'center', 
                justifyContent: 'center',
                width: '38px',
                height: '38px',
                borderRadius: '12px', 
                transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                backdropFilter: 'blur(10px)',
              }}
            >
              <Shield size={20} strokeWidth={2.5} />
            </button>
          </div>
        </div>

        {/* Mobile Toggle Button */}
        <button className="nav-mobile-toggle" onClick={toggleMenu} aria-label="Toggle menu">
          {isMenuOpen ? <X size={24} /> : <Menu size={24} />}
        </button>

        {/* Mobile Menu */}
        <div className={`nav-mobile-menu ${isMenuOpen ? 'open' : ''}`}>
          <div className="nav-links">
            <Link 
              href="/" 
              onClick={() => setIsMenuOpen(false)}
              style={{
                textDecoration: 'none',
                color: pathname === '/' ? 'var(--text-primary)' : 'var(--text-secondary)',
                fontWeight: pathname === '/' ? 600 : 400,
                fontSize: '1rem',
                padding: '0.5rem 0',
                transition: 'all 0.2s'
              }}
            >
              Calculator
            </Link>
            <Link 
              href="/rankings"
              onClick={() => setIsMenuOpen(false)}
              style={{ textDecoration: 'none', color: pathname === '/rankings' ? 'var(--text-primary)' : 'var(--text-secondary)', fontWeight: pathname === '/rankings' ? 600 : 400, fontSize: '1rem', padding: '0.5rem 0' }}
            >
              Top 10
            </Link>
            <Link
              href="/history" 
              onClick={() => setIsMenuOpen(false)}
              style={{
                textDecoration: 'none',
                color: pathname === '/history' ? 'var(--text-primary)' : 'var(--text-secondary)',
                fontWeight: pathname === '/history' ? 600 : 400,
                fontSize: '1rem',
                padding: '0.5rem 0',
                transition: 'all 0.2s'
              }}
            >
              History
            </Link>
            <Link 
              href="/summary" 
              onClick={() => setIsMenuOpen(false)}
              style={{
                textDecoration: 'none',
                color: pathname === '/summary' ? 'var(--text-primary)' : 'var(--text-secondary)',
                fontWeight: pathname === '/summary' ? 600 : 400,
                fontSize: '1rem',
                padding: '0.5rem 0',
                transition: 'all 0.2s'
              }}
            >
              Summary
            </Link>
            <a 
              href="https://github.com/nicolafeby/adimology" 
              target="_blank" 
              rel="noopener noreferrer"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                color: 'var(--text-secondary)',
                fontSize: '1rem',
                padding: '0.5rem 0',
              }}
            >
              <Github size={20} /> View on GitHub
            </a>
          </div>
          <div className="nav-status-group">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>Job Status</span>
              <JobStatusIndicator />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>Stockbit Token</span>
              <TokenStatusIndicator />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>Gemini API</span>
              <GeminiStatusIndicator />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>Theme</span>
              <ThemeToggle />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>Password</span>
              <button
                onClick={() => { setIsPasswordModalOpen(true); setIsMenuOpen(false); }}
                style={{ 
                  background: 'var(--bg-card)', 
                  border: '1px solid var(--border-color)', 
                  color: 'var(--text-primary)', 
                  cursor: 'pointer', 
                  display: 'flex', 
                  alignItems: 'center', 
                  justifyContent: 'center',
                  width: '34px',
                  height: '34px',
                  borderRadius: '10px'
                }}
              >
                <Shield size={18} strokeWidth={2.5} />
              </button>
            </div>
          </div>
        </div>
      </div>
      <PasswordSettingModal isOpen={isPasswordModalOpen} onClose={() => setIsPasswordModalOpen(false)} />
    </nav>
  );
};

export default Navbar;
