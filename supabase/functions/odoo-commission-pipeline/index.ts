// D22 — owner-only Odoo quotation pipeline; read-only, no Odoo writes or invoice/payment claims.
import {createClient} from 'npm:@supabase/supabase-js@2';
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
function kinoRate(tier:string,marginRatio:number){
 if(marginRatio<=0)return tier==='A'?0.2:0.22254;
 if(tier==='B')return marginRatio>=1?0.3:0.22254+marginRatio*(0.3-0.22254);
 if(marginRatio>=0.8)return 0.3;
 if(marginRatio<=0.15)return 0.2+marginRatio/0.15*(0.2321-0.2);
 return 0.2321+(marginRatio-0.15)/0.65*(0.3-0.2321);
}
const round2=(n:number)=>Math.round((n+Number.EPSILON)*100)/100;
Deno.serve(async req=>{
 const origin=req.headers.get('origin');
 if(origin&&origin!==ORIGIN)return answer(req,{ok:false,error:'origin_not_allowed'},403);
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers:head(req)});
 if(req.method!=='GET')return answer(req,{ok:false,error:'method_not_allowed'},405);
 if(new URL(req.url).search)return answer(req,{ok:false,error:'unsupported_query'},400);
 const jwt=req.headers.get('authorization')?.match(/^Bearer\s+([^\s]+)$/i)?.[1];
 if(!jwt)return answer(req,{ok:false,error:'authentication_required'},401);
 let keys:Record<string,string>={};try{keys=JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS')||'{}')}catch{}
 const base=Deno.env.get('SUPABASE_URL')||'',service=keys.default||Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
 if(!base||!service)return answer(req,{ok:false,error:'not_configured'},503);
 try{
  const sb=createClient(base,service,{auth:{autoRefreshToken:false,persistSession:false}});
  const {data:au,error:authError}=await sb.auth.getUser(jwt);
  const user=au?.user;
  if(authError||!user?.email||!user.email_confirmed_at)return answer(req,{ok:false,error:'invalid_session'},401);
  const {data:acl,error:ae}=await sb.from('app_access_users').select('role,is_active')
   .eq('email',user.email.toLowerCase()).maybeSingle();
  if(ae||!acl?.is_active||acl.role!=='owner')return answer(req,{ok:false,error:'owner_only'},403);
  const hostRaw=Deno.env.get('ODOO_URL')||'',db=Deno.env.get('ODOO_DB')||'',
   login=Deno.env.get('ODOO_USERNAME')||'',apiKey=Deno.env.get('ODOO_API_KEY')||'';
  let url:URL;try{url=new URL(hostRaw)}catch{throw safe('odoo_not_configured',503)}
  if(url.protocol!=='https:'||url.hostname!=='weneedweed.odoo.com'||url.username||
    url.password||url.search||url.hash||url.port||!db||!login||!apiKey)
   throw safe('odoo_not_configured',503);
  const host=url.origin;
  const uid=await rpc(host,db,0,apiKey,'common','authenticate',[db,login,apiKey,{}]);
  if(!Number.isSafeInteger(uid)||uid<=0||
   (Deno.env.get('ODOO_UID_PIN')&&String(uid)!==Deno.env.get('ODOO_UID_PIN')))
   throw safe('odoo_auth_failed',503);
  const today=new Date(),from=new Date(today.getTime()-365*86400000).toISOString().slice(0,10);
  const standard=['id','name','date_order','state','invoice_status','partner_id','user_id',
   'company_id','amount_untaxed','currency_id'];
  const open=await pages(host,db,uid,apiKey,'sale.order',
   [['user_id','=',uid],['state','in',['draft','sent']]],standard,300);
  const closed=await pages(host,db,uid,apiKey,'sale.order',
   [['user_id','=',uid],['state','in',['sale','done']],['date_order','>=',from+' 00:00:00']],
   standard,650);
  const all=[...open,...closed].filter(o=>COMPANY[name(o.company_id)]);
  const ids=all.map(o=>o.id);
  if(ids.some(x=>!Number.isSafeInteger(x)||x<=0)||new Set(ids).size!==ids.length)
   throw safe('odoo_order_identity_mismatch',409);
  const lines=ids.length?await pages(host,db,uid,apiKey,'sale.order.line',
   [['order_id','in',ids]],
   ['id','order_id','product_id','name','product_uom_qty','price_unit','price_subtotal',
    'discount','display_type','product_uom'],2200):[];
  const pids=[...new Set(lines.map(l=>rel(l.product_id)).filter(x=>x!==null))] as number[];
  if(pids.length>600)throw safe('odoo_scope_too_large',413);
  const pmap=new Map<number,Record<string,unknown>>();
  for(let i=0;i<pids.length;i+=100){
   const group=pids.slice(i,i+100);
   const data=await rpc(host,db,uid,apiKey,'object','execute_kw',
    [db,uid,apiKey,'product.product','search_read',[[['id','in',group]]],
     {fields:['id','default_code','name'],limit:group.length+1}]);
   if(!Array.isArray(data)||data.length>group.length)throw safe('odoo_invalid_response');
   for(const item of data){if(pmap.has(item.id))throw safe('odoo_invalid_response');pmap.set(item.id,item)}
  }
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
  // Recheck seller, order state AND invoicing indicator after reading SKU and catalog.
  for(let i=0;i<ids.length;i+=100){
   const group=ids.slice(i,i+100),current=await rpc(host,db,uid,apiKey,'object','execute_kw',
    [db,uid,apiKey,'sale.order','search_read',
     [[['id','in',group],['user_id','=',uid]]],
     {fields:['id','state','invoice_status'],limit:group.length+1}]);
   if(!Array.isArray(current)||current.length!==group.length)throw safe('odoo_state_changed',409);
   const byId=new Map(current.map(o=>[o.id,o]));
   for(const id of group){
    const before=all.find(o=>o.id===id),after=byId.get(id);
    if(!before||!after||before.state!==after.state||before.invoice_status!==after.invoice_status)
     throw safe('odoo_state_changed',409);
   }
  }
  const orders=all.map(o=>{
   const company=COMPANY[name(o.company_id)],state=txt(o.state),
    invoiceStatus=txt(o.invoice_status),status=state==='draft'||state==='sent'?'en_cours':
     invoiceStatus==='invoiced'?'facture':'confirme';
   const items=lineMap.get(o.id)||[];
   let sumCommission=0,matched=0,unmatched=0;
   const presented=items.map(l=>{
    const product=pmap.get(rel(l.product_id)??-1),sku=txt(product?.default_code).trim(),
     qty=Number(l.product_uom_qty),price=Number(l.price_unit),discount=Number(l.discount),
     sub=Number(l.price_subtotal),k=company+'|'+sku.toUpperCase(),matchedRow=catalog.get(k);
    let reason='not_eligible',est:null|number=null;
    const billable=!l.display_type&&Number.isFinite(qty)&&qty>0&&
      Number.isFinite(sub)&&sub>0&&
     !/sample|samples|échantillon|échantillons|delivery|shipping|livraison|transport/i.test(
       txt(product?.name)+' '+txt(l.name));
    if(billable){
     reason='missing_kino_match';unmatched++;
     const expected=qty*price*(1-discount/100);
     if(!sku)reason='missing_odoo_sku';
     else if(!catalogAvailable)reason='catalog_unavailable';
     else if(dupes.has(k))reason='ambiguous_sku';
     else if(!matchedRow)reason='missing_kino_match';
     else if(!['A','B'].includes(txt(matchedRow.tier)))reason='invalid_kino_tier';
     else if(!Number.isFinite(Number(matchedRow.cost_eur))||Number(matchedRow.cost_eur)<=0)
      reason='missing_kino_cost';
     else if(!Number.isFinite(expected)||Math.abs(expected-sub)>0.04)reason='line_price_mismatch';
     else if(!Number.isFinite(qty)||qty<=0)reason='invalid_quantity';
     else {
      const cost=Number(matchedRow.cost_eur),tier=txt(matchedRow.tier),
       marginUnit=sub/qty-cost*(tier==='A'?1.25:1.15),
       margin=marginUnit*qty,rate=marginUnit>0?kinoRate(tier,marginUnit/cost):0;
      est=round2(Math.max(0,margin)*rate);
      if(Number.isFinite(est)){reason='estimated_units_unverified';matched++;unmatched--;sumCommission+=est}
      else{est=null;reason='invalid_calculation'}
     }
    }
    return {line_id:l.id,sku,product:txt(product?.name)||txt(l.name).slice(0,160),
     quantity:Number.isFinite(qty)?qty:null,unit: name(l.product_uom),
     subtotal_ht:Number.isFinite(sub)?sub:null,
     commission_estimate:est,reason};
   });
   const currency=name(o.currency_id);
   return {id:o.id,reference:txt(o.name).slice(0,100),date:txt(o.date_order).slice(0,19),
    company,client:name(o.partner_id).slice(0,140),state,invoice_status:invoiceStatus,
    stage:status,currency,amount_ht:typeof o.amount_untaxed==='number'&&Number.isFinite(o.amount_untaxed)?
      o.amount_untaxed:null,
    forecast:matched>0&&currency==='EUR'?round2(sumCommission):null,
    matched_lines:matched,unmatched_lines:unmatched,lines:presented};
  });
  orders.sort((a,b)=>b.date.localeCompare(a.date)||b.id-a.id);
  return answer(req,{ok:true,data:{version:'odoo_commission_pipeline_v1',
   read_at:new Date().toISOString(),closed_window_from:from,pending_scope:'all_pending_seller_orders',
   invoicing_semantics:'sale.order.invoice_status_not_payment_status',
   formula:'kino_browser_formula_provisional_without_spiff_units_unverified',
   catalog_snapshot_at:snapshot?.source_completed_at||null,
   orders,scope:'owner_odoo_salesperson_read_only_states_and_invoice_status_rechecked'}});
 }catch(e){
  const err=e instanceof Error?e.message:'odoo_pipeline_unavailable';
  const known=['odoo_unreachable','odoo_http_error','odoo_remote_error','odoo_invalid_response',
   'odoo_response_too_large','odoo_scope_too_large','odoo_order_identity_mismatch',
   'odoo_state_changed','odoo_not_configured','odoo_auth_failed'];
  const code=known.includes(err)?err:'odoo_pipeline_unavailable';
  return answer(req,{ok:false,error:code},
   code==='odoo_state_changed'||code==='odoo_order_identity_mismatch'?409:
    code==='odoo_scope_too_large'||code==='odoo_response_too_large'?413:503);
 }
});
