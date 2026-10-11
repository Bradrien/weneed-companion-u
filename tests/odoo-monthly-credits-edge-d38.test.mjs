import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {stripTypeScriptTypes} from 'node:module';
test('monthly credit endpoint authenticates a confirmed owner before bounded read-only Odoo access',async t=>{
 const old={Deno:globalThis.Deno,fetch:globalThis.fetch,client:globalThis.__creditCreateClient};let handler,owner=true,confirmed=true,anonymous=false,refuse=false,calls=[];
 const vars={SUPABASE_URL:'https://project.invalid',SUPABASE_SERVICE_ROLE_KEY:'synthetic-service',ODOO_URL:'https://weneedweed.odoo.com',
  ODOO_DB:'synthetic',ODOO_USERNAME:'test@example.test',ODOO_API_KEY:'synthetic-odoo',ODOO_UID_PIN:'7'};
 globalThis.Deno={env:{get:k=>vars[k]},serve:fn=>{handler=fn}};
 globalThis.__creditCreateClient=()=>({auth:{getUser:async()=>({data:{user:{email:'owner@example.test',email_confirmed_at:confirmed?'2026-01-01T00:00:00Z':null,is_anonymous:anonymous}},error:null})},
  from:table=>{const q={select:()=>q,eq:()=>q,order:()=>q,limit:()=>q,maybeSingle:async()=>({data:table==='app_access_users'?{role:owner?'owner':'reader',is_active:true}:null,error:null})};return q;}});
 globalThis.fetch=async(url,options)=>{
  assert.equal(url,'https://weneedweed.odoo.com/jsonrpc');const {params}=JSON.parse(options.body);calls.push(params);
  if(refuse)return new Response(JSON.stringify({error:{message:'private provider data synthetic-odoo'}}));
  if(params.service==='common'){assert.equal(params.method,'authenticate');return new Response(JSON.stringify({result:7}))}
  assert.equal(params.service,'object');assert.equal(params.method,'execute_kw');
  const [,uid,,model,method,args,opts]=params.args;assert.equal(uid,7);assert.ok(['fields_get','search_read'].includes(method),'mutation attempted');
  let result;
  if(method==='fields_get'){assert.ok(['sale.order.line','account.move.line'].includes(model));assert.ok(args[0].length<=20);assert.deepEqual(opts.attributes,['type']);result=Object.fromEntries(args[0].map(k=>[k,{type:['product_uom','product_uom_id'].includes(k)?'many2one':'char'}]));}
  else{assert.ok(opts.limit<=401);result=model==='res.company'?[{id:10,name:'Trim Rocket s.r.o.'}]:[];
   if(model==='account.move'){assert.ok(args[0].some(x=>x[0]==='invoice_user_id'&&x[2]===7));assert.ok(args[0].some(x=>x[0]==='invoice_date'&&x[2]==='2026-10-01'));}}
  return new Response(JSON.stringify({result}));
 };
 try{
  const core=new URL('../supabase/functions/odoo-monthly-credits/core.mjs',import.meta.url).href;
  const code=(await readFile(new URL('../supabase/functions/odoo-monthly-credits/index.ts',import.meta.url),'utf8'))
   .replace("import {createClient} from 'npm:@supabase/supabase-js@2.58.0';",'const createClient=globalThis.__creditCreateClient;').replace("from './core.mjs'",'from '+JSON.stringify(core));
  await import('data:text/javascript;base64,'+Buffer.from(stripTypeScriptTypes(code)).toString('base64'));
  const req=(q='month=2026-10',method='GET',auth=true,origin='https://bradrien.github.io')=>new Request('https://project.invalid/functions/v1/odoo-monthly-credits?'+q,
   {method,headers:{origin,...(auth?{authorization:'Bearer synthetic-only'}:{})}});
  await t.test('unsupported methods, origins, periods and missing authentication are rejected before Odoo',async()=>{
   for(const [request,status] of [[req('month=2026-10','POST'),405],[req('month=2026-10','GET',true,'https://other.invalid'),403],
    [req('month=2026-10&seller=8'),400],[req('month=2026-10','GET',false),401]])assert.equal((await handler(request)).status,status);
   assert.equal(calls.length,0);
  });
  await t.test('unconfirmed, anonymous and non-owner sessions cannot read accounting sources',async()=>{
   confirmed=false;assert.equal((await handler(req())).status,401);confirmed=true;
   anonymous=true;assert.equal((await handler(req())).status,401);anonymous=false;
   owner=false;assert.equal((await handler(req())).status,403);owner=true;assert.equal(calls.length,0);
  });
  await t.test('the fixed host and UID pin prevent cross-service or cross-user reads',async()=>{
   vars.ODOO_URL='https://other.invalid';assert.equal((await handler(req())).status,503);assert.equal(calls.length,0);
   vars.ODOO_URL='https://weneedweed.odoo.com';vars.ODOO_UID_PIN='8';assert.equal((await handler(req())).status,503);assert.equal(calls.length,1);vars.ODOO_UID_PIN='7';
  });
  await t.test('a complete empty attributed-credit scope is rechecked and never represented as an automatic deduction',async()=>{
   const response=await handler(req()),body=await response.json();assert.equal(response.status,200);assert.equal(body.ok,true);
   assert.equal(body.data.month,'2026-10');assert.equal(body.data.document_count,0);assert.equal(body.data.source_rechecked,true);assert.equal(body.data.automatic_deduction,false);
   assert.equal(response.headers.get('cache-control'),'no-store');assert.ok(calls.every(c=>c.service==='common'||['search_read','fields_get'].includes(c.args[4])));
  });
  await t.test('provider errors disclose only a bounded phase and code',async()=>{
   refuse=true;const response=await handler(req()),body=await response.json();assert.equal(response.status,503);assert.equal(body.error,'odoo_credit_read_refused');
   assert.equal(JSON.stringify(body).includes('synthetic-odoo'),false);assert.equal(JSON.stringify(body).includes('private provider data'),false);
  });
 }finally{globalThis.Deno=old.Deno;globalThis.fetch=old.fetch;globalThis.__creditCreateClient=old.client}
});
