// D30 / revision 7 — read-only catalogue evidence for unresolved source lines.
import {createClient} from 'npm:@supabase/supabase-js@2.58.0';
import {assertUnchangedRows,calculateOdooOrder,PIPELINE_UNCERTAINTIES} from './core.mjs';
import {parseOdooPeriod,odooPeriodDomain} from './scope.mjs';
const ORIGIN='https://bradrien.github.io';
const COMPANY={'Global Trust Agriculture SA':'GTA','Trim Rocket s.r.o.':'TR'} as Record<string,string>;
const txt=(x:unknown)=>typeof x==='string'?x:'';
const rel=(x:unknown)=>Array.isArray(x)&&Number.isSafeInteger(x[0])&&x[0]>0?x[0]:null;
const name=(x:unknown)=>Array.isArray(x)&&typeof x[1]==='string'?x[1]:'';
const safe=(code:string,status=502)=>Object.assign(new Error(code),{status});
function head(r:Request){
 const o=r.headers.get('origin');
 return {'content-type':'application/json; charset=utf-8','cache-control':'no-store','vary':'origin',
  'x-content-type-options':'nosniff',...(o===ORIGIN?{'access-control-allow-origin':ORIGIN}:{}) ,
  'access-control-allow-headers':'authorization,apikey,content-type,x-client-info',
  'access-control-allow-methods':'GET,OPTIONS'};
}
function answer(r:Request,data:unknown,status=200){return new Response(JSON.stringify(data),{status,headers:head(r)})}
async function rpc(host:string,db:string,uid:number,apiKey:string,svc:string,method:string,args:unknown[]){
 let resp:Response;try{resp=await fetch(host+'/jsonrpc',{method:'POST',redirect:'error',
 headers:{'content-type':'application/json'},signal:AbortSignal.timeout(15000),
 body:JSON.stringify({jsonrpc:'2.0',id:1,method:'call',params:{service:svc,method,args}})})}
 catch{throw safe('odoo_unreachable',503)}
 if(!resp.ok)throw safe('odoo_http_error');
 if(Number(resp.headers.get('content-length')||0)>1_900_000)throw safe('odoo_response_too_large',413);
 let raw;try{raw=await resp.text();if(raw.length>1_900_000)throw Error('too_large')}
 catch{throw safe('odoo_response_too_large',413)}
 let j;try{j=JSON.parse(raw)}catch{throw safe('odoo_invalid_response')}
 if(j.error)throw safe('odoo_remote_error');if(!Object.hasOwn(j,'result'))throw safe('odoo_invalid_response');
 return j.result;
}
async function pages(h:string,db:string,uid:number,key:string,model:string,domain:unknown[],fields:string[],max:number){
 const out:Record<string,unknown>[]=[];
 while(true){
  const limit=Math.min(100,max+1-out.length);
  if(limit<=0)throw safe('odoo_scope_too_large',413);
  const part=await rpc(h,db,uid,key,'object','execute_kw',
   [db,uid,key,model,'search_read',[domain],{fields,limit,offset:out.length,order:'id asc'}]);
  if(!Array.isArray(part)||part.length>limit||part.some(x=>!x||typeof x!=='object'||Array.isArray(x)))
    throw safe('odoo_invalid_response');
  if(part.length>max-out.length)throw safe('odoo_scope_too_large',413);
  out.push(...part);
  if(part.length<limit)break;
  if(out.length===max){
   const more=await rpc(h,db,uid,key,'object','execute_kw',
    [db,uid,key,model,'search_read',[domain],{fields:['id'],limit:1,offset:out.length}]);
   if(!Array.isArray(more)||more.length)throw safe('odoo_scope_too_large',413);
   break;
  }
 }
 return out;
}
Deno.serve(async req=>{
 const origin=req.headers.get('origin');
 if(origin&&origin!==ORIGIN)return answer(req,{ok:false,error:'origin_not_allowed'},403);
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers:head(req)});
 if(req.method!=='GET')return answer(req,{ok:false,error:'method_not_allowed'},405);
 let period:{from:string,to:string};
 try{period=parseOdooPeriod(req.url)}catch(e){
  const code=e instanceof Error&&e.message==='invalid_period'?'invalid_period':'unsupported_query';
  return answer(req,{ok:false,error:code},400);
 }
 const jwt=req.headers.get('authorization')?.match(/^Bearer\s+([^\s]+)$/i)?.[1];
 if(!jwt)return answer(req,{ok:false,error:'authentication_required'},401);
 let keys:Record<string,string>={};try{keys=JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS')||'{}')}catch{}
 const base=Deno.env.get('SUPABASE_URL')||'',service=keys.default||Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
 if(!base||!service)return answer(req,{ok:false,error:'not_configured'},503);
 let phase='owner_auth';
 try{
  const sb=createClient(base,service,{auth:{autoRefreshToken:false,persistSession:false}});
  const {data:au,error:authError}=await sb.auth.getUser(jwt);
  const user=au?.user;
  if(authError||!user?.email||!user.email_confirmed_at)return answer(req,{ok:false,error:'invalid_session'},401);
  const {data:acl,error:ae}=await sb.from('app_access_users').select('role,is_active')
   .eq('email',user.email.toLowerCase()).maybeSingle();
  if(ae||!acl?.is_active||acl.role!=='owner')return answer(req,{ok:false,error:'owner_only'},403);
  phase='odoo_config';
  const hostRaw=Deno.env.get('ODOO_URL')||'',db=Deno.env.get('ODOO_DB')||'',
   login=Deno.env.get('ODOO_USERNAME')||'',apiKey=Deno.env.get('ODOO_API_KEY')||'';
  let url:URL;try{url=new URL(hostRaw)}catch{throw safe('odoo_not_configured',503)}
  if(url.protocol!=='https:'||url.hostname!=='weneedweed.odoo.com'||url.username||
    url.password||url.search||url.hash||url.port||!db||!login||!apiKey)
   throw safe('odoo_not_configured',503);
  const host=url.origin;
  phase='odoo_auth';
  const uid=await rpc(host,db,0,apiKey,'common','authenticate',[db,login,apiKey,{}]);
  if(!Number.isSafeInteger(uid)||uid<=0||
   (Deno.env.get('ODOO_UID_PIN')&&String(uid)!==Deno.env.get('ODOO_UID_PIN')))
   throw safe('odoo_auth_failed',503);
  const {from,to}=period;
  phase='orders_read';
  const standard=['id','name','date_order','state','invoice_status','partner_id','user_id',
   'company_id','amount_untaxed','currency_id','write_date'];
  const open=await pages(host,db,uid,apiKey,'sale.order',
   odooPeriodDomain(uid,['draft','sent'],period),standard,300);
  const closed=await pages(host,db,uid,apiKey,'sale.order',
   odooPeriodDomain(uid,['sale','done'],period),standard,400);
  const all=[...open,...closed].filter(o=>COMPANY[name(o.company_id)]);
  const ids=all.map(o=>o.id);
  if(ids.some(x=>!Number.isSafeInteger(x)||x<=0)||new Set(ids).size!==ids.length)
   throw safe('odoo_order_identity_mismatch',409);
  // Use the exact sale.order.line field set already proven by commission-catalog-review.
  // Some Odoo instances reject additional fields with an RPC error; repeated source
  // reads still compare all financial inputs and detect concurrent edits.
  const lineFields=['id','name','order_id','product_id','product_uom_qty','price_unit',
   'discount','price_subtotal','display_type'];
  const lineDomain=[['order_id','in',ids]];
  phase='lines_read';
  const lines=ids.length?await pages(host,db,uid,apiKey,'sale.order.line',
   lineDomain,lineFields,2400):[];
  assertUnchangedRows(lines,lines,lineFields,'odoo_order_identity_mismatch');
  const pids=[...new Set(lines.map(l=>rel(l.product_id)).filter(x=>x!==null))] as number[];
  if(pids.length>1000)throw safe('odoo_scope_too_large',413);
  const pmap=new Map<number,Record<string,unknown>>();
  phase='products_read';
  for(let i=0;i<pids.length;i+=100){
   const group=pids.slice(i,i+100);
   const data=await rpc(host,db,uid,apiKey,'object','execute_kw',
    [db,uid,apiKey,'product.product','search_read',[[['id','in',group]]],
     {fields:['id','default_code','name'],limit:group.length+1}]);
   if(!Array.isArray(data)||data.length>group.length)throw safe('odoo_invalid_response');
   for(const item of data){
    if(!item||!Number.isSafeInteger(item.id)||!group.includes(item.id)||pmap.has(item.id))
     throw safe('odoo_invalid_response');
    pmap.set(item.id,item);
   }
  }
  phase='catalog_read';
  const snapResp=await sb.from('kino_catalog_snapshots').select('id,source_completed_at,item_count')
   .eq('status','complete').order('source_completed_at',{ascending:false}).limit(1).maybeSingle();
  const snapshot=snapResp.data;
  const catalog=new Map<string,Record<string,unknown>>(),dupes=new Set<string>();
  let catalogAvailable=false;
  if(snapshot&&!snapResp.error&&snapshot.item_count<=1600&&snapshot.item_count>0){
   const result=[];
   for(let i=0;i<snapshot.item_count;i+=400){
    const {data,error}=await sb.from('kino_catalog_products')
     .select('company,sku,product_name,tier,cost_eur,list_price_eur')
     .eq('snapshot_id',snapshot.id).order('row_index').range(i,Math.min(snapshot.item_count-1,i+399));
    if(error||!data){result.length=0;break}
    result.push(...data);
   }
   if(result.length===snapshot.item_count){
    catalogAvailable=true;
    for(const item of result){
     const key=txt(item.company)+'|'+txt(item.sku).trim().toUpperCase();
     if(catalog.has(key))dupes.add(key);else catalog.set(key,item);
    }
   }
  }
  const lineMap=new Map<number,Record<string,unknown>[]>(ids.map(id=>[id,[]]));
  for(const line of lines){
   const orderId=rel(line.order_id);
   if(orderId===null||!lineMap.has(orderId))throw safe('odoo_order_identity_mismatch',409);
   lineMap.get(orderId)!.push(line);
  }
  // Re-read the same bounded line scope after catalogue/product reads. Detect edits,
  // additions, removals and reparenting; do not combine monetary facts from two reads.
  phase='lines_recheck';
  const linesAfter=ids.length?await pages(host,db,uid,apiKey,'sale.order.line',
   lineDomain,lineFields,2400):[];
  assertUnchangedRows(lines,linesAfter,lineFields,'odoo_source_changed');
  // Recheck seller, state, currency, order totals and customer/company identity last.
  // This detects changes during this read window; it is not a database transaction.
  phase='orders_recheck';
  for(let i=0;i<ids.length;i+=100){
   const group=ids.slice(i,i+100),current=await rpc(host,db,uid,apiKey,'object','execute_kw',
    [db,uid,apiKey,'sale.order','search_read',
     [[['id','in',group],['user_id','=',uid]]],
     {fields:standard,limit:group.length+1}]);
   if(!Array.isArray(current)||current.length!==group.length)throw safe('odoo_state_changed',409);
   assertUnchangedRows(all.filter(o=>group.includes(o.id)),current,standard,'odoo_source_changed');
  }
  phase='commission_calculation';
  const orders=all.map(o=>calculateOdooOrder(o,lineMap.get(o.id)||[],{
   company:COMPANY[name(o.company_id)],products:pmap,catalog,duplicates:dupes,catalogAvailable}));
  orders.sort((a,b)=>b.date.localeCompare(a.date)||b.id-a.id);
  return answer(req,{ok:true,data:{version:'odoo_commission_pipeline_v1',
   read_at:new Date().toISOString(),closed_window_from:from,pending_scope:'period_pending_seller_orders',
   period_from:from,period_to:to,
   invoicing_semantics:'sale.order.invoice_status_not_payment_status',
   formula:'kino_browser_formula_provisional_without_spiff_units_unverified',
   revision:7,source_lines_rechecked:true,source_amounts_rechecked:true,
   read_consistency:'two_read_windows_not_atomic_snapshot',
   calculation_guards:'signed_amounts_price_discount_subtotals_v1',
   uncertainties:PIPELINE_UNCERTAINTIES,
   catalog_snapshot_at:snapshot?.source_completed_at||null,
   orders,scope:'owner_odoo_salesperson_read_only_states_and_invoice_status_rechecked'}});
 }catch(e){
  const err=e instanceof Error?e.message:'odoo_pipeline_unavailable';
  const known=['odoo_unreachable','odoo_http_error','odoo_remote_error','odoo_invalid_response',
   'odoo_response_too_large','odoo_scope_too_large','odoo_order_identity_mismatch',
   'odoo_state_changed','odoo_source_changed','odoo_not_configured','odoo_auth_failed'];
  const code=known.includes(err)?err:'odoo_pipeline_unavailable';
  // Only bounded allowlisted phase and error code: no credentials, customer IDs or raw Odoo errors.
  console.error('odoo_commission_pipeline_failure',JSON.stringify({phase,code}));
  return answer(req,{ok:false,error:code,stage:phase},
   code==='odoo_state_changed'||code==='odoo_source_changed'||code==='odoo_order_identity_mismatch'?409:
    code==='odoo_scope_too_large'||code==='odoo_response_too_large'?413:503);
 }
});
