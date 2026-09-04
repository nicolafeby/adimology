import { createClient } from '@supabase/supabase-js';
import type { IdxListedCompany } from './idx';
import { decryptSecret, encryptSecret, isSensitiveSessionKey } from './secret-storage';
import { calibrateProbability, scoreBucket, type CalibratedProbability, type MarketRegime } from './probability-calibration';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

let supabaseAdmin: typeof supabase | null = null;

function getSupabaseAdmin() {
  if (supabaseAdmin) return supabaseAdmin;

  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceRoleKey) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is required for server-side session access');
  }

  supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });

  return supabaseAdmin;
}

/**
 * Save stock query to database
 */
export async function saveStockQuery(data: {
  emiten: string;
  sector?: string;
  from_date?: string;
  to_date?: string;
  bandar?: string;
  barang_bandar?: number;
  rata_rata_bandar?: number;
  harga?: number;
  ara?: number;
  arb?: number;
  fraksi?: number;
  total_bid?: number;
  total_offer?: number;
  total_papan?: number;
  rata_rata_bid_ofer?: number | null;
  a?: number;
  p?: number | null;
  target_realistis?: number | null;
  target_max?: number | null;
}) {
  const { data: result, error } = await supabase
    .from('stock_queries')
    .upsert([data], { onConflict: 'from_date,emiten' })
    .select();

  if (error) {
    console.error('Error saving to Supabase:', error);
    throw error;
  }

  return result;
}

/**
 * Get session value by key
 */
export async function getSessionValue(key: string): Promise<string | null> {
  const { data, error } = await getSupabaseAdmin()
    .from('session')
    .select('value')
    .eq('key', key)
    .single();

  if (error || !data) return null;
  return isSensitiveSessionKey(key) ? decryptSecret(data.value) : data.value;
}

/**
 * Token status interface
 */
export interface TokenStatus {
  exists: boolean;
  isValid: boolean;
  expiresAt?: string;
  lastUsedAt?: string;
  updatedAt?: string;
  isExpiringSoon: boolean;  // Within 1 hour of expiry
  isExpired: boolean;
  hoursUntilExpiry?: number;
}

/**
 * Get full token status including expiry information
 */
export async function getTokenStatus(): Promise<TokenStatus> {
  const { data, error } = await getSupabaseAdmin()
    .from('session')
    .select('value, expires_at, last_used_at, is_valid, updated_at')
    .eq('key', 'stockbit_token')
    .single();

  if (error || !data) {
    return {
      exists: false,
      isValid: false,
      isExpiringSoon: false,
      isExpired: true,
    };
  }

  const now = new Date();
  const expiresAt = data.expires_at ? new Date(data.expires_at) : null;
  const isExpired = expiresAt ? expiresAt < now : false;
  const hoursUntilExpiry = expiresAt 
    ? (expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60) 
    : undefined;
  const isExpiringSoon = hoursUntilExpiry !== undefined && hoursUntilExpiry <= 1 && hoursUntilExpiry > 0;

  return {
    exists: true,
    isValid: data.is_valid !== false && !isExpired,
    expiresAt: data.expires_at,
    lastUsedAt: data.last_used_at,
    updatedAt: data.updated_at,
    isExpiringSoon,
    isExpired,
    hoursUntilExpiry,
  };
}

/**
 * Upsert session value with optional expiry
 */
export async function upsertSession(
  key: string, 
  value: string, 
  expiresAt?: Date
) {
  const storedValue = isSensitiveSessionKey(key) ? encryptSecret(value) : value;
  const { data, error } = await getSupabaseAdmin()
    .from('session')
    .upsert(
      { 
        key, 
        value: storedValue,
        updated_at: new Date().toISOString(),
        expires_at: expiresAt?.toISOString() || null,
        is_valid: true,
        last_used_at: new Date().toISOString(),
      },
      { onConflict: 'key' }
    )
    .select();

  if (error) throw error;
  return data;
}

/**
 * Update token last used timestamp (call after successful API request)
 */
export async function updateTokenLastUsed() {
  const { error } = await getSupabaseAdmin()
    .from('session')
    .update({ last_used_at: new Date().toISOString() })
    .eq('key', 'stockbit_token');

  if (error) {
    console.error('Error updating token last_used_at:', error);
  }
}

/**
 * Mark token as invalid (call when receiving 401 from Stockbit API)
 */
export async function invalidateToken() {
  const { error } = await getSupabaseAdmin()
    .from('session')
    .update({ is_valid: false })
    .eq('key', 'stockbit_token');

  if (error) {
    console.error('Error invalidating token:', error);
  }
}

/**
 * Set token expiry time (typically 24 hours from login)
 */
export async function setTokenExpiry(hoursFromNow: number = 24) {
  const expiresAt = new Date();
  expiresAt.setHours(expiresAt.getHours() + hoursFromNow);
  
  const { error } = await getSupabaseAdmin()
    .from('session')
    .update({ expires_at: expiresAt.toISOString() })
    .eq('key', 'stockbit_token');

  if (error) {
    console.error('Error setting token expiry:', error);
  }
}

/**
 * Save watchlist analysis to database (reusing stock_queries table)
 */
export async function saveWatchlistAnalysis(data: {
  from_date: string;  // analysis date
  to_date: string;    // same as from_date for daily analysis
  emiten: string;
  sector?: string;
  bandar?: string;
  barang_bandar?: number;
  rata_rata_bandar?: number;
  harga?: number;
  ara?: number;       // offer_teratas
  arb?: number;       // bid_terbawah
  fraksi?: number;
  total_bid?: number;
  total_offer?: number;
  total_papan?: number;
  rata_rata_bid_ofer?: number | null;
  a?: number;
  p?: number | null;
  target_realistis?: number | null;
  target_max?: number | null;
  status?: string;
  error_message?: string;
}) {
  const { data: result, error } = await supabase
    .from('stock_queries')
    .upsert([data], { onConflict: 'from_date,emiten' })
    .select();

  if (error) {
    console.error('Error saving watchlist analysis:', error);
    throw error;
  }

  return result;
}

/**
 * Get watchlist analysis history with optional filters
 */
export async function getWatchlistAnalysisHistory(filters?: {
  emiten?: string;
  sector?: string;
  fromDate?: string;
  toDate?: string;
  status?: string;
  limit?: number;
  offset?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}) {
  let query = supabase
    .from('stock_queries')
    .select('*', { count: 'exact' });

  // Handle sorting
  const sortBy = filters?.sortBy || 'from_date';
  const sortOrder = filters?.sortOrder || 'desc';

  if (sortBy === 'combined') {
    // Sort by date then emiten
    query = query
      .order('from_date', { ascending: sortOrder === 'asc' })
      .order('emiten', { ascending: sortOrder === 'asc' });
  } else if (sortBy === 'emiten') {
    // When sorting by emiten, secondary sort by date ascending
    query = query
      .order('emiten', { ascending: sortOrder === 'asc' })
      .order('from_date', { ascending: true });
  } else {
    query = query.order(sortBy, { ascending: sortOrder === 'asc' });
  }

  if (filters?.emiten) {
    const emitenList = filters.emiten.split(/\s+/).filter(Boolean);
    if (emitenList.length > 0) { // Changed to always use .in() if emitens are present
      query = query.in('emiten', emitenList);
    }
  }
  if (filters?.sector) {
    query = query.eq('sector', filters.sector);
  }
  if (filters?.fromDate) {
    query = query.gte('from_date', filters.fromDate);
  }
  if (filters?.toDate) {
    query = query.lte('from_date', filters.toDate);
  }
  if (filters?.status) {
    query = query.eq('status', filters.status);
  }
  if (filters?.limit) {
    query = query.limit(filters.limit);
  }
  if (filters?.offset) {
    query = query.range(filters.offset, filters.offset + (filters.limit || 50) - 1);
  }

  const { data, error, count } = await query;

  if (error) {
    console.error('Error fetching watchlist analysis:', error);
    throw error;
  }

  return { data, count };
}

/**
 * Get latest stock query for a specific emiten
 */
export async function getLatestStockQuery(emiten: string) {
  const { data, error } = await supabase
    .from('stock_queries')
    .select('*')
    .eq('emiten', emiten)
    .eq('status', 'success')
    .order('from_date', { ascending: false })
    .limit(1)
    .single();

  if (error) return null;
  return data;
}

/** Read-only history used for multi-day broker-flow persistence scoring. */
export async function getRecentStockQueries(emiten: string, limit = 20) {
  const { data, error } = await supabase
    .from('stock_queries')
    .select('from_date, bandar, barang_bandar, rata_rata_bandar, harga, total_bid, total_offer')
    .eq('emiten', emiten.toUpperCase())
    .eq('status', 'success')
    .order('from_date', { ascending: false })
    .limit(limit);
  return error ? [] : (data ?? []);
}

/** Latest completed catalyst analysis; absence must never fail stock analysis. */
export async function getLatestCompletedAgentStory(emiten: string) {
  const { data, error } = await supabase
    .from('agent_stories')
    .select('matriks_story, swot_analysis, kesimpulan, sources, created_at')
    .eq('emiten', emiten.toUpperCase())
    .eq('status', 'completed')
    .order('created_at', { ascending: false })
    .limit(1)
    .single();
  return error ? null : data;
}

/**
 * Get specific stock query for a given emiten and date range
 */
export async function getSpecificStockQuery(emiten: string, fromDate: string, toDate: string) {
  const { data, error } = await supabase
    .from('stock_queries')
    .select('*')
    .eq('emiten', emiten.toUpperCase())
    .eq('from_date', fromDate)
    .eq('to_date', toDate)
    .eq('status', 'success')
    .limit(1)
    .single();

  if (error) return null;
  return data;
}

/**
 * Get stock price for a specific emiten on a specific date (matching from_date)
 */
export async function getStockPriceByDate(emiten: string, date: string) {
  const { data, error } = await supabase
    .from('stock_queries')
    .select('harga, ara, arb, total_bid, total_offer, fraksi')
    .eq('emiten', emiten.toUpperCase())
    .eq('from_date', date)
    .eq('status', 'success')
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (error) return null;
  return data;
}

/**
 * Update the most recent previous day's real price for an emiten
 */
export async function updatePreviousDayRealPrice(emiten: string, currentDate: string, price: number, maxPrice?: number) {
  // 1. Find the latest successful record before currentDate
  const { data: record, error: findError } = await supabase
    .from('stock_queries')
    .select('id, from_date')
    .eq('emiten', emiten)
    .eq('status', 'success')
    .lt('from_date', currentDate)
    .order('from_date', { ascending: false })
    .limit(1)
    .single();

  if (findError || !record) {
    if (findError && findError.code !== 'PGRST116') { // PGRST116 is "no rows returned"
      console.error(`Error finding previous record for ${emiten} before ${currentDate}:`, findError);
    }
    return null;
  }

  // 2. Update that record with the new price
  const updateData: { real_harga: number; max_harga?: number } = { real_harga: price };
  if (maxPrice !== undefined) {
    updateData.max_harga = maxPrice;
  }

  const { data, error: updateError } = await supabase
    .from('stock_queries')
    .update(updateData)
    .eq('id', record.id)
    .select();

  if (updateError) {
    console.error(`Error updating real_harga for ${emiten} on ${record.from_date}:`, updateError);
  }

  return data;
}

/**
 * Evaluate every pending signal for an emiten using the next available trading
 * session. This makes the outcome deterministic across weekends and holidays
 * and also backfills older rows when sufficient price history is supplied.
 */
export async function updatePendingRealPrices(
  emiten: string,
  prices: Array<{ date: string; close: number; high: number }>
) {
  const normalizedPrices = prices
    .map(price => ({ ...price, marketDate: price.date.slice(0, 10) }))
    .filter(price => Number.isFinite(price.close) && Number.isFinite(price.high))
    .sort((a, b) => a.marketDate.localeCompare(b.marketDate));

  if (normalizedPrices.length === 0) return [];

  const { data: records, error: findError } = await supabase
    .from('stock_queries')
    .select('id, from_date')
    .eq('emiten', emiten.toUpperCase())
    .eq('status', 'success')
    .is('max_harga', null)
    .order('from_date', { ascending: true });

  if (findError) {
    console.error(`Error finding pending outcomes for ${emiten}:`, findError);
    throw findError;
  }

  const updates = (records || []).flatMap(record => {
    const nextSession = normalizedPrices.find(price => price.marketDate > record.from_date);
    return nextSession ? [{ id: record.id, price: nextSession }] : [];
  });

  return Promise.all(updates.map(async ({ id, price }) => {
    const { error } = await supabase
      .from('stock_queries')
      .update({ real_harga: price.close, max_harga: price.high })
      .eq('id', id);

    if (error) {
      console.error(`Error evaluating stock query ${id} for ${emiten}:`, error);
      throw error;
    }

    return id;
  }));
}

/**
 * Create a new agent story record with pending status
 */
export async function createAgentStory(emiten: string) {
  const { data, error } = await supabase
    .from('agent_stories')
    .insert({ emiten, status: 'pending' })
    .select()
    .single();

  if (error) {
    console.error('Error creating agent story:', error);
    throw error;
  }

  return data;
}

/**
 * Update agent story with result or error
 */
export async function updateAgentStory(id: number, data: {
  status: 'processing' | 'completed' | 'error';
  matriks_story?: object[];
  swot_analysis?: object;
  checklist_katalis?: object[];
  keystat_signal?: string;
  strategi_trading?: object;
  kesimpulan?: string;
  error_message?: string;
  sources?: { title: string; uri: string }[];
}) {

  const { data: result, error } = await supabase
    .from('agent_stories')
    .update(data)
    .eq('id', id)
    .select()
    .single();

  if (error) {
    console.error('Error updating agent story:', error);
    throw error;
  }

  return result;
}

/**
 * Get latest agent story for an emiten
 */
export async function getAgentStoryByEmiten(emiten: string) {
  const { data, error } = await supabase
    .from('agent_stories')
    .select('*')
    .eq('emiten', emiten.toUpperCase())
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (error && error.code !== 'PGRST116') {
    console.error('Error fetching agent story:', error);
  }

  return data || null;
}

/**
 * Get all agent stories for an emiten
 */
export async function getAgentStoriesByEmiten(emiten: string, limit: number = 20) {
  const { data, error } = await supabase
    .from('agent_stories')
    .select('*')
    .eq('emiten', emiten.toUpperCase())
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) {
    console.error('Error fetching agent stories:', error);
    throw error;
  }

  return data || [];
}

/**
 * Create a new background job log entry
 */
export async function createBackgroundJobLog(jobName: string, totalItems: number = 0) {
  const { data, error } = await supabase
    .from('background_job_logs')
    .insert({
      job_name: jobName,
      status: 'running',
      total_items: totalItems,
      log_entries: [],
    })
    .select()
    .single();

  if (error) {
    console.error('Error creating background job log:', error);
    throw error;
  }

  return data;
}

/**
 * Append a log entry to an existing job log
 */
export async function appendBackgroundJobLogEntry(
  jobId: number,
  entry: {
    level: 'info' | 'warn' | 'error';
    message: string;
    emiten?: string;
    details?: Record<string, unknown>;
  }
) {
  const logEntry = {
    timestamp: new Date().toISOString(),
    ...entry,
  };

  // Use raw SQL to append to JSONB array for atomic operation
  const { error } = await supabase.rpc('append_job_log_entry', {
    p_job_id: jobId,
    p_entry: logEntry,
  });

  // If RPC doesn't exist, fallback to fetch-and-update
  if (error && error.code === 'PGRST202') {
    const { data: current } = await supabase
      .from('background_job_logs')
      .select('log_entries')
      .eq('id', jobId)
      .single();

    const entries = current?.log_entries || [];
    entries.push(logEntry);

    await supabase
      .from('background_job_logs')
      .update({ log_entries: entries })
      .eq('id', jobId);
  } else if (error) {
    console.error('Error appending job log entry:', error);
  }
}

/**
 * Update background job log with final status
 */
export async function updateBackgroundJobLog(
  jobId: number,
  data: {
    status: 'completed' | 'failed';
    success_count?: number;
    error_count?: number;
    error_message?: string;
    metadata?: Record<string, unknown>;
  }
) {
  const { data: result, error } = await supabase
    .from('background_job_logs')
    .update({
      ...data,
      completed_at: new Date().toISOString(),
    })
    .eq('id', jobId)
    .select()
    .single();

  if (error) {
    console.error('Error updating background job log:', error);
    throw error;
  }

  return result;
}

/**
 * Get background job logs with pagination
 */
export async function getBackgroundJobLogs(filters?: {
  jobName?: string;
  status?: string;
  limit?: number;
  offset?: number;
}) {
  let query = supabase
    .from('background_job_logs')
    .select('*', { count: 'exact' })
    .order('started_at', { ascending: false });

  if (filters?.jobName) {
    query = query.eq('job_name', filters.jobName);
  }
  if (filters?.status) {
    query = query.eq('status', filters.status);
  }
  if (filters?.limit) {
    query = query.limit(filters.limit);
  }
  if (filters?.offset) {
    query = query.range(filters.offset, filters.offset + (filters.limit || 20) - 1);
  }

  const { data, error, count } = await query;

  if (error) {
    console.error('Error fetching background job logs:', error);
    throw error;
  }

  return { data: data || [], count };
}

/**
 * Get the latest job log for a specific job name
 */
export async function getLatestBackgroundJobLog(jobName: string) {
  const { data, error } = await supabase
    .from('background_job_logs')
    .select('*')
    .eq('job_name', jobName)
    .order('started_at', { ascending: false })
    .limit(1)
    .single();

  if (error && error.code !== 'PGRST116') {
    console.error('Error fetching latest job log:', error);
  }

  return data || null;
}

/**
 * Get a profile setting by key
 */
export async function getProfileSetting(key: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('profile')
    .select('value')
    .eq('key', key)
    .single();

  if (error || !data) return null;
  return data.value;
}

/**
 * Set a profile setting (upsert)
 */
export async function setProfileSetting(key: string, value: string) {
  const { data, error } = await supabase
    .from('profile')
    .upsert(
      { key, value, updated_at: new Date().toISOString() },
      { onConflict: 'key' }
    )
    .select()
    .single();

  if (error) {
    console.error('Error saving profile setting:', error);
    throw error;
  }

  return data;
}

/**
 * Get emiten summary statistics for hit targets
 */
export async function getEmitenSummaryStats(limit: number = 5) {
  // 1. Get all successful analysis records
  // We need to fetch enough records to cover the 'limit' for each emiten
  // Since we don't know which emitens have recent data, we'll fetch a larger set first
  const { data, error } = await supabase
    .from('stock_queries')
    .select('emiten, sector, target_realistis, target_max, max_harga, real_harga, status, from_date, bandar')
    .eq('status', 'success')
    .order('from_date', { ascending: false });

  if (error) {
    console.error('Error fetching summary stats:', error);
    throw error;
  }

  // 2. Aggregate data per emiten
  const emitenGroups: Record<string, any[]> = {};
  data.forEach(record => {
    if (!emitenGroups[record.emiten]) {
      emitenGroups[record.emiten] = [];
    }
    if (emitenGroups[record.emiten].length < limit) {
      emitenGroups[record.emiten].push(record);
    }
  });

  // 3. Calculate stats for each emiten
  const stats = Object.entries(emitenGroups).map(([emiten, records]) => {
    const tradingDays = records.length;
    const evaluatedRecords = records.filter(r => r.max_harga != null || r.real_harga != null);
    const evaluatedDays = evaluatedRecords.length;
    let hitR1 = 0;
    let hitMax = 0;
    const sector = records[0]?.sector; // Take sector from latest record

    // Calculate bandar frequencies
    const bandarCounts: Record<string, number> = {};
    
    evaluatedRecords.forEach(r => {
      // Prefer the intraday high, but keep close as a fallback for legacy rows.
      const realizedPrice = r.max_harga ?? r.real_harga;
      if (realizedPrice != null && r.target_realistis != null && realizedPrice >= r.target_realistis) {
        hitR1++;
      }
      if (realizedPrice != null && r.target_max != null && realizedPrice >= r.target_max) {
        hitMax++;
      }
    });

    records.forEach(r => {
      if (r.bandar) {
        bandarCounts[r.bandar] = (bandarCounts[r.bandar] || 0) + 1;
      }
    });

    // Get top 3 bandar with counts
    const topBandars = Object.entries(bandarCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([name, count]) => ({ name, count }));

    const hitRateR1 = evaluatedDays > 0 ? (hitR1 / evaluatedDays) * 100 : null;
    const hitRateMax = evaluatedDays > 0 ? (hitMax / evaluatedDays) * 100 : null;
    const totalHitRate = hitRateR1 != null && hitRateMax != null
      ? (hitRateR1 + hitRateMax) / 2
      : null;

    return {
      emiten,
      sector,
      tradingDays,
      evaluatedDays,
      hitR1,
      hitMax,
      hitRateR1,
      hitRateMax,
      totalHitRate,
      topBandars
    };
  });

  // 4. Sort by totalHitRate descending
  return stats.sort((a, b) => (b.totalHitRate ?? -1) - (a.totalHitRate ?? -1));
}

// ===== Watchlist Cache Functions =====

import type { WatchlistGroup } from './types';

/**
 * Check if there is any watchlist cache in the database
 */
export async function hasWatchlistCache(): Promise<boolean> {
  const { count, error } = await supabase
    .from('watchlist_groups')
    .select('*', { count: 'exact', head: true });

  if (error) return false;
  return (count || 0) > 0;
}

/**
 * Get cached watchlist groups from local database
 */
export async function getCachedWatchlistGroups(): Promise<{ groups: WatchlistGroup[]; synced_at: string | null }> {
  const { data, error } = await supabase
    .from('watchlist_groups')
    .select('*')
    .order('is_default', { ascending: false })
    .order('name', { ascending: true });

  if (error) {
    console.error('Error fetching cached watchlist groups:', error);
    return { groups: [], synced_at: null };
  }

  const groups: WatchlistGroup[] = (data || []).map((row: any) => ({
    watchlist_id: row.watchlist_id,
    name: row.name,
    description: row.description || '',
    is_default: row.is_default || false,
    is_favorite: row.is_favorite || false,
    emoji: row.emoji || '',
    category_type: row.category_type || '',
    total_items: row.total_items || 0,
  }));

  const synced_at = data?.[0]?.synced_at || null;

  return { groups, synced_at };
}

/**
 * Save watchlist groups from Stockbit to local database (upsert)
 */
export async function saveCachedWatchlistGroups(groups: WatchlistGroup[]): Promise<void> {
  const now = new Date().toISOString();
  const rows = groups.map(g => ({
    watchlist_id: g.watchlist_id,
    name: g.name,
    description: g.description || '',
    is_default: g.is_default || false,
    is_favorite: g.is_favorite || false,
    emoji: g.emoji || '',
    category_type: g.category_type || '',
    total_items: g.total_items || 0,
    synced_at: now,
  }));

  const { error } = await supabase
    .from('watchlist_groups')
    .upsert(rows, { onConflict: 'watchlist_id' });

  if (error) {
    console.error('Error saving cached watchlist groups:', error);
    throw error;
  }

  // Remove groups that no longer exist in Stockbit
  const activeIds = groups.map(g => g.watchlist_id);
  if (activeIds.length > 0) {
    const { error: deleteError } = await supabase
      .from('watchlist_groups')
      .delete()
      .not('watchlist_id', 'in', `(${activeIds.join(',')})`);

    if (deleteError) {
      console.error('Error cleaning up old watchlist groups:', deleteError);
    }
  }
}

/**
 * Get cached watchlist items for a specific group
 */
export async function getCachedWatchlistItems(watchlistId: number): Promise<{ items: any[]; synced_at: string | null }> {
  // First get the internal group id
  const { data: group, error: groupError } = await supabase
    .from('watchlist_groups')
    .select('id, synced_at')
    .eq('watchlist_id', watchlistId)
    .single();

  if (groupError || !group) {
    return { items: [], synced_at: null };
  }

  const { data, error } = await supabase
    .from('watchlist_items')
    .select(`
      stockbit_item_id,
      company_id,
      symbol,
      emiten_cache (
        name,
        sector,
        last_price,
        percent
      )
    `)
    .eq('watchlist_group_id', group.id)
    .order('symbol', { ascending: true });

  if (error) {
    console.error('Error fetching cached watchlist items:', error);
    return { items: [], synced_at: null };
  }

  // Map back to WatchlistItem-like format
  const items = (data || []).map((row: any) => ({
    id: row.stockbit_item_id,
    company_id: row.company_id,
    symbol: row.symbol,
    company_code: row.symbol, // For compatibility
    company_name: row.emiten_cache?.name || '',
    sector: row.emiten_cache?.sector || undefined,
    last_price: row.emiten_cache?.last_price !== null && row.emiten_cache?.last_price !== undefined 
      ? Number(row.emiten_cache.last_price) 
      : 0,
    percent: row.emiten_cache?.percent || '0',
  }));

  return { items, synced_at: group.synced_at };
}

/**
 * Save watchlist items for a specific group (full replace)
 */
export async function saveCachedWatchlistItems(
  watchlistId: number,
  items: any[]
): Promise<void> {
  // Get or create group record
  const { data: group, error: groupError } = await supabase
    .from('watchlist_groups')
    .select('id')
    .eq('watchlist_id', watchlistId)
    .single();

  if (groupError || !group) {
    console.error('Group not found for watchlist_id:', watchlistId);
    return;
  }

  const now = new Date().toISOString();

  // Insert/Update emiten data first
  if (items.length > 0) {
    const symbolsData = items.map((item: any) => ({
      symbol: (item.symbol || item.company_code || '').toUpperCase(),
      name: item.company_name || '',
      sector: item.sector || null,
      last_price: item.last_price ?? item.price ?? null,
      percent: item.percent || String(item.change_percentage || '0'),
      synced_at: now
    }));

    // Upsert into emiten_cache
    const { error: emitenError } = await supabase
      .from('emiten_cache')
      .upsert(symbolsData, { onConflict: 'symbol' });

    if (emitenError) {
      console.error('Error upserting emiten_cache:', emitenError);
      throw emitenError;
    }

    // Build associations for the selected group.
    const watchlistRows = items.map((item: any) => ({
      watchlist_group_id: group.id,
      stockbit_item_id: String(item.id || ''),
      company_id: item.company_id || null,
      symbol: (item.symbol || item.company_code || '').toUpperCase(),
    }));

    const { error: itemsError } = await supabase
      .from('watchlist_items')
      .delete()
      .eq('watchlist_group_id', group.id);

    if (itemsError) throw itemsError;

    const { error: insertError } = await supabase.from('watchlist_items').insert(watchlistRows);
    if (insertError) {
      console.error('Error saving cached watchlist items:', insertError);
      throw insertError;
    }
  } else {
    // An empty Stockbit watchlist must also clear previously cached items.
    const { error: itemsError } = await supabase
      .from('watchlist_items')
      .delete()
      .eq('watchlist_group_id', group.id);

    if (itemsError) throw itemsError;
  }

  // Update group synced_at
  await supabase
    .from('watchlist_groups')
    .update({ synced_at: now })
    .eq('id', group.id);
}

/**
 * Delete a cached watchlist item by symbol from a group
 */
export async function deleteCachedWatchlistItem(watchlistId: number, symbol: string): Promise<void> {
  const { data: group } = await supabase
    .from('watchlist_groups')
    .select('id')
    .eq('watchlist_id', watchlistId)
    .single();

  if (!group) return;

  const { error } = await supabase
    .from('watchlist_items')
    .delete()
    .eq('watchlist_group_id', group.id)
    .eq('symbol', symbol.toUpperCase());

  if (error) {
    console.error('Error deleting cached watchlist item:', error);
  }
}

// ===== Market screener, ranking, alerts, and signal evaluation =====

export async function getActiveIdxUniverse(limit = 1000) {
  const { data, error } = await getSupabaseAdmin()
    .from('idx_universe')
    .select('symbol, company_name, sector, board')
    .eq('is_active', true)
    .order('symbol')
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}

/** Bootstrap the screener from emitens already synced from Stockbit watchlists. */
export async function bootstrapIdxUniverseFromCache() {
  const db = getSupabaseAdmin();
  const { data: cached, error: cacheError } = await db.from('emiten_cache').select('symbol, name, sector');
  if (cacheError) throw cacheError;
  const rows = (cached ?? []).filter((row) => row.symbol).map((row) => ({
    symbol: String(row.symbol).toUpperCase(), company_name: row.name || '', sector: row.sector || null,
    board: null, is_active: true, updated_at: new Date().toISOString(),
  }));
  if (!rows.length) return [];
  const { data, error } = await db.from('idx_universe').upsert(rows, { onConflict: 'symbol' }).select();
  if (error) throw error;
  return data ?? [];
}

export async function saveIdxUniverse(companies: IdxListedCompany[]) {
  const rows = companies.map((company) => ({
    symbol: company.KodeEmiten.toUpperCase(), company_name: company.NamaEmiten || '',
    sector: company.Sektor || null, board: company.PapanPencatatan || null,
    is_active: true, updated_at: new Date().toISOString(),
  }));
  const db = getSupabaseAdmin();
  const saved: Array<{ symbol: string }> = [];
  for (let index = 0; index < rows.length; index += 250) {
    const { data, error } = await db.from('idx_universe').upsert(rows.slice(index, index + 250), { onConflict: 'symbol' }).select('symbol');
    if (error) throw error;
    saved.push(...(data ?? []));
  }
  return saved;
}

export async function ensureDefaultAlertRule() {
  const db = getSupabaseAdmin();
  const { count, error } = await db.from('alert_rules').select('*', { count: 'exact', head: true });
  if (error) throw error;
  if (count) return null;
  const { data, error: insertError } = await db.from('alert_rules').insert({
    name: 'Confirmed Uptrend', enabled: true, minimum_score: 70, minimum_probability: 0.6,
    minimum_completeness: 75, allowed_signals: ['confirmed_uptrend'], cooldown_hours: 24,
  }).select().single();
  if (insertError) throw insertError;
  return data;
}

export async function saveStockRankings(rows: Array<Record<string, unknown>>) {
  if (!rows.length) return [];
  const analysisDate = rows[0].analysis_date;
  if (typeof analysisDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(analysisDate)) {
    throw new Error('analysis_date ranking tidak valid');
  }
  if (rows.some((row) => row.analysis_date !== analysisDate)) {
    throw new Error('Semua ranking dalam satu snapshot harus memiliki analysis_date yang sama');
  }
  const db = getSupabaseAdmin();
  // A ranking run is a complete daily snapshot. Upsert the new snapshot first,
  // then remove stale symbols so a failed insert cannot erase the prior result.
  // market_context is embedded in the existing components JSON. Strip the
  // convenience projection so deployments do not require an added DB column.
  const persistedRows = rows.map(({ market_context: _marketContext, decision: _decision, ...row }) => row);
  const { data, error } = await db
    .from('stock_rankings')
    .upsert(persistedRows, { onConflict: 'analysis_date,symbol' })
    .select();
  if (error) throw error;
  const symbols = rows.map((row) => String(row.symbol)).filter((symbol) => /^[A-Z0-9]{4,12}$/.test(symbol));
  const { error: cleanupError } = await db.from('stock_rankings').delete().eq('analysis_date', analysisDate).not('symbol', 'in', `(${symbols.join(',')})`);
  if (cleanupError) throw cleanupError;
  const contextBySymbol = new Map(rows.map((row) => [String(row.symbol), row.market_context]));
  const decisionBySymbol = new Map(rows.map((row) => [String(row.symbol), row.decision]));
  return (data ?? []).map((row) => ({ ...row, market_context: contextBySymbol.get(String(row.symbol)), decision: decisionBySymbol.get(String(row.symbol)) }));
}

function hydrateRankingMarketContext<T extends { components?: unknown; market_context?: unknown }>(row: T): T {
  if (row.market_context || !Array.isArray(row.components)) return row;
  const component = row.components.find((item: { key?: string; marketContext?: unknown }) => item?.key === 'marketRegime' && item.marketContext);
  const context = component?.marketContext as { decision?: unknown } | undefined;
  return component ? { ...row, market_context: component.marketContext, ...(context?.decision ? { decision: context.decision } : {}) } : row;
}

export async function getStockRankings(date?: string, limit = 10) {
  const db = getSupabaseAdmin();
  let selectedDate = date;
  if (!selectedDate) {
    const { data: latest, error: latestError } = await db.from('stock_rankings').select('analysis_date').order('analysis_date', { ascending: false }).limit(1).maybeSingle();
    if (latestError) throw latestError;
    selectedDate = latest?.analysis_date;
  }
  if (!selectedDate) return [];
  const query = db.from('stock_rankings').select('*').eq('analysis_date', selectedDate).order('rank').order('score', { ascending: false }).limit(Math.max(limit * 5, 100));
  const { data, error } = await query;
  if (error) throw error;
  const uniqueRanks = new Map<number, (typeof data)[number]>();
  for (const row of data ?? []) {
    const reasons = Array.isArray(row.reasons) ? row.reasons : [];
    const isAiV2 = reasons.some((reason: { label?: string; value?: string }) => reason.label === 'Scoring Model' && ['multifactor-ai-v2', 'multifactor-regime-rs-v3', 'multifactor-decision-v4'].includes(reason.value ?? ''))
      && reasons.some((reason: { label?: string }) => reason.label === 'AI Story');
    if (isAiV2 && !uniqueRanks.has(Number(row.rank))) uniqueRanks.set(Number(row.rank), hydrateRankingMarketContext(row));
  }
  return [...uniqueRanks.values()].slice(0, limit);
}

export async function getStockRankingDetail(symbol: string, date?: string) {
  const db = getSupabaseAdmin();
  let rankingQuery = db.from('stock_rankings').select('*').eq('symbol', symbol.toUpperCase());
  if (date) rankingQuery = rankingQuery.eq('analysis_date', date);
  const [{ data: ranking, error: rankingError }, { data: story, error: storyError }] = await Promise.all([
    rankingQuery.order('analysis_date', { ascending: false }).limit(1).maybeSingle(),
    db.from('agent_stories').select('id, emiten, status, matriks_story, swot_analysis, checklist_katalis, keystat_signal, strategi_trading, kesimpulan, error_message, sources, created_at').eq('emiten', symbol.toUpperCase()).order('created_at', { ascending: false }).limit(1).maybeSingle(),
  ]);
  if (rankingError) throw rankingError;
  if (storyError) throw storyError;
  return { ranking: ranking ? hydrateRankingMarketContext(ranking) : ranking, story };
}

export async function saveSignalSnapshots(rows: Array<Record<string, unknown>>) {
  if (!rows.length) return [];
  const { data, error } = await getSupabaseAdmin()
    .from('signal_snapshots')
    .upsert(rows, { onConflict: 'signal_date,symbol,model_version' })
    .select();
  if (error) throw error;
  return data ?? [];
}

export async function getPendingSignalSnapshots(limit = 100) {
  const db = getSupabaseAdmin();
  const { data: evaluated } = await db.from('signal_outcomes').select('snapshot_id');
  const ids = (evaluated ?? []).map((row) => row.snapshot_id);
  let query = db.from('signal_snapshots').select('*').lte('signal_date', new Date(Date.now() - 28 * 86400000).toISOString().slice(0, 10)).limit(limit);
  if (ids.length) query = query.not('id', 'in', `(${ids.join(',')})`);
  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

export async function saveSignalOutcome(row: Record<string, unknown>) {
  const { data, error } = await getSupabaseAdmin().from('signal_outcomes').upsert(row, { onConflict: 'snapshot_id' }).select().single();
  if (error) throw error;
  return data;
}

export async function getBacktestRows(modelVersion?: string) {
  const db = getSupabaseAdmin();
  const [{ data: outcomes, error: outcomeError }, { data: snapshots, error: snapshotError }] = await Promise.all([
    db.from('signal_outcomes').select('*'),
    db.from('signal_snapshots').select('id, signal_date, score, signal, model_version, feature_snapshot'),
  ]);
  if (outcomeError) throw outcomeError;
  if (snapshotError) throw snapshotError;
  const snapshotMap = new Map((snapshots ?? []).map((row) => [row.id, row]));
  return (outcomes ?? []).map((row) => {
    const snapshot = snapshotMap.get(row.snapshot_id);
    return { ...row, signal_date: snapshot?.signal_date ?? null, snapshot, model_probability: snapshot?.feature_snapshot?.model_probability ?? null };
  }).filter((row) => !modelVersion || row.snapshot?.model_version === modelVersion);
}

export async function getCalibratedProbability(score: number, modelVersion: string, marketRegime: MarketRegime): Promise<CalibratedProbability | null> {
  const db = getSupabaseAdmin();
  const { low, high } = scoreBucket(score);
  const { data, error } = await db.from('signal_snapshots').select('id, score, model_version, feature_snapshot').eq('model_version', modelVersion).gte('score', low).lt('score', high);
  if (error || !data?.length) return null;
  const matchingSnapshots = data.filter((row) => row.feature_snapshot?.market_regime === marketRegime);
  if (!matchingSnapshots.length) return null;
  const snapshotMap = new Map(matchingSnapshots.map((row) => [row.id, row]));
  const { data: outcomes, error: outcomeError } = await db.from('signal_outcomes').select('snapshot_id, return_10d').in('snapshot_id', [...snapshotMap.keys()]).not('return_10d', 'is', null);
  if (outcomeError || !outcomes) return null;
  return calibrateProbability(outcomes.flatMap((outcome) => {
    const snapshot = snapshotMap.get(outcome.snapshot_id);
    if (!snapshot) return [];
    return [{ score: Number(snapshot.score), modelVersion: String(snapshot.model_version), marketRegime, return10d: Number(outcome.return_10d) }];
  }), score, modelVersion, marketRegime);
}

export async function createMatchingAlertEvents(rankings: Array<{ id?: number; symbol: string; score: number; data_completeness: number; model_probability: number | null; signal: string }>) {
  const db = getSupabaseAdmin();
  const { data: rules, error } = await db.from('alert_rules').select('*').eq('enabled', true);
  if (error) throw error;
  const created = [];
  for (const rule of rules ?? []) {
    for (const ranking of rankings) {
      const allowed = rule.allowed_signals ?? ['confirmed_uptrend'];
      if (ranking.score < Number(rule.minimum_score ?? 70) || ranking.data_completeness < Number(rule.minimum_completeness ?? 75) || !allowed.includes(ranking.signal)) continue;
      if (ranking.model_probability === null || ranking.model_probability < Number(rule.minimum_probability ?? 0.6)) continue;
      const cooldownStart = new Date(Date.now() - Number(rule.cooldown_hours ?? 24) * 3600000).toISOString();
      const { count } = await db.from('alert_events').select('*', { count: 'exact', head: true }).eq('rule_id', rule.id).eq('symbol', ranking.symbol).gte('created_at', cooldownStart);
      if (count) continue;
      const { data, error: insertError } = await db.from('alert_events').insert({ rule_id: rule.id, symbol: ranking.symbol, ranking_id: ranking.id ?? null, status: 'pending', payload: ranking }).select().single();
      if (insertError) throw insertError;
      created.push(data);
    }
  }
  return created;
}

export async function getRecentAlertEvents(limit = 20) {
  const { data, error } = await getSupabaseAdmin().from('alert_events').select('*').order('created_at', { ascending: false }).limit(limit);
  if (error) throw error;
  return data ?? [];
}

export async function saveStockQueriesForRanking(results: Array<{
  symbol: string; sector?: string; brokerData: { bandar: string; barangBandar: number; rataRataBandar: number };
  lastPrice: number; ara: number; arb: number; totalBid: number; totalOffer: number;
  targets: { fraksi: number; totalPapan: number; rataRataBidOfer: number | null; a: number; p: number | null; targetRealistis1: number | null; targetMax: number | null };
}>, date: string) {
  if (!results.length) return [];
  const rows = results.map((result) => ({
    from_date: date, to_date: date, emiten: result.symbol, sector: result.sector,
    bandar: result.brokerData.bandar, barang_bandar: result.brokerData.barangBandar,
    rata_rata_bandar: result.brokerData.rataRataBandar, harga: result.lastPrice,
    ara: result.ara, arb: result.arb, total_bid: result.totalBid, total_offer: result.totalOffer,
    fraksi: result.targets.fraksi, total_papan: result.targets.totalPapan,
    rata_rata_bid_ofer: result.targets.rataRataBidOfer, a: result.targets.a, p: result.targets.p,
    target_realistis: result.targets.targetRealistis1, target_max: result.targets.targetMax, status: 'success',
  }));
  const { data, error } = await getSupabaseAdmin().from('stock_queries').upsert(rows, { onConflict: 'from_date,emiten' }).select();
  if (error) throw error;
  return data ?? [];
}
