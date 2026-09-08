'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { notifySessionExpired } from '@/lib/client-session';
import { SCREENING_UPDATE_MESSAGE, SCREENING_UPDATE_REQUIRED } from '@/lib/screening-errors';
import type {
  CoreStrategyId,
  StrategyId,
  StrategyWindowStatus,
  UnifiedScreenerResult,
} from '@/lib/idx-strategy-filters';
import './screening.css';

interface RunMeta {
  id?: string;
  status?: string;
  analysis_date?: string;
  information_cutoff_at?: string;
  market_session?: string;
  quantitative_status?: string;
}

interface UnifiedResponse {
  success: boolean;
  pipeline_version: string;
  timezone: 'Asia/Jakarta';
  run: RunMeta | null;
  evaluated_at: string;
  windows: StrategyWindowStatus[];
  data: UnifiedScreenerResult[];
  summary: {
    universe: number;
    evaluated: number;
    matched: number;
    topPriority: number;
    partialData: number;
    strategies?: Partial<Record<CoreStrategyId, number>>;
  };
}

const EMPTY: UnifiedResponse = {
  success: true,
  pipeline_version: 'idx-unified-screener-v1',
  timezone: 'Asia/Jakarta',
  run: null,
  evaluated_at: '',
  windows: [],
  data: [],
  summary: { universe: 0, evaluated: 0, matched: 0, topPriority: 0, partialData: 0 },
};

const STRATEGY_LABELS: Record<StrategyId, string> = {
  BPJS: 'BPJS',
  BSJP: 'BSJP',
  ARA_HUNTER: 'ARA Hunter',
  SWING: 'Swing',
  CLOSING_PRIORITY: 'TOP PRIORITY',
};

const CORE_IDS: CoreStrategyId[] = ['BPJS', 'BSJP', 'ARA_HUNTER', 'SWING'];
const FILTER_IDS: Array<'ALL' | StrategyId> = ['ALL', ...CORE_IDS, 'CLOSING_PRIORITY'];
const terminal = (status?: string) => ['completed', 'partial', 'failed', 'cancelled', 'interrupted', 'timed_out'].includes(status ?? '');

async function readResponse(response: Response): Promise<UnifiedResponse> {
  if (response.status === 401) {
    notifySessionExpired();
    throw new Error('Sesi berakhir. Silakan masuk kembali.');
  }
  const json = await response.json().catch(() => null);
  if (response.status === 503 && json?.code === SCREENING_UPDATE_REQUIRED) throw new Error(SCREENING_UPDATE_MESSAGE);
  if (!response.ok || !json || json.success === false) throw new Error('Permintaan screener tidak berhasil. Coba lagi.');
  return json as UnifiedResponse;
}

function formatPrice(value: number | null) {
  return value === null ? '—' : `Rp ${value.toLocaleString('id-ID', { maximumFractionDigits: 2 })}`;
}

function formatChange(value: number | null) {
  return value === null ? '—' : `${value > 0 ? '+' : ''}${value.toFixed(2)}%`;
}

function formatWib(value: string) {
  if (!value || !Number.isFinite(Date.parse(value))) return '—';
  return new Intl.DateTimeFormat('id-ID', {
    timeZone: 'Asia/Jakarta',
    dateStyle: 'medium',
    timeStyle: 'medium',
  }).format(new Date(value)) + ' WIB';
}

function shortReason(row: UnifiedScreenerResult) {
  if (row.score_reasons) return row.score_reasons;
  if (row.matched_strategies.length) return row.matched_strategies
    .filter((id): id is CoreStrategyId => id !== 'CLOSING_PRIORITY')
    .map((id) => `${STRATEGY_LABELS[id]}: seluruh rule lolos`)
    .join('; ');
  const firstFailure = CORE_IDS.flatMap((id) => row.strategy_evaluations[id]?.failed_reasons ?? [])[0];
  return firstFailure || 'Belum ada rule yang dapat dievaluasi.';
}

function RuleDetails({ row }: { row: UnifiedScreenerResult }) {
  return <details className="unified-rule-details">
    <summary>{shortReason(row)}</summary>
    <div className="unified-rule-grid">
      {CORE_IDS.map((strategyId) => {
        const evaluation = row.strategy_evaluations[strategyId];
        if (!evaluation) return null;
        return <section key={strategyId}>
          <h4>{STRATEGY_LABELS[strategyId]} <span className={evaluation.passed ? 'rule-pass' : 'rule-fail'}>{evaluation.passed ? 'LOLOS' : 'TIDAK LOLOS'}</span></h4>
          <p>{evaluation.window_label} · {evaluation.is_in_window ? 'jendela aktif' : 'di luar jendela'}</p>
          <ul>{evaluation.rules.map((rule, ruleIndex) => <li key={`${strategyId}:${rule.key}:${ruleIndex}`} className={rule.passed ? 'rule-pass' : 'rule-fail'}>{rule.reason}</li>)}</ul>
        </section>;
      })}
    </div>
  </details>;
}

export default function RankingsPage() {
  const [snapshot, setSnapshot] = useState<UnifiedResponse>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [strategyFilter, setStrategyFilter] = useState<'ALL' | StrategyId>('ALL');
  const [search, setSearch] = useState('');

  const load = useCallback(async (signal?: AbortSignal, silent = false) => {
    if (!silent) setLoading(true);
    setError('');
    try {
      setSnapshot(await fetch('/api/screener/unified', { cache: 'no-store', signal }).then(readResponse));
    } catch (reason) {
      if (!signal?.aborted) setError(reason instanceof Error ? reason.message : 'Hasil screener tidak dapat dimuat.');
    } finally {
      if (!signal?.aborted && !silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  useEffect(() => {
    if (!snapshot.run || terminal(snapshot.run.status)) return;
    const controller = new AbortController();
    const timer = setInterval(() => void load(controller.signal, true), 3_000);
    return () => { clearInterval(timer); controller.abort(); };
  }, [snapshot.run?.id, snapshot.run?.status, load]);

  const runScreener = async () => {
    setRunning(true);
    setError('');
    setMessage('Mengevaluasi universe IDX melalui satu pipeline. Proses dapat memerlukan beberapa menit.');
    try {
      const response = await fetch('/api/screener/unified', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ universeLimit: 1000, deepLimit: 100, aiLimit: 0, concurrency: 4 }),
      }).then(readResponse);
      setSnapshot(response);
      setMessage(`Selesai: ${response.summary.evaluated} saham dievaluasi, ${response.summary.matched} cocok, ${response.summary.topPriority} top priority.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Screening gagal dijalankan.');
      setMessage('');
    } finally {
      setRunning(false);
      setLoading(false);
    }
  };

  const rows = useMemo(() => {
    const query = search.trim().toUpperCase();
    return snapshot.data.filter((row) => (strategyFilter === 'ALL' || row.matched_strategies.includes(strategyFilter))
      && (!query || row.ticker.includes(query)));
  }, [search, snapshot.data, strategyFilter]);

  return <main className="ranking-page unified-screener" data-testid="screening-page">
    <header className="ranking-hero unified-hero">
      <div>
        <span className="ranking-eyebrow">IDX · Satu pipeline · Asia/Jakarta</span>
        <h1>Screener Saham</h1>
        <p>BPJS, BSJP, ARA Hunter, Swing, dan Closing Priority dievaluasi bersama dalam satu snapshot.</p>
      </div>
      <div className="ranking-actions">
        <button className="ranking-secondary-btn" type="button" onClick={() => void load()} disabled={loading || running}>{loading ? 'Memuat…' : 'Refresh'}</button>
        <button className="ranking-run-btn" type="button" onClick={() => void runScreener()} disabled={loading || running} data-testid="run-screening">{running ? 'Screening berjalan…' : 'Jalankan Screener'}</button>
      </div>
    </header>

    <section className="unified-window-grid" aria-label="Status jendela strategi">
      {snapshot.windows.map((window) => <article key={window.strategy_id} className={window.is_in_window ? 'window-active' : ''}>
        <span>{window.label}</span>
        <strong>{window.is_in_window ? 'AKTIF' : 'BELUM AKTIF'}</strong>
        <small>{window.window_label}</small>
      </article>)}
    </section>

    {snapshot.run && <p className="ranking-note" role="status">Run <strong>{snapshot.run.status ?? 'unknown'}</strong> · cutoff {formatWib(snapshot.run.information_cutoff_at ?? snapshot.evaluated_at)} · sesi {snapshot.run.market_session ?? 'belum terverifikasi'} · pipeline {snapshot.pipeline_version}</p>}
    {message && <div className="ranking-run-status" role="status">{message}</div>}
    {error && <div className="ranking-empty ranking-error" role="alert"><p>{error}</p><button className="ranking-secondary-btn" type="button" onClick={() => void load()}>Coba lagi</button></div>}
    {loading && <div className="ranking-empty unified-loading" role="status"><span className="unified-spinner" aria-hidden="true" />Memuat snapshot screener terpadu…</div>}

    {!loading && <>
      <section className="screening-summary unified-summary" aria-label="Ringkasan screener">
        {Object.entries({ Universe: snapshot.summary.universe, Dievaluasi: snapshot.summary.evaluated, 'Matched strategy': snapshot.summary.matched, 'Top priority': snapshot.summary.topPriority, 'Partial data': snapshot.summary.partialData }).map(([label, count]) => <div key={label}><span>{label}</span><strong>{count ?? 0}</strong></div>)}
      </section>

      <section className="unified-toolbar" aria-label="Filter hasil">
        <label>Strategi
          <select aria-label="Filter strategi" value={strategyFilter} onChange={(event) => setStrategyFilter(event.target.value as 'ALL' | StrategyId)}>
            {FILTER_IDS.map((id) => <option key={id} value={id}>{id === 'ALL' ? 'Semua strategi' : STRATEGY_LABELS[id]}</option>)}
          </select>
        </label>
        <label>Cari ticker
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Contoh: BBCA" inputMode="search" />
        </label>
        <p>{rows.length.toLocaleString('id-ID')} dari {snapshot.data.length.toLocaleString('id-ID')} saham</p>
      </section>

      {snapshot.data.length > 0 && snapshot.summary.partialData > 0 && <div className="unified-partial" role="status">Sebagian field belum tersedia atau stale. Nilai tersebut tidak diubah menjadi nol dan strategi terkait tidak dinyatakan lolos.</div>}

      {rows.length ? <div className="unified-table-wrap">
        <table className="unified-table">
          <thead><tr><th>Ticker</th><th>Close</th><th>Change %</th><th>Matched Strategies</th><th>Confidence</th><th>Level</th><th>Action</th><th>Score Reasons / Rules</th><th>Data Quality / Missing Fields</th><th>Evaluated At</th></tr></thead>
          <tbody>{rows.map((row) => <tr key={row.ticker} className={row.matched_strategies.includes('CLOSING_PRIORITY') ? 'top-priority-row' : ''} data-testid="screening-result">
            <td data-label="Ticker"><Link href={`/?symbol=${encodeURIComponent(row.ticker)}`}>{row.ticker}</Link></td>
            <td data-label="Close">{formatPrice(row.close)}</td>
            <td data-label="Change %" className={(row.change_percent ?? 0) > 0 ? 'change-positive' : (row.change_percent ?? 0) < 0 ? 'change-negative' : ''}>{formatChange(row.change_percent)}</td>
            <td data-label="Matched Strategies"><div className="unified-badges">{row.matched_strategies.length ? row.matched_strategies.map((id) => <span key={id} className={`strategy-badge strategy-${id.toLowerCase()}`}>{STRATEGY_LABELS[id]}</span>) : <span className="strategy-none">Belum match</span>}</div></td>
            <td data-label="Confidence Score">{row.confidence_score ?? '—'}</td>
            <td data-label="Confidence Level">{row.confidence_level ? <span className={`confidence-${row.confidence_level.toLowerCase()}`}>{row.confidence_level}</span> : '—'}</td>
            <td data-label="Action">{row.action ?? '—'}</td>
            <td data-label="Score Reasons / Rules"><RuleDetails row={row} /></td>
            <td data-label="Data Quality"><span className={`quality-${row.data_quality.toLowerCase()}`}>{row.data_quality}</span>{row.missing_fields.length > 0 && <small className="missing-fields">{row.missing_fields.join(', ')}</small>}</td>
            <td data-label="Evaluated At">{formatWib(row.evaluated_at)}</td>
          </tr>)}</tbody>
        </table>
      </div> : <section className="ranking-empty" data-testid="screening-empty">
        <h2>{snapshot.data.length ? 'Tidak ada saham yang cocok dengan filter.' : snapshot.run ? 'Snapshot ini belum memiliki hasil pipeline terpadu.' : 'Belum ada run screener.'}</h2>
        <p>{snapshot.data.length ? 'Ubah filter strategi atau ticker.' : 'Jalankan Screener untuk membuat satu snapshot seluruh strategi dengan data produksi yang tersedia.'}</p>
      </section>}
    </>}

    <p className="ranking-disclaimer">Screener adalah alat bantu berbasis data, bukan rekomendasi membeli atau menjual saham. Confidence score hanya berlaku untuk intersection BSJP dan ARA Hunter.</p>
  </main>;
}
