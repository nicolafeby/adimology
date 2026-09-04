export interface StockInput {
  emiten: string;
  fromDate: string;
  toDate: string;
}

export interface MarketDetectorBroker {
  netbs_broker_code: string;
  bval: string;
  blot: string;
  netbs_buy_avg_price: string;
}

// Broker Summary Types
export interface BrokerTopStat {
  vol: number;
  percent: number;
  amount: number;
  accdist: string;
}

export interface BrokerDetector {
  top1: BrokerTopStat;
  top3: BrokerTopStat;
  top5: BrokerTopStat;
  avg: BrokerTopStat;
  total_buyer: number;
  total_seller: number;
  number_broker_buysell: number;
  broker_accdist: string;
  volume: number;
  value: number;
  average: number;
}

export interface BrokerBuyItem {
  netbs_broker_code: string;
  bval: string;
  blot: string;
  netbs_buy_avg_price: string;
  type: string;
}

export interface BrokerSellItem {
  netbs_broker_code: string;
  sval: string;
  slot: string;
  netbs_sell_avg_price: string;
  type: string;
}

export interface BrokerSummaryData {
  detector: BrokerDetector;
  topBuyers: BrokerBuyItem[];
  topSellers: BrokerSellItem[];
}

export interface MarketDetectorResponse {
  data: {
    broker_summary: {
      brokers_buy: BrokerBuyItem[];
      brokers_sell: BrokerSellItem[];
    };
    bandar_detector: BrokerDetector;
  };
}

export interface OrderbookData {
  close: number;
  high: number;
  ara: { value: string };
  arb: { value: string };
  offer: { price: string; que_num: string; volume: string; change_percentage: string }[];
  bid: { price: string; que_num: string; volume: string; change_percentage: string }[];
  total_bid_offer: {
    bid: { lot: string };
    offer: { lot: string };
  };
}

export interface OrderbookResponse {
  data: OrderbookData;
}


export interface BrokerData {
  bandar: string;
  barangBandar: number;
  rataRataBandar: number;
}

export interface MarketData {
  harga: number;
  offerTeratas: number;
  bidTerbawah: number;
  fraksi: number;
  totalBid: number;
  totalOffer: number;
}

export interface OrderbookLevel {
  price: number;
  volume: number;
  queues: number;
  changePercentage: number;
}

export interface OrderbookSnapshot {
  bid: OrderbookLevel[];
  offer: OrderbookLevel[];
}

export interface AnalysisMetric {
  key: string;
  label: string;
  value: number | string | null;
  unit?: string;
  signal: 'positive' | 'neutral' | 'negative' | 'unavailable';
  description: string;
}

export interface AnalysisComponent {
  key: 'brokerFlow' | 'technical' | 'fundamental' | 'valuation' | 'liquidity' | 'catalyst' | 'marketRegime';
  label: string;
  weight: number;
  score: number | null;
  available: boolean;
  metrics: AnalysisMetric[];
  /** Stored inside the existing components JSON for schema-compatible persistence. */
  marketContext?: { regime: MarketRegimeAnalysis; relativeStrength: RelativeStrengthAnalysis; gate: MarketGateAudit };
}

export interface ComprehensiveAnalysis {
  score: number;
  /** Percentage of weighted inputs that were available. */
  dataCompleteness: number;
  /** Reliability of the evidence inside the available inputs. */
  confidence: number;
  /** Degree to which the available component scores point in the same direction. */
  agreement: number;
  label: 'Kuat' | 'Positif' | 'Netral' | 'Hati-hati' | 'Lemah';
  horizon: string;
  generatedAt: string;
  components: AnalysisComponent[];
  warnings: string[];
}

export type DecisionVerdict = 'buy_now' | 'wait_for_pullback' | 'watch' | 'avoid' | 'insufficient_data';
export type DecisionInvalidationKind = 'price' | 'signal' | 'time';

export interface TradingDecision {
  verdict: DecisionVerdict;
  verdictLabel: string;
  entry: { lower: number | null; upper: number | null; reference: number | null; rationale: string };
  stop: { price: number | null; riskPercent: number | null; rationale: string };
  targets: { target1: number | null; target2: number | null; rewardPercent1: number | null; rewardPercent2: number | null; rationale: string };
  riskReward: { target1: number | null; target2: number | null };
  invalidations: Array<{ kind: DecisionInvalidationKind; condition: string }>;
  validUntil: { tradingSessions: number; date: string | null };
  confidence: number;
  dataCompleteness: number;
  reasons: string[];
  warnings: string[];
  generatedAt: string;
  modelVersion: string;
  freshness: { dataAgeMinutes: number | null; orderbookFresh: boolean; aiStoryFresh: boolean | null; refreshRequired: boolean; executionDataStatus: 'fresh' | 'stale' | 'historical_unavailable' };
  inputs: Record<string, number | string | boolean | null>;
  thresholds: Record<string, number>;
  atrPercent: number | null;
  positionSizing: { riskPerShare: number; riskBudget: number; maximumShares: number; maximumLots: number; positionValue: number; positionRisk: number } | null;
}

/** @deprecated Use TradingDecision. */
export type TradeDecision = TradingDecision;

export interface PositionSizingOptions {
  /** Total trading capital available, in rupiah. */
  accountSize?: number;
  /** Maximum capital at risk if the stop is hit, in percent. */
  riskPercent?: number;
  /** ATR multiple used to place the stop. */
  atrMultiplier?: number;
}

export type TrendSignal = 'early_uptrend' | 'confirmed_uptrend' | 'watch' | 'avoid';
export type MarketRegimeLabel = 'bullish' | 'neutral' | 'bearish' | 'unavailable';
export type RelativeStrengthLabel = 'strong' | 'moderate' | 'weak' | 'unavailable';

export interface MarketRegimeAnalysis {
  label: MarketRegimeLabel;
  score: number | null;
  reasons: string[];
  dataCompleteness: number;
  features: { sessions: number; latestClose: number | null; return5d: number | null; return20d: number | null; sma20: number | null; priceVsSma20: number | null; sma20Trend: number | null; relativeVolume: number | null };
}

export interface RelativeStrengthAnalysis {
  label: RelativeStrengthLabel;
  rs5d: number | null;
  rs20d: number | null;
  sectorRs5d: number | null;
  sectorRs20d: number | null;
  stockReturn5d: number | null;
  stockReturn20d: number | null;
  marketReturn5d: number | null;
  marketReturn20d: number | null;
  sectorReturn5d: number | null;
  sectorReturn20d: number | null;
  dataCompleteness: number;
}

export interface MarketGateAudit {
  applied: boolean;
  signalBeforeGate: TrendSignal;
  signalAfterGate: TrendSignal;
  exceptionalStrength: boolean;
  reason: string;
  confidenceAdjustment: number;
  confidenceBefore: number | null;
  confidenceAfter: number | null;
}

export interface RankingReason {
  label: string;
  value: string;
  positive: boolean;
}

export interface StockRanking {
  id?: number;
  analysis_date: string;
  symbol: string;
  rank: number;
  score: number;
  data_completeness: number;
  model_probability: number | null;
  signal: TrendSignal;
  last_price: number;
  reasons: RankingReason[];
  risk_flags: string[];
  components: AnalysisComponent[];
  /** Optional so rankings persisted before regime-gate-v3 remain readable. */
  market_context?: { regime: MarketRegimeAnalysis; relativeStrength: RelativeStrengthAnalysis; gate: MarketGateAudit };
  decision?: TradingDecision;
  created_at?: string;
}

export interface BacktestSummary {
  sampleSize: number;
  winRate5d: number | null;
  winRate10d: number | null;
  winRate20d: number | null;
  averageReturn10d: number | null;
  grossAverageReturn10d: number | null;
  expectancy10d: number | null;
  maxDrawdown10d: number | null;
  costAssumptions: {
    buyFeePercent: number;
    sellFeePercent: number;
    slippagePercentPerSide: number;
  };
  targetHitRate: number | null;
  stopHitRate: number | null;
  brierScore: number | null;
}

export interface CalculatedData {
  totalPapan: number;
  rataRataBidOfer: number | null;
  a: number;
  p: number | null;
  targetRealistis1: number | null;
  targetMax: number | null;
}

export interface StockAnalysisResult {
  input: StockInput;
  stockbitData: BrokerData;
  marketData: MarketData;
  /** Latest execution snapshot, intentionally separate from the selected analysis date. */
  executionMarketData?: MarketData;
  executionOrderbook?: OrderbookSnapshot;
  executionUpdatedAt?: string;
  calculated: CalculatedData;
  brokerSummary?: BrokerSummaryData;
  isFromHistory?: boolean;
  historyDate?: string;
  sector?: string;
  orderbook?: OrderbookSnapshot;
  comprehensiveAnalysis?: ComprehensiveAnalysis;
  decisionContext?: { signal?: TrendSignal; marketRegime?: MarketRegimeLabel; marketGateBlocked?: boolean; hardRiskFlags?: string[]; dataWarnings?: string[]; ara?: number | null; orderbookGeneratedAt?: string; aiStoryGeneratedAt?: string | null; historicalSnapshot?: boolean; executionPrice?: number | null; bestBid?: number | null; bestOffer?: number | null; fallbackVolatilityPercent?: number | null };
}

export interface ApiResponse {
  success: boolean;
  data?: StockAnalysisResult;
  error?: string;
}

export interface WatchlistItem {
  id: string | number;  // Stockbit internal ID for the watchlist item
  company_id: number;
  company_code: string; // Keeping for compatibility, might be mapped from symbol
  symbol: string;       // New field from API
  company_name: string;
  last_price: number;
  change_point: number;
  change_percentage: number;
  percent: string;      // Percentage from API (e.g., "-1.23")
  volume: number;
  frequency: number;
  sector?: string;      // Sector information from emiten info API
  formatted_price?: string;
  formatted_change_point?: string;
  formatted_change_percentage?: string;
  flag?: 'OK' | 'NG' | 'Neutral' | null;
}

export interface WatchlistMetaResponse {
  message: string;
  data: {
    watchlist_id: number;
  };
}

export interface WatchlistDetailResponse {
  message: string;
  data: {
    watchlist_id: number;
    result: WatchlistItem[];
  };
}

export type WatchlistResponse = WatchlistDetailResponse; // Alias for backward compatibility if needed, or just use WatchlistDetailResponse

export interface WatchlistGroup {
  watchlist_id: number;
  name: string;
  description: string;
  is_default: boolean;
  is_favorite: boolean;
  emoji: string;
  category_type: string;
  total_items: number;
}

export interface WatchlistGroupsResponse {
  message: string;
  data: WatchlistGroup[];
}

export interface EmitenInfoResponse {
  data: {
    sector: string;
    sub_sector: string;
    symbol: string;
    name: string;
    price: string;
    change: string;
    percentage: number;
  };
  message: string;
}

// KeyStats types
export interface KeyStatsItem {
  id: string;
  name: string;
  value: string;
}

export interface KeyStatsCategory {
  keystats_name: string;
  fin_name_results: {
    fitem: KeyStatsItem;
    hidden_graph_ico: boolean;
    is_new_update: boolean;
  }[];
}

export interface KeyStatsResponse {
  data: {
    closure_fin_items_results: KeyStatsCategory[];
  };
  message: string;
}

// Processed KeyStats data for UI
export interface KeyStatsData {
  currentValuation: KeyStatsItem[];
  incomeStatement: KeyStatsItem[];
  balanceSheet: KeyStatsItem[];
  profitability: KeyStatsItem[];
  growth: KeyStatsItem[];
  warning?: string;
}

// Agent Story Types
export interface MatriksStoryItem {
  kategori_story: string;
  deskripsi_katalis: string;
  logika_ekonomi_pasar: string;
  potensi_dampak_harga: string;
}

export interface SwotAnalysis {
  strengths: string[];
  weaknesses: string[];
  opportunities: string[];
  threats: string[];
  ai_scoring?: AiStoryScoring;
}

export interface AiStoryScoring {
  model?: string;
  score: number;
  confidence: number;
  sentiment: 'positive' | 'neutral' | 'negative';
  rationale: string;
  positive_catalysts: string[];
  negative_risks: string[];
}

export interface ChecklistKatalis {
  item: string;
  dampak_instan: string;
}

export interface StrategiTrading {
  tipe_saham: string;
  target_entry: string;
  exit_strategy: {
    take_profit: string;
    stop_loss: string;
  };
}

export interface SourceCitation {
  title: string;
  uri: string;
}

export interface AgentStoryResult {
  id?: number;
  emiten: string;
  status: 'pending' | 'processing' | 'completed' | 'error';
  matriks_story?: MatriksStoryItem[];
  swot_analysis?: SwotAnalysis;
  checklist_katalis?: ChecklistKatalis[];
  keystat_signal?: string;
  strategi_trading?: StrategiTrading;
  kesimpulan?: string;
  error_message?: string;
  created_at?: string;
  sources?: SourceCitation[];
}


// Background Job Log Types
export interface BackgroundJobLogEntry {
  timestamp: string;
  level: 'info' | 'warn' | 'error';
  message: string;
  emiten?: string;
  details?: Record<string, unknown>;
}

export interface BackgroundJobLog {
  id: number;
  job_name: string;
  status: 'running' | 'completed' | 'failed';
  started_at: string;
  completed_at?: string;
  success_count: number;
  error_count: number;
  total_items: number;
  log_entries: BackgroundJobLogEntry[];
  error_message?: string;
  metadata?: Record<string, unknown>;
}
