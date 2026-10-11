import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {stripTypeScriptTypes} from 'node:module';

// Execute the real handler with synthetic services. No network or live account access.
test('owner Odoo edge guards and repeated reads',async t=>{
 const oldDeno=globalThis.Deno,oldFetch=globalThis.fetch,oldClient=globalThis.__commissionCreateClient;
 let handler,changed=false,owner=true,confirmed=true,lineReads=0,calls=[];
 const sourceOrder={id:1,name:'TEST-1',date_order:'2026-10-09 09:00:00',state:'sale',
  invoice_status:'to invoice',partner_id:[200,'Client synthétique'],user_id:[300,'Vendeur synthétique'],
  company_id:[400,'Global Trust Agriculture SA'],amount_untaxed:560,currency_id:[1,'EUR'],
  write_date:'2026-10-11 08:00:00'};
 const sourceLine={id:10,order_id:[1,'TEST-1'],product_id:[100,'Produit synthétique'],
  product_uom_qty:4,price_unit:140,price_subtotal:560,discount:0,display_type:false,
  product_uom:[1,'g'],name:'Produit synthétique',write_date:'2026-10-11 08:00:00'};
 const product={id:100,default_code:'TEST',name:'Produit synthétique'};
 const catalog={company:'GTA',sku:'TEST',product_name:'Produit synthétique',tier:'A',cost_eur:100,list_price_eur:140};
 const vars={SUPABASE_URL:'https://project.invalid',SUPABASE_SERVICE_ROLE_KEY:'test-only-placeholder',
  ODOO_URL:'https://weneedweed.odoo.com',ODOO_DB:'synthetic',ODOO_USERNAME:'synthetic@example.test',
  ODOO_API_KEY:'test-only-placeholder',ODOO_UID_PIN:'300'};
 globalThis.Deno={env:{get:name=>vars[name]},serve:fn=>{handler=fn}};
 globalThis.__commissionCreateClient=()=>({auth:{getUser:async()=>({data:{user:{email:'owner@example.test',
  email_confirmed_at:confirmed?'2026-10-01T00:00:00Z':null}},error:null})},from:table=>{
  const q={select:()=>q,eq:()=>q,order:()=>q,limit:()=>q,
   maybeSingle:async()=>({data:table==='app_access_users'?{role:owner?'owner':'reader',is_active:true}:
    {id:'synthetic-snapshot',item_count:1,source_completed_at:'2026-10-11T08:00:00Z'},error:null}),
   range:async()=>({data:[catalog],error:null})};return q;
 }});
 globalThis.fetch=async(url,options)=>{
  assert.equal(url,'https://weneedweed.odoo.com/jsonrpc');
  const {params}=JSON.parse(options.body);calls.push(params);
  let result;
  if(params.service==='common'){assert.equal(params.method,'authenticate');result=300}
  else{
   assert.equal(params.service,'object');assert.equal(params.method,'execute_kw');
   const [,uid,,model,method,args,opts]=params.args;
   assert.equal(uid,300);assert.equal(method,'search_read','Odoo mutation attempted');
   assert.ok(opts.limit>0&&opts.limit<=101,'Unbounded read');
   if(model==='sale.order'){
    const domain=args[0];assert.ok(domain.some(x=>x[0]==='user_id'&&x[1]==='='&&x[2]===300));
    const pending=domain.some(x=>x[0]==='state'&&x[2]?.includes('draft'));
    result=pending?[]:[structuredClone(sourceOrder)];
   }else if(model==='sale.order.line'){
    lineReads++;result=[{...sourceLine,price_subtotal:changed&&lineReads>1?559:560}];
   }else if(model==='product.product')result=[product];
   else throw Error('unexpected_model');
  }
  return new Response(JSON.stringify({jsonrpc:'2.0',id:1,result}),{status:200});
 };
 try{
  const path=new URL('../supabase/functions/odoo-commission-pipeline/index.ts',import.meta.url),
   core=new URL('../supabase/functions/odoo-commission-pipeline/core.mjs',import.meta.url).href,
   scope=new URL('../supabase/functions/odoo-commission-pipeline/scope.mjs',import.meta.url).href;
  let code=await readFile(path,'utf8');
  code=code.replace("import {createClient} from 'npm:@supabase/supabase-js@2.58.0';",
   'const createClient=globalThis.__commissionCreateClient;').replace("from './core.mjs'",'from '+JSON.stringify(core))
    .replace("from './scope.mjs'",'from '+JSON.stringify(scope));
  await import('data:text/javascript;base64,'+Buffer.from(stripTypeScriptTypes(code)).toString('base64'));
  const request=(method='GET',auth=true,origin='https://bradrien.github.io')=>new Request(
   'https://project.invalid/functions/v1/odoo-commission-pipeline',{method,headers:{origin,
    ...(auth?{authorization:'Bearer synthetic-user-token'}:{})}});
  await t.test('reject unsupported origin, method and missing bearer before Odoo',async()=>{
   assert.equal((await handler(request('GET',true,'https://other.example'))).status,403);
   assert.equal((await handler(request('POST'))).status,405);
   assert.equal((await handler(request('GET',false))).status,401);
   assert.equal(calls.length,0);
  });
  await t.test('confirmed owner allowlist is enforced before Odoo',async()=>{
   owner=false;assert.equal((await handler(request())).status,403);owner=true;
   confirmed=false;assert.equal((await handler(request())).status,401);confirmed=true;
   assert.equal(calls.length,0);
  });
  await t.test('successful response performs bounded repeat reads and stays nonpayable',async()=>{
   const response=await handler(request()),body=await response.json();
   assert.equal(response.status,200);assert.equal(body.ok,true);
   assert.equal(lineReads,2);assert.equal(body.data.revision,5);
   assert.equal(body.data.period_from,new Date().toISOString().slice(0,7)+'-01');
   assert.equal(body.data.source_lines_rechecked,true);assert.equal(body.data.source_amounts_rechecked,true);
   assert.equal(body.data.uncertainties.payable,false);
   assert.equal(body.data.orders[0].forecast,13.93);
   assert.equal(response.headers.get('cache-control'),'no-store');
  });
  await t.test('monthly query cannot read outside selected window',async()=>{
   const url='https://project.invalid/functions/v1/odoo-commission-pipeline?from=2026-10-01&to=2026-10-31';
   const r=new Request(url,{headers:{origin:'https://bradrien.github.io',authorization:'Bearer synthetic-user-token'}});
   const response=await handler(r);assert.equal(response.status,200);
   const body=await response.json();assert.equal(body.data.period_to,'2026-10-31');
   const lastOrders=calls.filter(c=>c.service==='object'&&c.method==='execute_kw'&&c.args[3]==='sale.order');
   assert.ok(lastOrders.length>0);
   const fromDomain=lastOrders.filter(c=>c.args[4]==='search_read').map(c=>c.args[5][0]);
   assert.ok(fromDomain.some(x=>x.some(t=>t[0]==='date_order'&&t[1]==='>='&&t[2]==='2026-10-01 00:00:00')));
   const bad=new Request(url+'&junk=1',{headers:{origin:'https://bradrien.github.io',authorization:'Bearer synthetic-user-token'}});
   assert.equal((await handler(bad)).status,400);
  });
  await t.test('financial line changed during read rejects the complete snapshot',async()=>{
   changed=true;lineReads=0;
   const response=await handler(request()),body=await response.json();
   assert.equal(response.status,409);assert.deepEqual(body,{ok:false,error:'odoo_source_changed',stage:'lines_recheck'});
  });
 }finally{globalThis.Deno=oldDeno;globalThis.fetch=oldFetch;globalThis.__commissionCreateClient=oldClient}
});
