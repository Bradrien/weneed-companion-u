import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {stripTypeScriptTypes} from 'node:module';
test('return deduction reads require a confirmed owner and expose no mutation or provider details',async t=>{
 const old={Deno:globalThis.Deno,client:globalThis.__returnsCreateClient};let handler,owner=true,confirmed=true,anonymous=false,error=false,calls=[];
 const vars={SUPABASE_URL:'https://project.invalid',SUPABASE_SERVICE_ROLE_KEY:'synthetic-service-key'};
 globalThis.Deno={env:{get:k=>vars[k]},serve:fn=>{handler=fn}};
 globalThis.__returnsCreateClient=()=>({auth:{getUser:async()=>({data:{user:{email:'owner@example.test',
  email_confirmed_at:confirmed?'2026-01-01T00:00:00Z':null,is_anonymous:anonymous}},error:null})},
  from:table=>{assert.equal(table,'app_access_users');const q={select:()=>q,eq:()=>q,maybeSingle:async()=>({data:{role:owner?'owner':'reader',is_active:true},error:null})};return q;},
  rpc:async(name,args)=>{calls.push({name,args});return {data:{version:'commission_returns_v1',month:args.p_month,
   scope:'recorded_deductions_only',read_at:new Date().toISOString(),total:0,deductions:[]},error:error?{message:'private provider detail'}:null};}});
 try{
  const code=(await readFile(new URL('../supabase/functions/commission-returns/index.ts',import.meta.url),'utf8'))
   .replace("import {createClient} from 'npm:@supabase/supabase-js@2.58.0';",'const createClient=globalThis.__returnsCreateClient;');
  await import('data:text/javascript;base64,'+Buffer.from(stripTypeScriptTypes(code)).toString('base64'));
  const req=(q='month=2026-06',method='GET',auth=true,origin='https://bradrien.github.io')=>new Request('https://project.invalid/functions/v1/commission-returns?'+q,
   {method,headers:{origin,...(auth?{authorization:'Bearer synthetic-only'}:{})}});
  await t.test('method, origin, duplicate queries and unauthenticated calls fail before reading deductions',async()=>{
   for(const [r,status] of [[req('month=2026-06','POST'),405],[req('month=2026-06','GET',true,'https://other.invalid'),403],
    [req('month=2026-06&month=2026-07'),400],[req('month=2026-06&company=OTHER'),400],[req('month=2026-06','GET',false),401]])assert.equal((await handler(r)).status,status);
   assert.equal(calls.length,0);
  });
  await t.test('unconfirmed, anonymous and non-owner sessions cannot read the private source',async()=>{
   confirmed=false;assert.equal((await handler(req())).status,401);confirmed=true;
   anonymous=true;assert.equal((await handler(req())).status,401);anonymous=false;
   owner=false;assert.equal((await handler(req())).status,403);owner=true;assert.equal(calls.length,0);
  });
  await t.test('the only RPC is a fixed read for the requested month, without caching or arbitrary parameters',async()=>{
   const response=await handler(req()),body=await response.json();assert.equal(response.status,200);assert.equal(body.ok,true);
   assert.deepEqual(calls,[{name:'api_owner_commission_returns',args:{p_month:'2026-06'}}]);assert.equal(response.headers.get('cache-control'),'no-store');
  });
  await t.test('source failure does not become a zero or disclose private errors',async()=>{
   error=true;const response=await handler(req()),body=await response.json();assert.equal(response.status,503);
   assert.equal(body.error,'return_deductions_unavailable');assert.equal(JSON.stringify(body).includes('private provider detail'),false);
  });
 }finally{globalThis.Deno=old.Deno;globalThis.__returnsCreateClient=old.client}
});
