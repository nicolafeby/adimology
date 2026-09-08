import assert from 'node:assert/strict';
import test from 'node:test';
import { createHmac } from 'node:crypto';
import { createServer } from 'node:http';
import { NextRequest, NextResponse } from 'next/server';
import { createSessionToken, getSession, sessionTokenFromRequest, setSession, verifySessionToken } from '../lib/auth';
import { guardScreenerRequest } from '../lib/screener-api';
import { proxy } from '../proxy';

const authSecret='auth-regression-fixture-only-32-characters';
process.env.AUTH_SECRET=authSecret;
async function sessionCookie(verified:boolean) { const response=await setSession(new NextResponse(),verified);return response.headers.get('set-cookie')!.split(';')[0]; }

test('real serialized guest and verified cookies pass proxy and screening guard consistently', async()=>{
 for(const verified of [false,true]) {
  const cookie=await sessionCookie(verified);assert.match(cookie,/%3D/,'Fixture must exercise JWT padding encoded by NextResponse');
  const request=new NextRequest('http://localhost:3000/api/screener/run',{headers:{cookie}});
  assert.equal(sessionTokenFromRequest(request),request.cookies.get('adimology_session')?.value);
  assert.equal((await getSession(request))?.verified,verified);
  assert.equal(await guardScreenerRequest(request),null);
  assert.equal((await proxy(request)).headers.get('x-middleware-next'),'1');
  assert.equal(await guardScreenerRequest(new Request(request.url,{headers:{cookie}})),null);
 }
});
test('malformed, tampered, missing and expired sessions remain rejected',async t=>{
 for(const cookie of ['', 'adimology_session=%E0%A4%A','adimology_session=invalid.invalid.invalid']) assert.equal((await guardScreenerRequest(new NextRequest('http://localhost/api/screener/run',{headers:{cookie}})))?.status,401);
 const token=await createSessionToken({authenticated:true,verified:true});assert.equal(await verifySessionToken(`${token}.extra`),null);assert.equal(await verifySessionToken(`${token.slice(0,-3)}xyz`),null);
 t.mock.timers.enable({apis:['Date'],now:new Date('2026-09-07T00:00:00Z')});
 const expires=await createSessionToken({authenticated:true,verified:true});t.mock.timers.setTime(new Date('2026-09-08T00:00:00Z').getTime());assert.equal(await verifySessionToken(expires),null);
});
test('a valid signature cannot bypass finite expiry and authenticated claim requirements',async()=>{
 const sign=(payload:Record<string,unknown>)=>{const prefix=`${btoa(JSON.stringify({alg:'HS256',typ:'JWT'}))}.${btoa(JSON.stringify(payload))}`;return `${prefix}.${createHmac('sha256',authSecret).update(prefix).digest('base64url')}`;};
 for(const payload of [{authenticated:true},{authenticated:true,exp:'9999999999999'},{authenticated:false,exp:Date.now()+10000},{verified:true,exp:Date.now()+10000}])assert.equal(await verifySessionToken(sign(payload)),null);
});
test('password status decodes actual cookies, issues guest only for explicit disabled setting, and fails closed on DB error',async t=>{
 let enabled='false',failed=false, stalled=false;
 const server=createServer((request,response)=>{if(stalled)return;const key=new URL(request.url!,'http://localhost').searchParams.get('key');response.writeHead(failed?500:200,{'content-type':'application/json'});response.end(JSON.stringify(failed?{message:'Fixture database unavailable'}:{value:key==='eq.password_enabled'?enabled:'fixture-hash'}));});
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise<void>(resolve=>server.close(()=>resolve())));
 process.env.NEXT_PUBLIC_SUPABASE_URL=`http://127.0.0.1:${(server.address() as {port:number}).port}`;process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY='fixture-anon';process.env.SUPABASE_SERVICE_ROLE_KEY='fixture-admin';
 const {GET}=await import('../app/api/auth/check-password/route');
 const guestResponse=await GET(new Request('http://localhost/api/auth/check-password'));assert.equal(guestResponse.status,200);assert.equal((await guestResponse.json()).isAuthenticated,true);const cookie=guestResponse.headers.get('set-cookie')!.split(';')[0];assert.equal((await getSession(new Request('http://localhost',{headers:{cookie}})))?.verified,false);
 enabled='true';const guest=await GET(new Request('http://localhost/api/auth/check-password',{headers:{cookie}}));assert.equal((await guest.json()).isAuthenticated,false);
 const verified=await GET(new Request('http://localhost/api/auth/check-password',{headers:{cookie:await sessionCookie(true)}}));assert.equal((await verified.json()).isAuthenticated,true);
 failed=true;const unavailable=await GET(new Request('http://localhost/api/auth/check-password'));assert.equal(unavailable.status,503);assert.equal(unavailable.headers.get('set-cookie'),null);assert.equal((await unavailable.json()).success,false);
 stalled=true;const start=Date.now();const timeout=await GET(new Request('http://localhost/api/auth/check-password'));assert.equal(timeout.status,503);assert.equal(timeout.headers.get('set-cookie'),null);assert.equal((await timeout.json()).code,'AUTH_SETTINGS_TIMEOUT');assert.ok(Date.now()-start<8_000,'Stalled database query must have a bounded deadline');
 stalled=false;failed=false;const recovered=await GET(new Request('http://localhost/api/auth/check-password'));assert.equal(recovered.status,200);
});
