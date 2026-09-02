'use client';

import { useCallback, useEffect, useState, useMemo, useRef } from 'react';
import type { WatchlistItem, WatchlistGroup } from '@/lib/types';
import { CheckCircle2, XCircle, MinusCircle, Search, Filter, X, RefreshCw } from 'lucide-react';

interface WatchlistSidebarProps {
  onSelect?: (symbol: string) => void;
}

export default function WatchlistSidebar({ onSelect }: WatchlistSidebarProps) {
  const [watchlist, setWatchlist] = useState<WatchlistItem[]>([]);
  const [groups, setGroups] = useState<WatchlistGroup[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshSeed, setRefreshSeed] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [syncedAt, setSyncedAt] = useState<string | null>(null);
  const syncInProgressRef = useRef(false);

  // Filter States
  const [filterEmiten, setFilterEmiten] = useState('');
  const [filterSector, setFilterSector] = useState('all');
  const [filterStatus, setFilterStatus] = useState<'all' | 'OK' | 'NG' | 'Neutral'>('all');
  const [showFilters, setShowFilters] = useState(false);

  // Fetch groups and watchlist items
  useEffect(() => {
    const fetchGroups = async (forceSync = false) => {
      if (groups.length === 0) setLoading(true);
      setError(null);
      try {
        const syncParam = forceSync ? '?sync=true' : '';
        const res = await fetch(`/api/watchlist/groups${syncParam}`);
        const json = await res.json();
        
        if (!json.success) {
          // If it's a known error (like token issue), show it
          if (json.error && (json.error.includes('token') || json.error.includes('auth'))) {
            setError(json.error);
          }
          return;
        }

        if (json.synced_at) {
          setSyncedAt(json.synced_at);
        }

        if (Array.isArray(json.data) && json.data.length > 0) {
          setGroups(json.data);
          // If no group is selected yet, or the current selected group is not in the new groups list
          const currentGroupExists = json.data.some((g: WatchlistGroup) => g.watchlist_id === selectedGroupId);
          if (!selectedGroupId || !currentGroupExists) {
            const defaultG = json.data.find((g: WatchlistGroup) => g.is_default) || json.data[0];
            setSelectedGroupId(defaultG?.watchlist_id || null);
          }
        } else {
          setError('No watchlist groups found');
        }
      } catch (err) {
        console.error('Error fetching groups:', err);
        setError('Failed to load watchlist groups');
      } finally {
        if (!selectedGroupId) setLoading(false);
      }
    };

    fetchGroups();
  }, [refreshSeed]);

  // Fetch watchlist items when group changes or refreshSeed changes
  useEffect(() => {
    if (!selectedGroupId) return;

    const fetchWatchlistItems = async (forceSync = false) => {
      setLoading(true);
      setError(null);
      try {
        const syncParam = forceSync ? '&sync=true' : '';
        const response = await fetch(`/api/watchlist?groupId=${selectedGroupId}${syncParam}`);
        const json = await response.json();

        if (!json.success) {
          throw new Error(json.error || 'Failed to fetch watchlist');
        }

        if (json.synced_at) {
          setSyncedAt(json.synced_at);
        }

        const payload = json.data;
        const data = payload?.data?.result || payload?.data || [];
        setWatchlist(Array.isArray(data) ? data : []);
      } catch (err) {
        console.error('Error fetching watchlist:', err);
        setError(err instanceof Error ? err.message : 'Failed to load watchlist');
      } finally {
        setLoading(false);
      }
    };

    fetchWatchlistItems();
  }, [selectedGroupId, refreshSeed]);

  // Sync from Stockbit
  const handleSync = useCallback(async (silent = false) => {
    if (syncInProgressRef.current) return;

    syncInProgressRef.current = true;
    if (!silent) {
      window.dispatchEvent(new CustomEvent('stockbit-fetch-start'));
      setSyncing(true);
      setError(null);
    }

    try {
      // Sync groups
      const groupsRes = await fetch('/api/watchlist/groups?sync=true');
      const groupsJson = await groupsRes.json();
      
      if (groupsJson.success && Array.isArray(groupsJson.data)) {
        setGroups(groupsJson.data);
        if (groupsJson.synced_at) setSyncedAt(groupsJson.synced_at);
      }

      // Sync items for current group
      if (selectedGroupId) {
        const itemsRes = await fetch(`/api/watchlist?groupId=${selectedGroupId}&sync=true`);
        const itemsJson = await itemsRes.json();
        
        if (itemsJson.success) {
          const payload = itemsJson.data;
          const data = payload?.data?.result || payload?.data || [];
          setWatchlist(Array.isArray(data) ? data : []);
          if (itemsJson.synced_at) setSyncedAt(itemsJson.synced_at);
        }
      }
    } catch (err) {
      console.error('Error syncing watchlist:', err);
      if (!silent) setError('Sync failed. Showing cached data.');
    } finally {
      syncInProgressRef.current = false;
      if (!silent) {
        setSyncing(false);
        window.dispatchEvent(new CustomEvent('stockbit-fetch-end'));
      }
    }
  }, [selectedGroupId]);

  // Keep the Stockbit-backed cache fresh without requiring a page reload.
  // Sync only while the page is visible to avoid unnecessary API traffic.
  useEffect(() => {
    const AUTO_SYNC_INTERVAL_MS = 30_000;

    const syncWhenVisible = () => {
      if (document.visibilityState === 'visible' && navigator.onLine) {
        void handleSync(true);
      }
    };

    const intervalId = window.setInterval(syncWhenVisible, AUTO_SYNC_INTERVAL_MS);
    document.addEventListener('visibilitychange', syncWhenVisible);
    window.addEventListener('focus', syncWhenVisible);
    window.addEventListener('online', syncWhenVisible);

    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', syncWhenVisible);
      window.removeEventListener('focus', syncWhenVisible);
      window.removeEventListener('online', syncWhenVisible);
    };
  }, [handleSync]);

  // Handle token refresh event
  useEffect(() => {
    const handleTokenRefresh = () => {
      console.log('Token refreshed event received, triggering watchlist sync');
      void handleSync();
    };

    window.addEventListener('token-refreshed', handleTokenRefresh);
    return () => window.removeEventListener('token-refreshed', handleTokenRefresh);
  }, [handleSync]);

  // Format relative time for synced_at
  const formatSyncedAt = (iso: string | null) => {
    if (!iso) return null;
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'baru saja';
    if (mins < 60) return `${mins} menit lalu`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours} jam lalu`;
    const days = Math.floor(hours / 24);
    return `${days} hari lalu`;
  };

  // Handle real-time flag updates from InputForm
  useEffect(() => {
    const handleFlagUpdate = (event: any) => {
      const { emiten, flag } = event.detail;
      setWatchlist(prev => prev.map(item => {
        if ((item.symbol || item.company_code).toUpperCase() === emiten.toUpperCase()) {
          return { ...item, flag };
        }
        return item;
      }));
    };

    window.addEventListener('emiten-flagged' as any, handleFlagUpdate);
    return () => window.removeEventListener('emiten-flagged' as any, handleFlagUpdate);
  }, []);

  const handleDelete = async (e: React.MouseEvent, companyId: number, symbol: string) => {
    e.stopPropagation(); // Prevent onSelect from firing
    
    if (!selectedGroupId) return;
    
    if (!confirm(`Are you sure you want to remove ${symbol} from watchlist?`)) return;

    try {
      // Optimistic update
      setWatchlist(prev => prev.filter(item => item.id !== companyId));
      
      const res = await fetch(`/api/watchlist?watchlistId=${selectedGroupId}&companyId=${companyId}`, {
        method: 'DELETE'
      });
      
      const json = await res.json();
      if (!json.success) {
        throw new Error(json.error || 'Failed to delete item');
      }
    } catch (err) {
      console.error('Error deleting item:', err);
      // Revert optimistic update on error
      setRefreshSeed(prev => prev + 1);
      alert(err instanceof Error ? err.message : 'Failed to delete item');
    }
  };

  // Extract unique sectors for dropdown
  const availableSectors = useMemo(() => {
    const sectors = new Set<string>();
    watchlist.forEach(item => {
      if (item.sector) sectors.add(item.sector);
    });
    return Array.from(sectors).sort();
  }, [watchlist]);

  // Filtered Watchlist Logic
  const filteredWatchlist = useMemo(() => {
    return watchlist.filter(item => {
      // 1. Filter by Emiten/Symbol
      const searchStr = filterEmiten.toUpperCase();
      const symbolMatch = (item.symbol || item.company_code || '').toUpperCase().includes(searchStr);
      const nameMatch = (item.company_name || '').toUpperCase().includes(searchStr);
      if (searchStr && !symbolMatch && !nameMatch) return false;

      // 2. Filter by Sector
      if (filterSector !== 'all' && item.sector !== filterSector) return false;

      // 3. Filter by Status (Flag)
      if (filterStatus !== 'all' && item.flag !== filterStatus) return false;

      return true;
    });
  }, [watchlist, filterEmiten, filterSector, filterStatus]);

  const selectedGroup = groups.find(g => g.watchlist_id === selectedGroupId);

  if (loading && groups.length === 0) {
    return (
      <div style={{ padding: '1rem' }}>
        <h3 style={{ marginBottom: '1rem', color: 'var(--text-secondary)', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '1px' }}>Watchlist</h3>
        <div style={{ textAlign: 'center', color: 'var(--text-secondary)', padding: '2rem 0' }}>
          <div className="spinner" style={{ width: '20px', height: '20px', margin: '0 auto 1rem' }}></div>
          <div style={{ fontSize: '0.8rem' }}>Loading Watchlist...</div>
        </div>
      </div>
    );
  }

  if (error && groups.length === 0) {
    return (
      <div style={{ padding: '1rem' }}>
        <h3 style={{ marginBottom: '1rem', color: 'var(--text-secondary)', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '1px' }}>Watchlist</h3>
        <div className="glass-card" style={{ 
          padding: '1rem', 
          background: 'rgba(245, 87, 108, 0.05)', 
          border: '1px solid rgba(245, 87, 108, 0.2)',
          borderRadius: '12px',
          textAlign: 'center'
        }}>
          <div style={{ color: 'var(--accent-warning)', fontSize: '0.8rem', marginBottom: '0.5rem' }}>
            {error.includes('token') || error.includes('auth') ? '🔴 Session Expired' : '❌ Error'}
          </div>
          <div style={{ color: 'var(--text-secondary)', fontSize: '0.75rem', lineHeight: '1.4' }}>
            {error.includes('token') || error.includes('auth') 
              ? 'Please login to Stockbit via the extension and wait for connection.' 
              : error}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: '1rem', display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header with Group Selector */}
      <div style={{ marginBottom: '1rem' }}>
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: '0.8rem'
        }}>
          <h3 style={{
            margin: 0,
            color: 'var(--text-secondary)',
            textTransform: 'uppercase',
            letterSpacing: '1px',
            fontSize: '0.75rem'
          }}>
            Watchlist
          </h3>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <button 
              onClick={() => void handleSync()}
              disabled={syncing}
              style={{
                background: 'transparent',
                border: 'none',
                color: syncing ? 'var(--accent-primary)' : 'var(--text-muted)',
                cursor: syncing ? 'not-allowed' : 'pointer',
                padding: '4px',
                borderRadius: '4px',
                display: 'flex',
                alignItems: 'center',
                transition: 'all 0.2s'
              }}
              title="Sync from Stockbit"
            >
              <RefreshCw size={14} style={{ animation: syncing ? 'spin 1s linear infinite' : 'none' }} />
            </button>
            <button 
              onClick={() => setShowFilters(!showFilters)}
              style={{
                background: showFilters ? 'rgba(102, 126, 234, 0.2)' : 'transparent',
                border: 'none',
                color: showFilters ? 'var(--accent-primary)' : 'var(--text-muted)',
                cursor: 'pointer',
                padding: '4px',
                borderRadius: '4px',
                display: 'flex',
                alignItems: 'center',
                transition: 'all 0.2s'
              }}
              title="Toggle Filters"
            >
              <Filter size={14} />
            </button>
              <span style={{
                fontSize: '0.7rem',
                color: 'var(--text-muted)',
                background: 'var(--border-color)',
                padding: '2px 6px',
                borderRadius: '4px'
              }}>
                {filteredWatchlist.length}
              </span>
          </div>
        </div>

        {/* Synced at timestamp */}
        {syncedAt && (
          <div style={{
            fontSize: '0.65rem',
            color: 'var(--text-muted)',
            marginBottom: '0.5rem',
            textAlign: 'right',
            opacity: 0.7
          }}>
            Synced {formatSyncedAt(syncedAt)}
          </div>
        )}

        {/* Group Selector */}
        {groups.length > 1 && (
          <select
            value={selectedGroupId || ''}
            onChange={(e) => setSelectedGroupId(Number(e.target.value))}
            style={{
              width: '100%',
              padding: '0.5rem',
              fontSize: '0.8rem',
              background: 'var(--bg-secondary)',
              border: '1px solid var(--border-color)',
              borderRadius: '8px',
              color: 'var(--text-primary)',
              cursor: 'pointer',
              outline: 'none',
              marginBottom: showFilters ? '0.75rem' : '0'
            }}
          >
            {groups.map(g => (
              <option key={g.watchlist_id} value={g.watchlist_id} style={{ background: 'var(--bg-secondary)', color: 'var(--text-primary)' }}>
                {g.emoji ? `${g.emoji} ` : ''}{g.name}
              </option>
            ))}
          </select>
        )}

        {/* Filter UI */}
        {(showFilters || filterEmiten || filterSector !== 'all' || filterStatus !== 'all') && (
          <div style={{ 
            marginTop: '0.5rem', 
            display: 'flex', 
            flexDirection: 'column', 
            gap: '0.5rem',
            padding: '0.75rem',
            background: 'var(--bg-card)',
            borderRadius: '10px',
            border: '1px solid var(--border-color)'
          }}>
            {/* Search Input */}
            <div style={{ position: 'relative' }}>
              <Search size={12} style={{ position: 'absolute', left: '0.5rem', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
              <input
                type="text"
                placeholder="Search Emiten..."
                value={filterEmiten}
                onChange={(e) => setFilterEmiten(e.target.value)}
                style={{
                  width: '100%',
                  padding: '0.45rem 0.5rem 0.45rem 1.75rem',
                  fontSize: '0.8rem',
                  background: 'var(--bg-secondary)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '6px',
                  color: 'var(--text-primary)',
                  outline: 'none'
                }}
              />
            </div>

            {/* Sector Filter - Stacked */}
            <select
              value={filterSector}
              onChange={(e) => setFilterSector(e.target.value)}
              style={{
                width: '100%',
                padding: '0.4rem',
                fontSize: '0.75rem',
                background: 'var(--bg-secondary)',
                border: '1px solid var(--border-color)',
                borderRadius: '6px',
                color: 'var(--text-primary)',
                outline: 'none',
                cursor: 'pointer'
              }}
            >
              <option value="all" style={{ background: 'var(--bg-secondary)', color: 'var(--text-primary)' }}>All Sectors</option>
              {availableSectors.map(s => (
                <option key={s} value={s} style={{ background: 'var(--bg-secondary)', color: 'var(--text-primary)' }}>{s}</option>
              ))}
            </select>

            {/* Status Filter - Stacked */}
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value as any)}
              style={{
                width: '100%',
                padding: '0.4rem',
                fontSize: '0.75rem',
                background: 'var(--bg-secondary)',
                border: '1px solid var(--border-color)',
                borderRadius: '6px',
                color: 'var(--text-primary)',
                outline: 'none',
                cursor: 'pointer'
              }}
            >
              <option value="all" style={{ background: 'var(--bg-secondary)', color: 'var(--text-primary)' }}>All Status</option>
              <option value="OK" style={{ background: 'var(--bg-secondary)', color: '#3b82f6' }}>🔵 OK</option>
              <option value="NG" style={{ background: 'var(--bg-secondary)', color: '#f97316' }}>🟠 NG</option>
              <option value="Neutral" style={{ background: 'var(--bg-secondary)', color: 'var(--text-secondary)' }}>⚪ Neutral</option>
            </select>

            {(filterEmiten || filterSector !== 'all' || filterStatus !== 'all') && (
              <button 
                onClick={() => {
                  setFilterEmiten('');
                  setFilterSector('all');
                  setFilterStatus('all');
                }}
                style={{
                  fontSize: '0.7rem',
                  background: 'none',
                  border: 'none',
                  color: 'var(--accent-warning)',
                  cursor: 'pointer',
                  textAlign: 'right',
                  padding: '2px 0'
                }}
              >
                Reset Filters
              </button>
            )}
          </div>
        )}
      </div>

      {/* Loading indicator when switching groups */}
      {/* Syncing indicator moved to Navbar */}
      {loading && !syncing && (
        <div style={{ textAlign: 'center', color: 'var(--text-secondary)', padding: '1rem' }}>
          <div className="spinner" style={{ width: '16px', height: '16px', margin: '0 auto 0.5rem' }}></div>
          <div style={{ fontSize: '0.75rem' }}>Loading...</div>
        </div>
      )}

      {error && groups.length > 0 && (
        <div style={{ 
          color: 'var(--accent-warning)', 
          fontSize: '0.75rem', 
          padding: '0.75rem', 
          textAlign: 'center',
          background: 'rgba(245, 87, 108, 0.05)',
          borderRadius: '8px',
          marginBottom: '0.5rem'
        }}>
          ⚠️ {error}
        </div>
      )}

      <div
        className="watchlist-items-container"
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '0.25rem',
          flex: 1,
          overflowY: 'auto',
          paddingRight: '4px'
        }}
      >
        {filteredWatchlist.length === 0 && !loading && (
          <div style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.75rem', marginTop: '2rem' }}>
            No items found
          </div>
        )}
        {filteredWatchlist.map((item, index) => {

          const percentValue = parseFloat(item.percent) || 0;
          const isPositive = percentValue >= 0;

          return (
            <div
              key={item.id || item.company_id || index}
              className="watchlist-item interactive-delete"
              onClick={() => onSelect?.(item.symbol || item.company_code)}
              style={{ padding: '0.65rem 0.75rem', position: 'relative' }}
            >
              {/* Delete Button */}
              <button
                className="delete-btn"
                onClick={(e) => handleDelete(e, item.id as any, item.symbol || item.company_code)}
                style={{
                  position: 'absolute',
                  top: '0.2rem',
                  right: '0.2rem',
                  padding: '4px',
                  borderRadius: '50%',
                  background: 'rgba(245, 87, 108, 0.1)',
                  color: 'var(--accent-warning)',
                  border: '1px solid rgba(245, 87, 108, 0.2)',
                  cursor: 'pointer',
                  zIndex: 2,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  opacity: 0,
                  transition: 'all 0.2s ease'
                }}
                title={`Remove ${item.symbol || item.company_code}`}
              >
                <X size={12} />
              </button>
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                  <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>{item.symbol || item.company_code}</div>
                  {item.flag === 'OK' && (
                    <CheckCircle2 size={12} color="#3b82f6" fill="rgba(59, 130, 246, 0.2)" />
                  )}
                  {item.flag === 'NG' && (
                    <XCircle size={12} color="#f97316" fill="rgba(249, 115, 22, 0.2)" />
                  )}
                  {item.flag === 'Neutral' && (
                    <MinusCircle size={12} color="var(--text-secondary)" />
                  )}
                </div>
                <div style={{
                  fontSize: '0.7rem',
                  color: '#999',
                  marginTop: '2px',
                  maxWidth: '140px',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap'
                }}>
                  {item.sector || item.company_name}
                </div>
              </div>
              <div style={{ textAlign: 'right', display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
                <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>
                  {item.formatted_price || item.last_price?.toLocaleString() || '-'}
                </div>
                <div style={{
                  fontSize: '0.7rem',
                  color: isPositive ? 'var(--accent-success)' : 'var(--accent-warning)',
                  marginTop: '1px',
                  fontWeight: 500
                }}>
                  {isPositive ? '+' : ''}{item.percent}%
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
