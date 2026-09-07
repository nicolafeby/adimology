export type FactorRole = 'eligibility_gate' | 'ranking_factor' | 'risk_modifier' | 'informational';
export type FactorHorizon = 'short_term' | 'swing' | 'medium_term' | 'execution_only' | 'context_only';

export const ACTIVE_STRATEGY_PROFILE = Object.freeze({
  key: 'swing_5_20d', version: 'swing-v1', holdingPeriodMin: 5, holdingPeriodMax: 20,
  rationale: 'Momentum 5–20 sesi menjadi bukti arah; microstructure hanya menilai eksekusi.',
} as const);

export const LIQUIDITY_POLICY = Object.freeze({
  version: 'liquidity-v2', lotSizeShares: 100, historySessions: 20, minimumHistorySessions: 15,
  referenceNotionalsIdr: [10_000_000, 25_000_000, 50_000_000, 100_000_000] as const,
  maximumParticipationPercent: 2, maximumSpreadPercent: 3, maximumSlippagePercentPerSide: 1.5,
  maximumOrderbookAgeMinutes: 20, minimumDepthCoveragePercent: 100,
  rationale: 'Posisi harus dapat masuk dan keluar tanpa memakai asumsi modal personal.',
} as const);

export const BROKER_FLOW_POLICY = Object.freeze({
  version: 'broker-persistence-v2', windows: [5, 10, 20] as const, minimumSessions: 5,
  reliableSessions: 10, extremeTop3ConcentrationPercent: 70,
  rationale: 'Persistensi lintas sesi lebih relevan daripada label/snapshot tunggal.',
} as const);

export const SECTOR_PEER_POLICY = Object.freeze({
  version: 'sector-relative-v1', minimumPeerSample: 8,
  fallbackOrder: ['subsector', 'sector', 'compatible_industry', 'market', 'unavailable'] as const,
  winsorLowerPercentile: 5, winsorUpperPercentile: 95,
  sectorFamilies: { financials: ['bank', 'banks', 'financial', 'finance'], general: [] as string[] },
  rationale: 'Valuasi dan leverage dibandingkan dengan peer kompatibel pada cutoff yang sama.',
} as const);

export const EXECUTION_POLICY = Object.freeze({
  version: 'execution-v2', role: 'eligibility_gate' as const, horizon: 'execution_only' as const,
  normalBookRule: 'best_bid_strictly_less_than_best_offer', directionalOrderbookWeight: 0,
  rationale: 'Snapshot orderbook mengukur tradability, bukan arah swing.',
} as const);

export const SCREENER_FACTOR_CONFIG = Object.freeze({
  version: 'swing-factors-v2', strategyProfile: ACTIVE_STRATEGY_PROFILE,
  factors: {
    momentum_5d: { role: 'ranking_factor', horizon: 'short_term', weight: 10, missingDataPolicy: 'exclude_and_penalize' },
    momentum_20d: { role: 'ranking_factor', horizon: 'swing', weight: 20, missingDataPolicy: 'exclude_and_penalize' },
    relative_strength_20d: { role: 'ranking_factor', horizon: 'swing', weight: 20, missingDataPolicy: 'exclude_and_penalize' },
    broker_persistence: { role: 'ranking_factor', horizon: 'swing', weight: 20, missingDataPolicy: 'exclude_and_penalize' },
    fundamental_quality: { role: 'risk_modifier', horizon: 'context_only', weight: 10, missingDataPolicy: 'exclude' },
    valuation_relative: { role: 'informational', horizon: 'context_only', weight: 0, missingDataPolicy: 'exclude' },
    execution_quality: { role: 'eligibility_gate', horizon: 'execution_only', weight: 0, missingDataPolicy: 'fail_gate' },
    relative_volume: { role: 'informational', horizon: 'short_term', weight: 0, missingDataPolicy: 'exclude' },
    market_regime: { role: 'risk_modifier', horizon: 'context_only', weight: 10, missingDataPolicy: 'exclude' },
    ai_news: { role: 'informational', horizon: 'context_only', weight: 0, missingDataPolicy: 'exclude' },
  },
} as const);

export const FACTOR_LINEAGE = Object.freeze([
  { factor: 'momentum_5d', sourceMetrics: ['close_0', 'close_5'], usedBy: ['confirmation', 'ranking'], independenceWarning: 'Kedua output berasal dari seri harga yang sama.' },
  { factor: 'execution_quality', sourceMetrics: ['orderbook_bid', 'orderbook_offer'], usedBy: ['eligibility'], independenceWarning: null },
  { factor: 'near_touch_imbalance', sourceMetrics: ['orderbook_bid', 'orderbook_offer'], usedBy: ['informational'], independenceWarning: 'Tidak digunakan sebagai bukti arah swing.' },
  { factor: 'broker_persistence', sourceMetrics: ['broker_history'], usedBy: ['ranking'], independenceWarning: null },
] as const);
