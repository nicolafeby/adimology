import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { screeningFixture } from './strategy-fixtures';
import { atJakartaTime } from '../lib/market-calendar';
import { NextRequest, NextResponse } from 'next/server';
import { evaluateUnifiedIdxScreener, type IdxScreenerCandidate } from '../lib/idx-strategy-filters';

test('authenticated APIs persist unavailable presets, isolate latest/history/details and resume terminal idempotent retries', async t => {
 t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-09-04T10:00:00Z') });
 const archives: Array<Record<string,any>> = [], snapshots: Array<Record<string,any>> = [];
 const runs: Array<Record<string,any>>=[], items: Array<Record<string,any>>=[], calls:string[]=[];
 let providerFailure=false, failOneSymbol=false, missingSchema=false;
 const universeRows=[{symbol:'BBCA',company_name:'Fixture bank',sector:'Financials'}];
 const server=createServer(async(req,res)=>{
  const url=new URL(req.url!,'http://localhost'); calls.push(url.pathname);
  let raw='';for await(const part of req)raw+=part;const body=raw?JSON.parse(raw):null;
  const send=(data:unknown,status=200)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(data));};
  if(missingSchema){send({code:'PGRST202',message:'Could not find the function public.claim_screening_run(p_run) in the schema cache',details:'private-diagnostic-fixture'},404);return;}
  if(providerFailure){send({message:'Bearer secret-token stack database internal'},500);return;}
  if(url.pathname.endsWith('/rpc/mark_stale_screening_runs')){send(0);return;}
  if(url.pathname.endsWith('/rpc/claim_screening_run')){const old=runs.find(r=>r.idempotency_key===body.p_run.idempotency_key);if(old){send([{id:old.id,reused:true}]);return;}runs.push({...body.p_run,status:'running'});send([{id:body.p_run.id,reused:false}]);return;}
  if(url.pathname.endsWith('/idx_universe')){send(universeRows);return;}
  if(failOneSymbol && url.pathname.endsWith('/source_snapshots') && url.searchParams.get('symbol')==='eq.FAIL'){send({message:'temporary database provider failure'},500);return;}
  if(url.pathname.endsWith('/screening_run_events')){send(null);return;}
  const table=url.pathname.endsWith('/screening_results')?items:url.pathname.endsWith('/source_snapshots')?archives:url.pathname.endsWith('/signal_snapshots')?snapshots:runs;
  const selected=table.filter(row=>[...url.searchParams].every(([key,value])=>!value.startsWith('eq.')||String(row[key])===value.slice(3)));
  if(req.method==='PATCH'){selected.forEach(row=>Object.assign(row,body));send(null);return;}
  if(req.method==='POST'){for(const row of Array.isArray(body)?body:[body]){const prior=table.find(r=>r.run_id===row.run_id&&r.symbol===row.symbol);prior?Object.assign(prior,row):table.push(row);}send(url.pathname.endsWith('/signal_snapshots') ? body : null);return;}
  if(req.headers.accept?.includes('vnd.pgrst.object'))send(selected.at(-1)??null);else send([...selected].reverse());
 });
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise<void>(resolve=>server.close(()=>resolve())));
 const address=server.address() as {port:number};
 process.env.NEXT_PUBLIC_SUPABASE_URL=`http://127.0.0.1:${address.port}`;process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY='fixture-anon';process.env.SUPABASE_SERVICE_ROLE_KEY='fixture-admin';process.env.AUTH_SECRET='fixture-auth-secret-32-characters-long';
 const [{setSession},runApi,rankingsApi,historyApi,detailApi,runDetailApi,unifiedApi]=await Promise.all([import('../lib/auth'),import('../app/api/screener/run/route'),import('../app/api/rankings/route'),import('../app/api/screener/runs/route'),import('../app/api/rankings/[symbol]/route'),import('../app/api/screener/runs/[runId]/route'),import('../app/api/screener/unified/route')]);
 const token=(await setSession(new NextResponse(),true)).headers.get('set-cookie')!.split(';')[0];
 const request=(path:string,body?:unknown,auth=true)=>new NextRequest(`http://localhost${path}`,{method:body===undefined?'GET':'POST',headers:{...(auth?{cookie:token} :{}),'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
 assert.equal((await unifiedApi.GET(request('/api/screener/unified',undefined,false))).status,401);assert.equal(calls.length,0);
 assert.equal((await unifiedApi.GET(request('/api/screener/unified?date=not-a-date'))).status,400);
 assert.equal((await runApi.POST(request('/api/screener/run',{strategyId:'bpjs'},false))).status,401);assert.equal(calls.length,0);
 assert.equal((await runApi.POST(request('/api/screener/run',{strategyId:'invalid'}))).status,400);assert.equal(calls.length,0);
 for(const strategyId of ['bpjs','bsjp','ara']){
  const response=await runApi.POST(request('/api/screener/run',{strategyId,idempotencyKey:'same-retry'}));assert.equal(response.status,200);const result=await response.json();assert.equal(result.strategy_id,strategyId);assert.equal(result.strategySupport.level,'unavailable');assert.equal(result.results.watch.length,1);assert.equal(result.results.watch[0].ranking,null);assert.equal(result.results.watch[0].backtest_eligible,false);
 }
 assert.equal(runs.length,3);assert.equal(new Set(runs.map(r=>r.idempotency_key)).size,3);
 const repeat=await(await runApi.POST(request('/api/screener/run',{strategyId:'bpjs',idempotencyKey:'same-retry'}))).json();assert.equal(repeat.reused,true);assert.equal(repeat.run.status,'completed');assert.equal(runs.length,3);
 const bpjs=runs.find(r=>r.strategy_id==='bpjs')!;
 const rankings=await(await rankingsApi.GET(request('/api/rankings?strategyId=bpjs'))).json();assert.equal(rankings.run.strategy_id,'bpjs');assert.equal(rankings.results.watch[0].strategy_id,'bpjs');
 const wrong=await(await rankingsApi.GET(request(`/api/rankings?strategyId=ara&runId=${bpjs.id}`))).json();assert.equal(wrong.run,null);
 const history=await(await historyApi.GET(request('/api/screener/runs?strategyId=bsjp'))).json();assert.deepEqual(history.data.map((r:any)=>r.strategy_id),['bsjp']);
 assert.equal((await detailApi.GET(request(`/api/rankings/BBCA?strategyId=ara&runId=${bpjs.id}`),{params:Promise.resolve({symbol:'BBCA'})})).status,404);
 assert.equal((await runDetailApi.GET(request(`/api/screener/runs/${bpjs.id}?strategyId=ara`),{params:Promise.resolve({runId:bpjs.id})})).status,404);
 const own=await(await detailApi.GET(request(`/api/rankings/BBCA?strategyId=bpjs&runId=${bpjs.id}`),{params:Promise.resolve({symbol:'BBCA'})})).json();assert.equal(own.data.screening.strategy_id,'bpjs');assert.equal(own.data.story,null);
 const beforeReplay=calls.length;
 const replay=await runApi.POST(request('/api/screener/run',{strategyId:'swing',analysisDate:'2026-01-05',executionMode:'historical_replay',informationCutoffAt:'2026-01-05T03:00:00Z'}));assert.equal(replay.status,422);assert.equal(calls.length,beforeReplay);
 assert.ok(!calls.some(path=>path.includes('agent_stories')||path.includes('signal_snapshots')), 'Unavailable intraday run must never execute daily/AI quantitative fallback');
 for(const strategyId of ['bpjs','bsjp','ara']) {
  const payload=screeningFixture(); payload.symbol='BBCA';payload.officialAra!.symbol='BBCA';
  const clock=strategyId==='bsjp'?'15:05':'09:20',cutoff=atJakartaTime('2026-09-04',clock);
  if(strategyId==='bsjp') {payload.candles[1].startAt=atJakartaTime('2026-09-04','15:00');payload.candles[1].endAt=cutoff;payload.candles[1].availableAt=cutoff;payload.sameClockVolumes.forEach(v=>v.throughTime='15:05');payload.book!.observedAt=cutoff;payload.book!.availableAt=cutoff;}
  const {strategyIdentity}=await import('../lib/strategies');
  archives.push({...strategyIdentity(strategyId as 'bpjs'),id:`input-${strategyId}`,symbol:'BBCA',data_type:'strategy_screening_input',temporal_validation_status:'valid',source:'deterministic_fixture',payload,observed_at:cutoff,available_at:cutoff,fetched_at:cutoff,is_historical_snapshot:true});
  const response=await runApi.POST(request('/api/screener/run',{strategyId,informationCutoffAt:cutoff,idempotencyKey:'valid-input'}));assert.equal(response.status,200);const result=await response.json();
  assert.equal(result.results.passed.length,1,JSON.stringify(result.results));assert.equal(result.results.passed[0].ranking_position,1);assert.equal(result.rankings[0].decision.strategy_id,strategyId);assert.equal(result.rankings[0].decision.signalExpiresAt,atJakartaTime('2026-09-04',strategyId==='bpjs'?'10:30':'15:30'));
  const snapshot=snapshots.find(row=>row.run_id===result.runId);assert.ok(snapshot);assert.equal(snapshot.strategy_id,strategyId);assert.equal(snapshot.backtest_eligible,false);assert.equal(snapshot.backtest_ineligibility_reasons[0].code,'FIXTURE_EXCLUDED');
  if(strategyId==='ara')assert.equal(result.rankings[0].decision.executionEligible,false);
 }
 assert.equal(snapshots.length,3);
 const unifiedRunId='11111111-1111-4111-8111-111111111111',unifiedCutoff='2026-09-04T08:45:00.000Z';
 const unifiedCandidate:IdxScreenerCandidate={ticker:'TEST',close:115,high:116,open:110,change_percent:15,volume:4000,volume_ma_5:2000,volume_ma_20:1000,market_cap:1e12,transaction_value:6e9,stoch_rsi_k:40,stoch_rsi_d:35,previous_stoch_rsi_k:30,previous_stoch_rsi_d:35,foreign_net_value:1,offer_depth_top_price:0,bid_depth_top_price:600,avg_bid_depth:100,ema_20:105,ema_50:100,macd_line:2,macd_signal:1,rsi_14:55,top3_broker_net_buy_value:300,top3_broker_net_sell_value:100};
 const unifiedRow=evaluateUnifiedIdxScreener([unifiedCandidate],{evaluatedAt:unifiedCutoff}).results[0];
 runs.push({id:unifiedRunId,strategy_id:'swing',analysis_date:'2026-09-04',status:'completed',universe_count:1,started_at:unifiedCutoff,information_cutoff_at:unifiedCutoff});
 items.push({run_id:unifiedRunId,strategy_id:'swing',symbol:'TEST',strategy_assessment:unifiedRow});
 const unifiedResponse=await(await unifiedApi.GET(request(`/api/screener/unified?runId=${unifiedRunId}`))).json();
 assert.equal(unifiedResponse.data.length,1);assert.deepEqual(unifiedResponse.data[0].matched_strategies,['BSJP','ARA_HUNTER','SWING','CLOSING_PRIORITY']);assert.equal(unifiedResponse.summary.topPriority,1);
 universeRows.push({symbol:'FAIL',company_name:'Fixture failure',sector:'Financials'});failOneSymbol=true;
 const partial=await(await runApi.POST(request('/api/screener/run',{strategyId:'bpjs',informationCutoffAt:atJakartaTime('2026-09-04','09:20'),idempotencyKey:'partial-run'}))).json();
 assert.equal(partial.run.status,'partial');assert.equal(partial.results.passed.length,1);assert.equal(partial.results.processingError.length,1);assert.equal(partial.results.processingError[0].symbol,'FAIL');assert.equal(partial.summary.quantitativeCompleted,1);
 failOneSymbol=false;
 providerFailure=true;const failed=await rankingsApi.GET(request('/api/rankings?strategyId=swing'));assert.equal(failed.status,500);assert.doesNotMatch(await failed.text(),/secret-token|stack|internal/);
 providerFailure=false;missingSchema=true;
 const updateRequired=await runApi.POST(request('/api/screener/run',{strategyId:'bpjs',idempotencyKey:'missing-schema'}));assert.equal(updateRequired.status,503);const updateBody=await updateRequired.json();assert.equal(updateBody.code,'SCREENING_UPDATE_REQUIRED');assert.doesNotMatch(JSON.stringify(updateBody),/claim_screening_run|schema cache|private-diagnostic-fixture/);
});
