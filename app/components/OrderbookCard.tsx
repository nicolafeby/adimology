'use client';

import { useEffect, useState } from 'react';
import type { MarketData, OrderbookSnapshot } from '@/lib/types';

interface OrderbookCardProps {
  emiten: string;
  marketData: MarketData;
  orderbook?: OrderbookSnapshot;
}

const formatNumber = (value: number) => value.toLocaleString('id-ID');
const POLL_INTERVAL_MS = 3_000;

export default function OrderbookCard({ emiten, marketData, orderbook }: OrderbookCardProps) {
  const [liveMarketData, setLiveMarketData] = useState(marketData);
  const [liveOrderbook, setLiveOrderbook] = useState(orderbook);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(orderbook ? new Date() : null);
  const [pollError, setPollError] = useState(false);

  useEffect(() => {
    setLiveMarketData(marketData);
    setLiveOrderbook(orderbook);
    setUpdatedAt(orderbook ? new Date() : null);
    setPollError(false);
  }, [emiten, marketData, orderbook]);

  useEffect(() => {
    if (!orderbook) return;

    let timer: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | undefined;
    let stopped = false;

    const poll = async () => {
      if (stopped || document.visibilityState === 'hidden') {
        timer = setTimeout(poll, POLL_INTERVAL_MS);
        return;
      }

      controller = new AbortController();
      try {
        const response = await fetch(`/api/orderbook?emiten=${encodeURIComponent(emiten)}`, {
          cache: 'no-store',
          signal: controller.signal,
        });
        const json = await response.json();
        if (!response.ok || !json.success) throw new Error(json.error || 'Orderbook fetch failed');

        setLiveMarketData((current) => ({ ...current, ...json.data.marketData }));
        setLiveOrderbook(json.data.orderbook);
        setUpdatedAt(new Date(json.data.updatedAt));
        setPollError(false);
      } catch (error) {
        if (!(error instanceof DOMException && error.name === 'AbortError')) {
          setPollError(true);
        }
      } finally {
        if (!stopped) timer = setTimeout(poll, POLL_INTERVAL_MS);
      }
    };

    timer = setTimeout(poll, POLL_INTERVAL_MS);
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      controller?.abort();
    };
  }, [emiten, Boolean(orderbook)]);

  const totalBidLots = liveMarketData.totalBid / 100;
  const totalOfferLots = liveMarketData.totalOffer / 100;
  const totalLots = totalBidLots + totalOfferLots;
  const bidPercent = totalLots > 0 ? (totalBidLots / totalLots) * 100 : 50;
  const ratio = totalOfferLots > 0 ? totalBidLots / totalOfferLots : null;
  const maxVolume = Math.max(
    ...(liveOrderbook?.bid ?? []).map((level) => level.volume),
    ...(liveOrderbook?.offer ?? []).map((level) => level.volume),
    1,
  );

  return (
    <div className="orderbook-card">
      <div className="orderbook-header">
        <div>
          <span className="orderbook-title">Orderbook {emiten}</span>
          <span className="orderbook-source" aria-live="polite">
            {liveOrderbook
              ? `${pollError ? 'Koneksi terganggu · mencoba lagi' : 'Realtime 3 detik'}${updatedAt ? ` · ${updatedAt.toLocaleTimeString('id-ID')}` : ''}`
              : 'Data historis · Stockbit'}
          </span>
        </div>
        <div className="orderbook-last-price">
          <span>Last</span>
          <strong>Rp {formatNumber(liveMarketData.harga)}</strong>
        </div>
      </div>

      <div className="orderbook-summary">
        <div>
          <span>Total Bid</span>
          <strong className="orderbook-bid-text">{formatNumber(totalBidLots)} lot</strong>
        </div>
        <div>
          <span>Bid/Offer</span>
          <strong>{ratio === null ? '—' : `${ratio.toFixed(2)}x`}</strong>
        </div>
        <div>
          <span>Total Offer</span>
          <strong className="orderbook-offer-text">{formatNumber(totalOfferLots)} lot</strong>
        </div>
      </div>

      <div className="orderbook-pressure" aria-label={`Bid ${bidPercent.toFixed(1)} persen`}>
        <div className="orderbook-pressure-bid" style={{ width: `${bidPercent}%` }} />
        <div className="orderbook-pressure-offer" style={{ width: `${100 - bidPercent}%` }} />
      </div>

      {liveOrderbook ? (
        <div className="orderbook-columns">
          <OrderbookSide title="BID" levels={liveOrderbook.bid} side="bid" maxVolume={maxVolume} />
          <OrderbookSide title="OFFER" levels={liveOrderbook.offer} side="offer" maxVolume={maxVolume} />
        </div>
      ) : (
        <div className="orderbook-empty">
          Detail antrean harga hanya tersedia untuk analisis hari ini. Ringkasan total menggunakan data historis yang tersimpan.
        </div>
      )}
    </div>
  );
}

function OrderbookSide({
  title,
  levels,
  side,
  maxVolume,
}: {
  title: string;
  levels: OrderbookSnapshot['bid'];
  side: 'bid' | 'offer';
  maxVolume: number;
}) {
  return (
    <div className="orderbook-side">
      <div className="orderbook-table-header">
        <span>{title}</span>
        <span>Lot</span>
        <span>Queue</span>
      </div>
      {levels.length === 0 ? (
        <div className="orderbook-no-level">Tidak ada antrean</div>
      ) : (
        levels.map((level, index) => (
          <div className="orderbook-level" key={`${side}-${level.price}-${index}`}>
            <div
              className={`orderbook-level-depth ${side}`}
              style={{ width: `${Math.max(3, (level.volume / maxVolume) * 100)}%` }}
            />
            <strong className={side === 'bid' ? 'orderbook-bid-text' : 'orderbook-offer-text'}>
              {formatNumber(level.price)}
            </strong>
            <span>{formatNumber(level.volume / 100)}</span>
            <span>{formatNumber(level.queues)}</span>
          </div>
        ))
      )}
    </div>
  );
}
