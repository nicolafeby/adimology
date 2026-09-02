import { NextRequest, NextResponse } from 'next/server';
import { fetchWatchlist, fetchEmitenInfo, deleteWatchlistItem } from '@/lib/stockbit';
import { supabase, getCachedWatchlistItems, saveCachedWatchlistItems, deleteCachedWatchlistItem } from '@/lib/supabase';
import type { ApiResponse } from '@/lib/types';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const groupId = searchParams.get('groupId');
  const sync = searchParams.get('sync') === 'true';

  try {
    const numericGroupId = groupId ? Number(groupId) : undefined;

    // If sync requested, fetch from Stockbit
    if (sync) {
      return await fetchFromStockbitAndCache(numericGroupId);
    }

    // Try to read from local database first
    if (numericGroupId) {
      const cached = await getCachedWatchlistItems(numericGroupId);
      
      if (cached.items.length > 0) {
        // Merge with flags from emiten_flags table
        const symbols = cached.items.map((item: any) => (item.symbol || item.company_code).toUpperCase());
        
        const { data: flags } = await supabase
          .from('emiten_flags')
          .select('emiten, flag')
          .in('emiten', symbols);

        const flagMap = new Map<string, string>();
        if (flags) {
          flags.forEach((f: any) => flagMap.set(f.emiten, f.flag));
        }

        const itemsWithFlags = cached.items.map((item: any) => {
          const symbol = (item.symbol || item.company_code).toUpperCase();
          return {
            ...item,
            flag: flagMap.get(symbol) || null,
          };
        });

        const responseData = {
          data: {
            watchlist_id: numericGroupId,
            result: itemsWithFlags,
          },
          message: 'Cached data',
        };

        return NextResponse.json({
          success: true,
          data: responseData,
          source: 'cache',
          synced_at: cached.synced_at,
        });
      }
    }

    // If no cache exists, auto-sync from Stockbit (first time)
    return await fetchFromStockbitAndCache(numericGroupId);

  } catch (error) {
    console.error('Watchlist API Error:', error);
    
    // If Stockbit fails, try returning cached data
    if (groupId) {
      const cached = await getCachedWatchlistItems(Number(groupId));
      if (cached.items.length > 0) {
        return NextResponse.json({
          success: true,
          data: {
            data: { watchlist_id: Number(groupId), result: cached.items },
            message: 'Cached data (Stockbit unavailable)',
          },
          source: 'cache',
          synced_at: cached.synced_at,
          warning: 'Stockbit unavailable, showing cached data',
        });
      }
    }
    
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
      },
      { status: 500 }
    );
  }
}

/**
 * Fetch from Stockbit API, enrich with sector info, save to cache, and return
 */
async function fetchFromStockbitAndCache(groupId?: number) {
  const watchlistData = await fetchWatchlist(groupId);
  const items = watchlistData.data?.result || [];

  if (items.length === 0) {
    const actualGroupId = groupId || watchlistData.data?.watchlist_id;
    if (actualGroupId) {
      await saveCachedWatchlistItems(actualGroupId, []);
    }

    return NextResponse.json({
      success: true,
      data: watchlistData,
      source: 'stockbit',
      synced_at: new Date().toISOString(),
    });
  }

  const symbols = items.map((item: any) => (item.symbol || item.company_code).toUpperCase());

  // Fetch flags from Supabase
  const { data: flags, error: flagError } = await supabase
    .from('emiten_flags')
    .select('emiten, flag')
    .in('emiten', symbols);

  if (flagError) {
    console.error('Error fetching flags:', flagError);
  }

  const flagMap = new Map<string, string>();
  if (flags) {
    flags.forEach((f: any) => flagMap.set(f.emiten, f.flag));
  }

  // Fetch sector for each watchlist item in parallel AND merge flags
  const itemsWithData = await Promise.all(
    items.map(async (item: any) => {
      try {
        const symbol = (item.symbol || item.company_code).toUpperCase();
        const emitenInfo = await fetchEmitenInfo(symbol);
        
        // Helper to clean price strings (e.g., "1,234" -> 1234)
        const cleanPrice = (p: any) => {
          if (typeof p === 'number') return p;
          if (typeof p === 'string') return Number(p.replace(/,/g, ''));
          return 0;
        };
        
        const currentPrice = cleanPrice(item.last_price || item.price || emitenInfo?.data?.price || 0);
        
        return {
          ...item,
          id: item.id,
          last_price: currentPrice,
          sector: emitenInfo?.data?.sector || undefined,
          flag: flagMap.get(symbol) || null
        };
      } catch {
        const symbol = (item.symbol || item.company_code).toUpperCase();
        
        const cleanPrice = (p: any) => {
          if (typeof p === 'number') return p;
          if (typeof p === 'string') return Number(p.replace(/,/g, ''));
          return 0;
        };

        return {
          ...item,
          id: item.id,
          last_price: cleanPrice(item.last_price || item.price || 0),
          flag: flagMap.get(symbol) || null
        };
      }
    })
  );

  // Save to cache
  const actualGroupId = groupId || watchlistData.data?.watchlist_id;
  if (actualGroupId) {
    try {
      await saveCachedWatchlistItems(actualGroupId, itemsWithData);
    } catch (cacheError) {
      console.error('Failed to save watchlist cache (non-blocking):', cacheError);
    }
  }

  // Update the response with sector and flag data
  const updatedData = {
    ...watchlistData,
    data: {
      ...watchlistData.data,
      result: itemsWithData
    }
  };

  return NextResponse.json({
    success: true,
    data: updatedData,
    source: 'stockbit',
    synced_at: new Date().toISOString(),
  });
}

export async function DELETE(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const watchlistId = searchParams.get('watchlistId');
  const companyId = searchParams.get('companyId');

  if (!watchlistId || !companyId) {
    return NextResponse.json(
      { success: false, error: 'Missing watchlistId or companyId' },
      { status: 400 }
    );
  }

  try {
    // Delete from Stockbit
    await deleteWatchlistItem(Number(watchlistId), Number(companyId));
    
    // Also delete from local cache
    // We need the symbol to delete from cache, but we only have companyId
    // Try to find the item symbol from the request or cache
    const cached = await getCachedWatchlistItems(Number(watchlistId));
    const itemToDelete = cached.items.find((item: any) => 
      String(item.id) === companyId || item.company_id === Number(companyId)
    );
    if (itemToDelete) {
      await deleteCachedWatchlistItem(Number(watchlistId), itemToDelete.symbol);
    }
    
    return NextResponse.json({ success: true, message: 'Item deleted successfully' });
  } catch (error) {
    console.error('Delete Watchlist API Error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error occurred',
      },
      { status: 500 }
    );
  }
}
