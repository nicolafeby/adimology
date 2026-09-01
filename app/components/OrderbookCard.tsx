'use client';

import type { MarketData, OrderbookSnapshot } from '@/lib/types';

interface OrderbookCardProps {
  emiten: string;
  marketData: MarketData;
  orderbook?: OrderbookSnapshot;
}

const formatNumber = (value: number) => value.toLocaleString('id-ID');

export default function OrderbookCard({ emiten, marketData, orderbook }: OrderbookCardProps) {
  const totalBidLots = marketData.totalBid / 100;
  const totalOfferLots = marketData.totalOffer / 100;
  const totalLots = totalBidLots + totalOfferLots;
  const bidPercent = totalLots > 0 ? (totalBidLots / totalLots) * 100 : 50;
  const ratio = totalOfferLots > 0 ? totalBidLots / totalOfferLots : null;
  const maxVolume = Math.max(
    ...(orderbook?.bid ?? []).map((level) => level.volume),
    ...(orderbook?.offer ?? []).map((level) => level.volume),
    1,
  );

  return (
    <div className="orderbook-card">
      <div className="orderbook-header">
        <div>
          <span className="orderbook-title">Orderbook {emiten}</span>
          <span className="orderbook-source">Live data · Stockbit</span>
        </div>
        <div className="orderbook-last-price">
          <span>Last</span>
          <strong>Rp {formatNumber(marketData.harga)}</strong>
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

      {orderbook ? (
        <div className="orderbook-columns">
          <OrderbookSide title="BID" levels={orderbook.bid} side="bid" maxVolume={maxVolume} />
          <OrderbookSide title="OFFER" levels={orderbook.offer} side="offer" maxVolume={maxVolume} />
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
