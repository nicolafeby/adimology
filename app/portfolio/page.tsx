'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Activity, BriefcaseBusiness, ChevronRight, Eye, EyeOff, KeyRound, LockKeyhole, RefreshCw, X } from 'lucide-react';

type Holding = { id: string; symbol: string; name: string; lots: number; availableLots: number; average: number; price: number; invested?: number; marketValue?: number; profit?: number; percentage?: number };
type Totals = { tradingBalance?: number; invested?: number; open?: number; profit?: number; percentage?: number; equity?: number };
type Portfolio = { holdings: Holding[]; totals: Totals; updatedAt: string };
const number = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 2 });
const money = new Intl.NumberFormat('id-ID', { maximumFractionDigits: 0 });

export default function PortfolioPage() {
  const [data, setData] = useState<Portfolio | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [authRequired, setAuthRequired] = useState(false);
  const [error, setError] = useState('');
  const [showValues, setShowValues] = useState(true);
  const [showConnect, setShowConnect] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState('');

  const loadPortfolio = useCallback(async (quiet = false) => {
    if (!quiet) setRefreshing(true);
    try {
      const response = await fetch('/api/portfolio', { cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok || !payload.success) {
        if (response.status === 401 || payload.code === 'SECURITIES_AUTH_REQUIRED') { setAuthRequired(true); setError(''); }
        else setError(payload.error || 'Portofolio gagal dimuat.');
        return;
      }
      setData(payload.data); setAuthRequired(false); setError('');
    } catch { setError('Tidak dapat terhubung ke server.'); }
    finally { setLoading(false); setRefreshing(false); }
  }, []);

  useEffect(() => {
    loadPortfolio();
    const timer = window.setInterval(() => loadPortfolio(true), 15_000);
    return () => window.clearInterval(timer);
  }, [loadPortfolio]);

  async function connect(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setConnecting(true); setConnectError('');
    const form = event.currentTarget;
    const pin = String(new FormData(form).get('pin') || '');
    try {
      const response = await fetch('/api/portfolio/connect', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pin }) });
      const payload = await response.json();
      if (!response.ok || !payload.success) throw new Error(payload.error || 'Koneksi gagal');
      form.reset(); setShowConnect(false); await loadPortfolio();
    } catch (cause) { setConnectError(cause instanceof Error ? cause.message : 'Koneksi gagal'); }
    finally { setConnecting(false); }
  }

  const calculated = useMemo(() => {
    const holdings = data?.holdings || [];
    const invested = holdings.reduce((total, item) => total + (item.invested ?? item.average * item.lots * 100), 0);
    const equity = holdings.reduce((total, item) => total + (item.marketValue ?? item.price * item.lots * 100), 0);
    const profit = equity - invested;
    return { invested, equity, profit, percentage: invested ? profit / invested * 100 : 0 };
  }, [data]);
  const totals = data?.totals || {};
  const masked = (formatted: string) => showValues ? formatted : '••••••';
  const value = (amount?: number) => masked(money.format(amount ?? 0));
  const holdings = data?.holdings || [];
  const totalProfit = totals.profit ?? calculated.profit;
  const totalPct = totals.percentage ?? calculated.percentage;

  return <main className="portfolio-page portfolio-stockbit-page">
    <header className="portfolio-header">
      <div><span className="portfolio-eyebrow"><BriefcaseBusiness size={14} /> Stockbit Sekuritas</span><h1>Portfolio</h1><p>Posisi saham langsung dari akun Stockbit Anda.</p></div>
      <div className="portfolio-header-actions">
        <button className="portfolio-icon-btn" onClick={() => setShowValues(current => !current)} title="Privasi nominal">{showValues ? <Eye size={19} /> : <EyeOff size={19} />}</button>
        <button className="portfolio-icon-btn" onClick={() => loadPortfolio()} disabled={refreshing} title="Perbarui"><RefreshCw size={19} className={refreshing ? 'portfolio-spin' : ''} /></button>
        {authRequired && <button className="portfolio-add-btn" onClick={() => setShowConnect(true)}><KeyRound size={17} /> Hubungkan Stockbit</button>}
      </div>
    </header>

    <nav className="portfolio-tabs" aria-label="Navigasi akun"><button className="active">Portfolio</button><button disabled title="Segera hadir">Order</button><button disabled title="Segera hadir">History</button></nav>

    <section className="portfolio-account-strip">
      <div><strong>{value(totals.tradingBalance)}</strong><span>Trading Balance</span></div>
      <div><strong>{value(totals.invested ?? calculated.invested)}</strong><span>Invested</span></div>
      <div><strong>{value(totals.open)}</strong><span>Open</span></div>
      <div className={totalProfit >= 0 ? 'is-profit' : 'is-loss'}><strong>{totalProfit >= 0 ? '+' : ''}{value(totalProfit)} <small>({totalPct >= 0 ? '+' : ''}{totalPct.toFixed(2)}%)</small></strong><span>Net Profit / Loss</span></div>
      <div><strong>{value(totals.equity ?? calculated.equity)}</strong><span>Total Equity</span></div>
    </section>

    <section className="portfolio-holdings-card">
      <div className="portfolio-toolbar"><div className="portfolio-filter active"><Activity size={15} /> Stocks <b>100%</b></div><div className="portfolio-filter muted">All Portfolio <b>100%</b></div><span className="portfolio-live"><i /> LIVE</span></div>
      {loading ? <div className="portfolio-empty"><RefreshCw className="portfolio-spin" /><p>Menghubungkan ke Stockbit Sekuritas…</p></div> : authRequired ? <div className="portfolio-empty portfolio-auth-empty"><div className="portfolio-empty-icon"><LockKeyhole size={29} /></div><h3>Hubungkan sesi sekuritas</h3><p>Token market-data sudah terhubung, tetapi portofolio memerlukan sesi Stockbit Sekuritas yang berbeda.</p><button className="portfolio-add-btn" onClick={() => setShowConnect(true)}><KeyRound size={17} /> Masukkan PIN trading</button><small>PIN hanya dikirim sekali ke Stockbit untuk membuka sesi dan tidak disimpan.</small></div> : error ? <div className="portfolio-empty"><h3>Portofolio belum dapat dimuat</h3><p>{error}</p><button className="portfolio-add-btn" onClick={() => loadPortfolio()}>Coba lagi</button></div> : !holdings.length ? <div className="portfolio-empty"><div className="portfolio-empty-icon"><BriefcaseBusiness size={29} /></div><h3>Tidak ada posisi saham</h3><p>Sesi Stockbit tersambung, tetapi API tidak mengembalikan posisi aktif.</p></div> : <div className="portfolio-table-wrap"><table className="portfolio-table portfolio-stockbit-table"><thead><tr><th>Symbol</th><th>Balance Lot</th><th>Available Lot</th><th>Average Price</th><th>Current Price</th><th>Invested</th><th>Market Value</th><th>Potential P/L</th><th>Percentage</th><th /></tr></thead><tbody>{holdings.map(item => {
        const invested = item.invested ?? item.average * item.lots * 100;
        const market = item.marketValue ?? item.price * item.lots * 100;
        const profit = item.profit ?? market - invested;
        const pct = item.percentage ?? (invested ? profit / invested * 100 : 0);
        return <tr key={item.id}><td><Link className="portfolio-stock" href={`/?symbol=${item.symbol}`}><span>{item.symbol.slice(0, 2)}</span><div><strong>{item.symbol}</strong>{item.name && <small>{item.name}</small>}</div><ChevronRight size={14} /></Link></td><td>{number.format(item.lots)}</td><td>{number.format(item.availableLots)}</td><td>{number.format(item.average)}</td><td><strong>{number.format(item.price)}</strong></td><td>{value(invested)}</td><td>{value(market)}</td><td className={profit >= 0 ? 'is-profit' : 'is-loss'}>{profit >= 0 ? '+' : ''}{value(profit)}</td><td className={pct >= 0 ? 'is-profit' : 'is-loss'}>{pct >= 0 ? '+' : ''}{pct.toFixed(2)}%</td><td><Link href={`/?symbol=${item.symbol}`} className="portfolio-row-action">•••</Link></td></tr>;
      })}</tbody></table></div>}
    </section>
    <p className="portfolio-disclaimer">Data rekening bersifat read-only · {data?.updatedAt ? `terakhir sinkron ${new Date(data.updatedAt).toLocaleTimeString('id-ID')}` : 'refresh otomatis 15 detik'} · bukan rekomendasi investasi.</p>

    {showConnect && <div className="portfolio-modal-backdrop" onMouseDown={event => event.target === event.currentTarget && setShowConnect(false)}><form className="portfolio-modal portfolio-connect-modal" onSubmit={connect}><header><div><span className="portfolio-eyebrow">Secure connection</span><h2>Hubungkan Stockbit Sekuritas</h2></div><button type="button" onClick={() => setShowConnect(false)}><X size={20} /></button></header><div className="portfolio-connect-note"><LockKeyhole size={18} /><p>Gunakan PIN trading Stockbit. PIN dipakai untuk satu request login dan tidak pernah disimpan di database atau browser.</p></div><label>PIN trading<input name="pin" type="password" inputMode="numeric" autoComplete="off" minLength={4} maxLength={8} pattern="[0-9]{4,8}" placeholder="••••••" autoFocus required /></label>{connectError && <p className="portfolio-form-error">{connectError}</p>}<button className="portfolio-add-btn portfolio-submit" disabled={connecting}>{connecting ? 'Menghubungkan…' : 'Hubungkan akun'}</button></form></div>}
  </main>;
}
