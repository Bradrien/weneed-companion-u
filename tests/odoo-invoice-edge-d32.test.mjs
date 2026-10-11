import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {stripTypeScriptTypes} from 'node:module';
import {ORDER_FIELDS,MOVE_FIELDS} from '../supabase/functions/odoo-invoice-evidence/core.mjs';

test('invoice edge remains an authenticated, bounded read-only service',async t=>{
 const old={Deno:globalThis.Deno,fetch:globalThis.fetch,client:globalThis.__invoiceCreateClient};
 let handler,owner=true,confirmed=true,changed=false,accessible=true,reads=0,calls=[];
 const vars={SUPABASE_URL:'https://project.invalid',SUPABASE_SERVICE_ROLE_KEY:'synthetic-service-key',
  ODOO_URL:'https://weneedweed.odoo.com',ODOO_DB:'synthetic',ODOO_USERNAME:'test@example.test',
  ODOO_API_KEY:'synthetic-odoo-key',ODOO_UID_PIN:'100'};
 const order={id:1,name:'TEST-ORDER',state:'sale',invoice_status:'invoiced',user_id:[100,'Vendeur test'],
  company_id:[10,'Trim Rocket s.r.o.'],partner_id:[200,'Client test'],currency_id:[1,'EUR'],amount_untaxed:140,
  invoice_ids:[501],write_date:'2026-10-11 09:00:00'};
 const invoice={id:501,name:'TEST-INV',state:'posted',move_type:'out_invoice',payment_state:'paid',
  company_id:[10,'Trim Rocket s.r.o.'],partner_id:[200,'Client test'],currency_id:[1,'EUR'],invoice_date:'2026-10-09',
  amount_untaxed:140,amount_total:140,amount_residual:0,reversed_entry_id:false,write_date:'2026-10-11 09:00:00'};
 globalThis.Deno={env:{get:key=>vars[key]},serve:fn=>{handler=fn}};
 globalThis.__invoiceCreateClient=()=>({auth:{getUser:async()=>({data:{user:{email:'owner@example.test',
  email_confirmed_at:confirmed?'2026-10-01T00:00:00Z':null}},error:null})},from:()=>{
   const q={select:()=>q,eq:()=>q,maybeSingle:async()=>({data:{role:owner?'owner':'reader',is_active:true},error:null})};return q;
  }});
 globalThis.fetch=async(url,options)=>{
  assert.equal(url,'https://weneedweed.odoo.com/jsonrpc');
  const {params}=JSON.parse(options.body);calls.push(params);let result;
  if(params.service==='common'){assert.equal(params.method,'authenticate');result=100}
  else{
   assert.equal(params.service,'object');assert.equal(params.method,'execute_kw');
   const [,uid,,model,method,args,opts]=params.args;
   assert.equal(uid,100);assert.equal(method,'search_read','Mutation attempted');assert.ok(opts.limit<=61);
   if(model==='sale.order'){
    assert.deepEqual(opts.fields,ORDER_FIELDS);assert.deepEqual(args[0],[['id','=',1],['user_id','=',100]]);
    result=accessible?[order]:[];
   }else{
    assert.equal(model,'account.move');assert.deepEqual(opts.fields,MOVE_FIELDS);
    assert.ok(args[0].some(x=>x[0]==='company_id'&&x[2]===10));
    if(args[0][0][0]==='reversed_entry_id')result=[];
    else{reads++;result=[{...invoice,amount_residual:changed&&reads>1?10:0}];}
   }
  }
  return new Response(JSON.stringify({jsonrpc:'2.0',id:1,result}));
 };
 try{
  const entry=new URL('../supabase/functions/odoo-invoice-evidence/index.ts',import.meta.url),
   core=new URL('../supabase/functions/odoo-invoice-evidence/core.mjs',import.meta.url).href;
  const code=(await readFile(entry,'utf8')).replace("import {createClient} from 'npm:@supabase/supabase-js@2.58.0';",
   'const createClient=globalThis.__invoiceCreateClient;').replace("from './core.mjs'",'from '+JSON.stringify(core));
  await import('data:text/javascript;base64,'+Buffer.from(stripTypeScriptTypes(code)).toString('base64'));
  const req=(query='order_id=1',method='GET',auth=true,origin='https://bradrien.github.io')=>new Request(
   'https://project.invalid/functions/v1/odoo-invoice-evidence?'+query,{method,headers:{origin,
    ...(auth?{authorization:'Bearer synthetic-owner-token'}:{})}});
  await t.test('unsupported origin, write method, query and unauthenticated access are rejected before Odoo',async()=>{
   assert.equal((await handler(req('order_id=1','GET',true,'https://other.example'))).status,403);
   assert.equal((await handler(req('order_id=1','POST'))).status,405);
   assert.equal((await handler(req('order_id=1&fields=all'))).status,400);
   assert.equal((await handler(req('order_id=1','GET',false))).status,401);assert.equal(calls.length,0);
  });
  await t.test('unconfirmed email and non-owner ACL are rejected before Odoo',async()=>{
   confirmed=false;assert.equal((await handler(req())).status,401);confirmed=true;
   owner=false;assert.equal((await handler(req())).status,403);owner=true;assert.equal(calls.length,0);
  });
  await t.test('host and UID pin prevent credentials from being sent to another service',async()=>{
   vars.ODOO_URL='https://other.example';assert.equal((await handler(req())).status,503);assert.equal(calls.length,0);
   vars.ODOO_URL='https://weneedweed.odoo.com';vars.ODOO_UID_PIN='101';
   assert.equal((await handler(req())).status,503);assert.equal(calls.length,1);vars.ODOO_UID_PIN='100';
  });
  await t.test('successful source response is rechecked, nonpayable and never cached',async()=>{
   const response=await handler(req()),body=await response.json();
   assert.equal(response.status,200);assert.equal(body.ok,true);assert.equal(body.data.source_rechecked,true);
   assert.equal(body.data.commission_payable,false);assert.equal(body.data.odoo_paid_invoice_count,1);
   assert.equal(response.headers.get('cache-control'),'no-store');assert.equal(reads,2);
  });
  await t.test('unavailable seller order cannot be used to read arbitrary invoice ids',async()=>{
   accessible=false;const before=calls.length;
   assert.equal((await handler(req())).status,404);assert.equal(calls.length-before,2);accessible=true;
  });
  await t.test('changed residual rejects the whole read with a safe retryable error',async()=>{
   changed=true;reads=0;const response=await handler(req()),body=await response.json();
   assert.equal(response.status,409);assert.equal(body.error,'odoo_source_changed');
   assert.equal(JSON.stringify(body).includes('synthetic-odoo-key'),false);
  });
 }finally{globalThis.Deno=old.Deno;globalThis.fetch=old.fetch;globalThis.__invoiceCreateClient=old.client}
});
