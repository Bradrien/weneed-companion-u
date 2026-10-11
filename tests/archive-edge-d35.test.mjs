import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {stripTypeScriptTypes} from 'node:module';
test('archive coverage endpoints keep owner checks and bounded read-only RPCs',async t=>{
 const before={Deno:globalThis.Deno,client:globalThis.__archiveCreateClient};
 let handler,owner=true,confirmed=true,anonymous=false,failure=false,calls=[];
 globalThis.Deno={env:{get:key=>({SUPABASE_URL:'https://project.invalid',SUPABASE_SERVICE_ROLE_KEY:'synthetic-service-key'})[key]},serve:fn=>handler=fn};
 globalThis.__archiveCreateClient=()=>({
  auth:{getUser:async()=>({data:{user:{id:'10000000-1111-4111-8111-000000000001',email:'owner@example.test',email_confirmed_at:confirmed?'2026-10-01T00:00:00Z':null,is_anonymous:anonymous}},error:null})},
  from:table=>{
   if(table==='clients')return {select:()=>({order:()=>({limit:async()=>({data:[{id:'10000000-1111-4111-8111-000000000002',canonical_name:'Client synthétique'}],error:null})})})};
   assert.equal(table,'app_access_users');const q={select:()=>q,eq:()=>q,maybeSingle:async()=>({data:{role:owner?'owner':'reader',is_active:true},error:null})};return q;
  },
  rpc:async(name,args)=>{
   assert.ok(['whatsapp_archive_summary_v2','whatsapp_archive_conversations_page'].includes(name),'a write RPC was attempted');calls.push({name,args});
   return failure?{data:null,error:{message:'private-person@example.test token=secret'}}:{data:{version:'synthetic-read-result'},error:null};
  }
 });
 try{
  const core=new URL('../supabase/functions/whatsapp-archives/core.mjs',import.meta.url).href;
  const code=(await readFile(new URL('../supabase/functions/whatsapp-archives/index.ts',import.meta.url),'utf8'))
   .replace('import "jsr:@supabase/functions-js/edge-runtime.d.ts";','')
   .replace('import {createClient} from "npm:@supabase/supabase-js@2.58.0";','const createClient=globalThis.__archiveCreateClient;')
   .replace("from './core.mjs'",'from '+JSON.stringify(core));
  await import('data:text/javascript;base64,'+Buffer.from(stripTypeScriptTypes(code)).toString('base64'));
  const req=(query='action=summary',{token=true,origin='https://bradrien.github.io',method='GET'}={})=>new Request('https://project.invalid/functions/v1/whatsapp-archives?'+query,
   {method,headers:{origin,...(token?{authorization:'Bearer synthetic-owner'}:{})}});
  await t.test('missing session, unconfirmed email, anonymous session and reader role cannot read archives',async()=>{
   assert.equal((await handler(req('action=summary',{token:false}))).status,401);
   confirmed=false;assert.equal((await handler(req())).status,401);confirmed=true;
   anonymous=true;assert.equal((await handler(req())).status,401);anonymous=false;
   owner=false;assert.equal((await handler(req())).status,403);owner=true;assert.equal(calls.length,0);
  });
  await t.test('other origins, methods and malformed page scopes are rejected before archive reads',async()=>{
   assert.equal((await handler(req('',{origin:'https://other.example'}))).status,403);
   assert.equal((await handler(req('',{method:'DELETE'}))).status,405);
   for(const query of ['action=conversations&offset=-1','action=conversations&offset=1.2','action=conversations&offset=50001',
    'action=conversations&limit=501','action=conversations&limit=abc','action=conversations&client_id=guess'])
    assert.equal((await handler(req(query))).status,400);
   assert.equal(calls.length,0);
  });
  await t.test('summary uses only the aggregate read RPC and never caches owner data',async()=>{
   const r=await handler(req());assert.equal(r.status,200);assert.equal(r.headers.get('cache-control'),'no-store');
   assert.deepEqual(calls.at(-1),{name:'whatsapp_archive_summary_v2',args:undefined});assert.equal((await r.json()).ok,true);
  });
  await t.test('new pages are bounded to 100 and previous previews retain their 500-row ceiling',async()=>{
   const client='10000000-1111-4111-8111-000000000002';
   const r=await handler(req('action=conversations&offset=100&limit=100&client_id='+client));assert.equal(r.status,200);
   assert.deepEqual(calls.at(-1),{name:'whatsapp_archive_conversations_page',args:{p_client_id:client,p_offset:100,p_limit:100}});
   assert.equal((await r.json()).clients.length,1);
   await handler(req('action=conversations'));assert.equal(calls.at(-1).args.p_limit,500);
  });
  await t.test('database failures produce a bounded error without leaking provider details',async()=>{
   failure=true;const r=await handler(req()),body=await r.json();assert.equal(r.status,500);assert.equal(body.error,'archive_unavailable');
   assert.ok(!JSON.stringify(body).includes('secret'));
  });
 }finally{globalThis.Deno=before.Deno;globalThis.__archiveCreateClient=before.client}
});
