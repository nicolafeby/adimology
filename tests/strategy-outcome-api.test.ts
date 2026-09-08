import assert from 'node:assert/strict';
import test from 'node:test';
import { NextRequest } from 'next/server';
import type { OutcomeDependencies } from '../lib/outcome-service';
import { STRATEGY_IDS, strategyIdentity } from '../lib/strategies';
import { archiveFixture, bar, signalFixture } from './strategy-fixtures';

process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://fixture.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'fixture-public-key';

test('all preset identities propagate through snapshot outcome persistence using mock repositories',async()=>{
  const {evaluateMatureSignals}=await import('../lib/outcome-service');
  for(const strategyId of STRATEGY_IDS){
    const signal=signalFixture(strategyId),saved:Array<Record<string,unknown>>=[];
    const snapshot={...strategyIdentity(strategyId),id:1,symbol:'TEST',signal_date:'2026-09-04',information_cutoff_at:signal.cutoffAt,execution_mode:'historical_replay',point_in_time_valid:true,backtest_eligible:true,feature_snapshot:{official_ara:signal.officialAra,decision:{entry:{lower:99,upper:102},stop:{price:95},targets:{target1:110},validUntil:{tradingSessions:5}}}};
    const deps:OutcomeDependencies={pending:async(_limit,_config,id)=>{assert.equal(id,strategyId);return [snapshot];},save:async row=>{saved.push(row);return row;},daily:async()=>{throw new Error('Replay must never call live history.');}};
    const candles=strategyId==='bsjp'?[bar('2026-09-04','15:10','15:15'),bar('2026-09-08','09:00','09:05')]:strategyId==='ara'?[bar('2026-09-04','10:00','10:05',{high:125,close:120})]:[bar('2026-09-04','09:25','09:30'),bar('2026-09-04','15:30','15:35')];
    // The repository is entirely mocked; this tests the historical-archive dispatch path, never inserts fixture observations in DB.
    const archive={...archiveFixture(candles),origin:'historical_archive' as const,asOf:'2026-11-01T00:00:00Z',dailyCandles:Array.from({length:24},(_,i)=>({date:`2026-10-${String(i+1).padStart(2,'0')}`,open:100,high:104,low:98,close:102}))};
    const r=await evaluateMatureSignals(1,strategyId,async()=>archive,deps);assert.equal(r.evaluated,1,strategyId);assert.equal(saved.length,1);for(const [key,value] of Object.entries(strategyIdentity(strategyId)))assert.equal(saved[0][key],value);
  }
});
test('SWING replay without archive and every intraday strategy without archive never call live endpoints',async()=>{
  const {evaluateMatureSignals}=await import('../lib/outcome-service');
  for(const strategyId of STRATEGY_IDS){let calls=0;const signal=signalFixture(strategyId);const deps:OutcomeDependencies={pending:async()=>[{...strategyIdentity(strategyId),id:1,symbol:'TEST',signal_date:'2026-09-04',information_cutoff_at:signal.cutoffAt,execution_mode:'historical_replay',point_in_time_valid:true,backtest_eligible:true,feature_snapshot:{decision:{entry:{lower:99,upper:102},stop:{price:95},targets:{target1:110}}}}],save:async()=>{throw new Error('No incomplete outcome should be persisted');},daily:async()=>{calls++;return [];}};const r=await evaluateMatureSignals(1,strategyId,async()=>undefined,deps);assert.equal(calls,0);assert.equal(r.insufficientData,1);assert.equal(r.status,'insufficient_data');}
});
test('backtest routes protect reads and writes without authenticated session',async()=>{const {GET}=await import('../app/api/backtest/route');const {POST}=await import('../app/api/backtest/evaluate/route');const old=process.env.CRON_SECRET;delete process.env.CRON_SECRET;try{assert.equal((await GET(new NextRequest('http://localhost/api/backtest'))).status,401);assert.equal((await POST(new NextRequest('http://localhost/api/backtest/evaluate',{method:'POST'}))).status,401);}finally{if(old!==undefined)process.env.CRON_SECRET=old;}});
test('backtest validates strategy, execution mode, and malformed payload before any database request',async()=>{const {GET}=await import('../app/api/backtest/route');const {POST}=await import('../app/api/backtest/evaluate/route');const old=process.env.CRON_SECRET;process.env.CRON_SECRET='unit-test-cron-secret';const headers={authorization:'Bearer unit-test-cron-secret'};try{for(const query of ['strategyId=unknown','executionMode=legacy_unverified'])assert.equal((await GET(new NextRequest(`http://localhost/api/backtest?${query}`,{headers}))).status,400);for(const body of ['{','[]','{"strategyId":"UNKNOWN"}'])assert.equal((await POST(new NextRequest('http://localhost/api/backtest/evaluate',{method:'POST',headers,body}))).status,400);}finally{if(old===undefined)delete process.env.CRON_SECRET;else process.env.CRON_SECRET=old;}});
