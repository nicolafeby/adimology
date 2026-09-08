import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { NextResponse } from 'next/server';
import { setSession } from '../lib/auth';

let stage = 'startup';
async function main() {
  const baseURL = process.env.SCREENING_SMOKE_URL ?? 'http://127.0.0.1:3100';
  if (!['localhost','127.0.0.1'].includes(new URL(baseURL).hostname)) throw new Error('This smoke only targets a local server.');
  const browser = await chromium.launch({ headless:true, channel:process.env.SCREENING_BROWSER_CHANNEL ?? 'chrome' });
  const results: Array<{name:string;status:string;mode:string}> = [];
  try {
    // Real Next route/proxy, actual Set-Cookie serialization, no provider/DB call:
    // invalid strategy is rejected only after authentication succeeds.
    for (const verified of [true,false]) {
      stage = `real_cookie_${verified}`;
      const response = await setSession(NextResponse.json({success:true}),verified);
      const serialized = response.headers.get('set-cookie')!.split(';')[0];
      const cookieValue = serialized.slice(serialized.indexOf('=')+1);
      assert.ok(cookieValue.includes('%'), 'Exercise encoded cookie, not an unencoded test token');
      const context = await browser.newContext();
      await context.addCookies([{name:'adimology_session',value:cookieValue,url:baseURL,httpOnly:true,sameSite:'Lax'}]);
      const route = await context.request.post(`${baseURL}/api/screener/run`,{data:{strategyId:'invalid-fixture'}});
      assert.equal(route.status(),400,await route.text());
      results.push({name:`Real encoded ${verified?'verified':'guest'} cookie passes auth and reaches input validation`,status:'passed',mode:'real_local_api_no_database_mutation'});
      await context.close();
    }
    stage = 'unauthenticated_request';
    const unauthenticated = await browser.newContext();
    const denied = await unauthenticated.request.post(`${baseURL}/api/screener/run`,{data:{strategyId:'invalid-fixture'}});
    assert.equal(denied.status(),401); await unauthenticated.close();
    results.push({name:'Unauthenticated request remains rejected',status:'passed',mode:'real_local_api'});

    const context = await browser.newContext(); const page = await context.newPage();
    const errors: string[] = []; page.on('pageerror',error=>errors.push(error.message));
    let expired = false, loggedIn = false, failStatus = false, malformedStatus = false, stalledStatus = false, stalledLogin = false;
    await context.route('**/api/**',async route=>{
      const path = new URL(route.request().url()).pathname;
      const reply = (body:unknown,status=200)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
      if(path==='/api/auth/check-password') { if(stalledStatus)return; return failStatus?reply({success:false,error:'fixture'},503):malformedStatus?reply({success:false},200):reply({success:true,enabled:expired,isAuthenticated:!expired||loggedIn}); }
      if(path==='/api/auth/verify-password'){if(stalledLogin)return;assert.equal(route.request().postDataJSON().password,'fixture-login-only');loggedIn=true;return reply({success:true,valid:true});}
      if(path==='/api/screener/run'){expired=true;return reply({success:false,error:'Sesi tidak valid.'},401);}
      if(path==='/api/rankings')return reply({success:true,data:[],results:{watch:[],rejected:[],processingError:[]},summary:{},run:null});
      return reply({success:true,data:[],summary:null});
    });
    stage = 'login_recovery';
    await page.goto(`${baseURL}/rankings?strategyId=bpjs`);
    await page.getByTestId('run-screening').click();
    await page.getByRole('textbox',{name:'Password aplikasi'}).fill('fixture-login-only');
    assert.equal(await page.getByTestId('screening-page').count(),0);
    await page.getByRole('button',{name:'Unlock',exact:true}).click();
    await page.getByTestId('screening-page').waitFor();
    assert.equal(await page.getByTestId('screening-page').getAttribute('data-strategy'),'bpjs');
    results.push({name:'401 opens login and successful reauthentication restores BPJS',status:'passed',mode:'browser_with_mock_auth_api'});
    for(const kind of ['http_failure','invalid_success_payload']) {
      stage = kind;
      failStatus=kind==='http_failure';malformedStatus=!failStatus;
      await page.reload();await page.getByRole('button',{name:'Periksa login kembali'}).waitFor();
      assert.equal(await page.getByTestId('screening-page').count(),0);
      failStatus=false;malformedStatus=false;
      await page.getByRole('button',{name:'Periksa login kembali'}).click();await page.getByTestId('screening-page').waitFor();
      results.push({name:`Security status ${kind} fails closed and retry recovers`,status:'passed',mode:'browser_with_mock_auth_api'});
    }
    stage = 'stalled_status_timeout'; stalledStatus = true;
    await page.reload(); await page.getByRole('button',{name:'Periksa login kembali'}).waitFor({timeout:15_000});
    assert.match(await page.getByRole('alert').filter({hasText:'Pemeriksaan login terlalu lama'}).innerText(),/terlalu lama/);
    assert.equal(await page.getByTestId('screening-page').count(),0);
    stalledStatus=false;await page.getByRole('button',{name:'Periksa login kembali'}).click();await page.getByTestId('screening-page').waitFor();
    results.push({name:'Stalled status request times out, stays locked, and retry recovers',status:'passed',mode:'browser_with_mock_auth_api'});
    stage = 'stalled_login_timeout'; loggedIn=false;stalledLogin=true;
    await page.reload();await page.getByRole('textbox',{name:'Password aplikasi'}).fill('fixture-login-only');await page.getByRole('button',{name:'Unlock',exact:true}).click();
    await page.getByRole('alert').filter({hasText:'Login terlalu lama'}).waitFor({timeout:15_000});assert.equal(await page.getByTestId('screening-page').count(),0);
    stalledLogin=false;await page.getByRole('button',{name:'Unlock',exact:true}).click();await page.getByTestId('screening-page').waitFor();
    results.push({name:'Stalled password submission times out and can be retried',status:'passed',mode:'browser_with_mock_auth_api'});
    assert.deepEqual(errors,[]);
    await writeFile('docs/screening-auth-smoke.json',JSON.stringify({generatedAt:new Date().toISOString(),baseURL,results,runtimeErrors:errors,productionWrites:false},null,2)+'\n');
    console.log(`PASS ${results.length} auth regression scenarios; docs/screening-auth-smoke.json`);
    await context.close();
  } finally { await browser.close(); }
}
main().catch(()=>{console.error(`Auth smoke failed at ${stage}. Request credentials are not logged.`);process.exitCode=1;});
