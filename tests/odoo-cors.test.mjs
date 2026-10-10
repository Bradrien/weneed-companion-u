import test from 'node:test';
import assert from 'node:assert/strict';
import {createHandler} from '../supabase/functions/odoo-read/core.mjs';

const origin='https://bradrien.github.io';
const address='https://example-project.supabase.co/functions/v1/odoo-read?resource=ping';
const env={
 ODOO_URL:'https://weneedweed.odoo.com',
 ODOO_DB:'test_odoo_db',
 ODOO_USERNAME:'not-a-real-login@example.test',
 ODOO_API_KEY:'dummy-not-a-real-secret',
 ODOO_UID_PIN:'',
 ODOO_ALLOWED_ORIGIN:''
};
const fakeFetch=async()=>new Response(JSON.stringify({jsonrpc:'2.0',id:1,result:32}),
 {status:200,headers:{'content-type':'application/json'}});
const gateway=createHandler({env,authenticateCaller:async jwt=>jwt==='fake-owner-token',fetchImpl:fakeFetch});

test('published Companion origin can preflight with expected narrow CORS headers',async()=>{
 const r=await gateway(new Request(address,{method:'OPTIONS',headers:{origin,
  'access-control-request-method':'GET',
  'access-control-request-headers':'authorization,apikey'}}));
 assert.equal(r.status,204);
 assert.equal(r.headers.get('access-control-allow-origin'),origin);
 assert.match(r.headers.get('access-control-allow-methods'),/GET/);
 assert.doesNotMatch(r.headers.get('access-control-allow-origin'),/\*/);
});
test('a foreign website cannot preflight or query the owner-only gateway',async()=>{
 const fake='https://malicious.example';
 const response=await gateway(new Request(address,{method:'OPTIONS',headers:{origin:fake}}));
 assert.equal(response.status,403);
 assert.equal(response.headers.get('access-control-allow-origin'),null);
 const get=await gateway(new Request(address,{headers:{origin:fake,
   authorization:'Bearer fake-owner-token'}}));
 assert.equal(get.status,403);
});
test('preflight permission does not bypass authentication',async()=>{
 const response=await gateway(new Request(address,{headers:{origin}}));
 assert.equal(response.status,401);
 assert.equal((await response.json()).error,'authentication_required');
 assert.equal(response.headers.get('access-control-allow-origin'),origin);
});
test('signed-in owner can perform read-only ping with simulated upstream',async()=>{
 const r=await gateway(new Request(address,{headers:{origin,
  authorization:'Bearer fake-owner-token'}}));
 assert.equal(r.status,200);
 assert.deepEqual((await r.json()),{ok:true,data:{connected:true,mode:'read_only',persisted:false}});
});
test('unknown tokens are rejected before touching Odoo',async()=>{
 let called=false;
 const g=createHandler({env,authenticateCaller:async()=>false,fetchImpl:async()=>{called=true;throw Error('should not run')}});
 const r=await g(new Request(address,{headers:{origin,authorization:'Bearer fake-bad-token'}}));
 assert.equal(r.status,403);
 assert.equal(called,false);
});
test('legacy local-origin allowance remains scoped to known resources',async()=>{
 const r=await gateway(new Request(address,{method:'OPTIONS',headers:{origin:'null'}}));
 assert.equal(r.status,204);
 const blocked=await gateway(new Request('https://example-project.supabase.co/functions/v1/odoo-read?resource=secret',
  {method:'OPTIONS',headers:{origin:'null'}}));
 assert.equal(blocked.status,403);
});

test('rejected Odoo credentials return a bounded owner-only diagnostic code',async()=>{
 const fetchImpl=async()=>new Response(JSON.stringify({jsonrpc:'2.0',id:1,result:false}),
  {status:200,headers:{'content-type':'application/json'}});
 const g=createHandler({env,authenticateCaller:async()=>true,fetchImpl});
 const r=await g(new Request(address,{headers:{origin,authorization:'Bearer fake-owner-token'}}));
 assert.equal(r.status,502);
 assert.deepEqual(await r.json(),{ok:false,error:'odoo_credentials_rejected'});
});
test('valid Odoo authentication but wrong pinned ID has a distinct safe code',async()=>{
 const g=createHandler({env:{...env,ODOO_UID_PIN:'99'},authenticateCaller:async()=>true,fetchImpl:fakeFetch});
 const r=await g(new Request(address,{headers:{origin,authorization:'Bearer fake-owner-token'}}));
 assert.equal(r.status,502);
 assert.deepEqual(await r.json(),{ok:false,error:'odoo_uid_pin_mismatch'});
});
test('valid pinned identity still permits owner-only read-only ping',async()=>{
 const g=createHandler({env:{...env,ODOO_UID_PIN:'32'},authenticateCaller:async()=>true,fetchImpl:fakeFetch});
 const r=await g(new Request(address,{headers:{origin,authorization:'Bearer fake-owner-token'}}));
 assert.equal(r.status,200);
 assert.equal((await r.json()).data.connected,true);
});

test('credential_probe is owner-only and rejects unknown or untrusted query params',async()=>{
 const withoutToken=await gateway(new Request(address.replace('resource=ping','resource=credential_probe'),{headers:{origin}}));
 assert.equal(withoutToken.status,401);
 const invalidQuery=await gateway(new Request(address.replace('resource=ping','resource=credential_probe&ids=13'),{
  headers:{origin,authorization:'Bearer fake-owner-token'}}));
 assert.equal(invalidQuery.status,400);
});
test('credential_probe validates saved Odoo key against PIN and never returns order data',async()=>{
 const cfg={...env,ODOO_UID_PIN:'32'};
 let calls=[];
 const fetchImpl=async(_url,opts)=>{
  const p=JSON.parse(opts.body).params;
  calls.push({service:p.service,method:p.method,model:p.args[3],action:p.args[4]});
  return new Response(JSON.stringify({result:[{id:123456}]}),{status:200,headers:{'content-type':'application/json'}});
 };
 const probe=createHandler({env:cfg,authenticateCaller:async()=>true,fetchImpl});
 const r=await probe(new Request(address.replace('resource=ping','resource=credential_probe'),{headers:{origin,authorization:'Bearer fake-owner-token'}}));
 assert.equal(r.status,200);
 const data=(await r.json()).data;
 assert.deepEqual(data,{pinned_credentials_accepted:true,returned_order_data:false,mode:'read_only',persisted:false});
 assert.deepEqual(calls,[{service:'object',method:'execute_kw',model:'sale.order',action:'search_read'}]);
});
test('credential_probe requires server-configured expected UID',async()=>{
 const g=createHandler({env,authenticateCaller:async()=>true,fetchImpl:fakeFetch});
 const r=await g(new Request(address.replace('resource=ping','resource=credential_probe'),{headers:{origin,authorization:'Bearer fake-owner-token'}}));
 assert.equal(r.status,503);
 assert.equal((await r.json()).error,'odoo_uid_pin_not_configured');
});
test('credential_probe sanitizes upstream rejection',async()=>{
 const fake=async()=>new Response(JSON.stringify({error:{message:'secret data should not leak'}}),
 {status:200,headers:{'content-type':'application/json'}});
 const g=createHandler({env:{...env,ODOO_UID_PIN:'13'},authenticateCaller:async()=>true,fetchImpl:fake});
 const r=await g(new Request(address.replace('resource=ping','resource=credential_probe'),{headers:{origin,authorization:'Bearer fake-owner-token'}}));
 assert.equal(r.status,502);
 assert.deepEqual(await r.json(),{ok:false,error:'odoo_pinned_read_rejected'});
});
