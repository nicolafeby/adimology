import test from 'node:test';
import assert from 'node:assert/strict';
import { assessBrokerPersistence, assessExecution, sectorFamily, sectorRelativeMetric } from '../lib/screener-factors';

const level = (price:number, volume:number) => ({ price, volume, queues: 1, changePercentage: 0 });

test('bank DER is assigned a different sector family', () => {
  assert.equal(sectorFamily('Banks'), 'financials');
  assert.equal(sectorFamily('Consumer Cyclicals'), 'general');
});

test('negative PER is not cheap and small peer samples stay unavailable', () => {
  const peers = Array.from({length:10},(_,i)=>({symbol:`P${i}`,sector:'Banks',availableAt:'2025-01-01T00:00:00Z',metrics:{per:10+i}}));
  assert.equal(sectorRelativeMetric({symbol:'X',metric:'per',value:-4,sector:'Banks',cutoff:'2025-02-01T00:00:00Z',peers,lowerIsBetter:true}).available,false);
  assert.equal(sectorRelativeMetric({symbol:'X',metric:'per',value:12,sector:'Tiny',cutoff:'2025-02-01T00:00:00Z',peers:peers.slice(0,2),lowerIsBetter:true}).available,false);
});

test('peer calculation excludes observations after cutoff and remains bounded with outliers', () => {
  const peers = Array.from({length:8},(_,i)=>({symbol:`P${i}`,sector:'Tech',availableAt:'2025-01-01T00:00:00Z',metrics:{roe:i===7?1e9:10+i}}));
  peers.push({symbol:'FUTURE',sector:'Tech',availableAt:'2026-01-01T00:00:00Z',metrics:{roe:999}});
  const result=sectorRelativeMetric({symbol:'X',metric:'roe',value:15,sector:'Tech',cutoff:'2025-02-01T00:00:00Z',peers});
  assert.equal(result.peerSampleSize,8); assert.ok(result.score!>=0&&result.score!<=100); assert.ok(Number.isFinite(result.mad!));
});

test('broker persistence sorts/deduplicates and one spike is weaker than persistent accumulation', () => {
  const persistent=Array.from({length:10},(_,i)=>({date:`2025-01-${String(10-i).padStart(2,'0')}`,broker:'AA',netValue:100}));
  const spike=Array.from({length:10},(_,i)=>({date:`2025-01-${String(i+1).padStart(2,'0')}`,broker:i?'B'+i:'AA',netValue:i===9?10_000:-1}));
  const a=assessBrokerPersistence([...persistent,persistent[0]]), b=assessBrokerPersistence(spike);
  assert.equal(a.sampleSize,10); assert.ok(a.score!>b.score!); assert.equal(a.accumulationSessions.d10,10);
});

test('execution distinguishes buy/sell, position size, stale and insufficient depth', () => {
  const history=Array.from({length:20},(_,i)=>({date:`2025-01-${String(i+1).padStart(2,'0')}`,close:100,open:100,high:101,low:99,average:100,volume:1_000_000,value:i===3?0:100_000_000,change:0,change_percentage:0,frequency:1,foreign_buy:0,foreign_sell:0,net_foreign:0}));
  const fresh=assessExecution({lastPrice:100,observedAt:'2025-02-01T00:00:00Z',now:new Date('2025-02-01T00:01:00Z'),history,orderbook:{bid:[level(99,500_000),level(98,500_000)],offer:[level(101,100_000),level(102,500_000)]},notionals:[1_000_000,100_000_000]});
  assert.equal(fresh.bookStatus,'normal'); assert.equal(fresh.zeroVolumeDays,1); assert.notEqual(fresh.scenarios[0].estimatedBuySlippagePercent,fresh.scenarios[1].estimatedBuySlippagePercent);
  const shallow=assessExecution({lastPrice:100,observedAt:'2025-02-01T00:00:00Z',now:new Date('2025-02-01T00:01:00Z'),orderbook:{bid:[level(99,100)],offer:[level(101,100)]},notionals:[10_000_000]});
  assert.equal(shallow.scenarios[0].executionStatus,'insufficient_depth'); assert.equal(shallow.scenarios[0].estimatedBuySlippagePercent,null);
  const stale=assessExecution({lastPrice:100,observedAt:'2025-01-01T00:00:00Z',now:new Date('2025-02-01T00:00:00Z'),orderbook:{bid:[level(99,1000)],offer:[level(101,1000)]}});
  assert.equal(stale.bookStatus,'stale'); assert.equal(stale.available,false);
});

test('locked and crossed books are never normal execution', () => {
  for (const offer of [100,99]) { const result=assessExecution({lastPrice:100,observedAt:'2025-01-01T00:00:00Z',now:new Date('2025-01-01T00:01:00Z'),orderbook:{bid:[level(100,100000)],offer:[level(offer,100000)]}}); assert.notEqual(result.bookStatus,'normal'); assert.equal(result.score,null); }
});
