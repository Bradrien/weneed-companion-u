// WeNeed Companion — commission review gateway.
// Read-only: no payout formula until Kino is verified, no persistence or side effects.
import {createClient} from 'npm:@supabase/supabase-js@2';

let keys={};try{keys=JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS')||'{}')}catch{}
const base=Deno.env.get('SUPABASE_URL');
const secret=keys.default||Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const supa=base&&secret?createClient(base,secret,{auth:{autoRefreshToken:false,persistSession:false}}):null;
const env={url:Deno.env.get('ODOO_URL')||'',db:Deno.env.get('ODOO_DB')||'',
 login:Deno.env.get('ODOO_USERNAME')||'',pass:Deno.env.get('ODOO_API_KEY')||'',
 origin:Deno.env.get('ODOO_ALLOWED_ORIGIN')||''};

class SafeError extends Error {constructor(code,status=502){super(code);this.status=status;}}
const n=(v)=>typeof v==='number'&&Number.isFinite(v)?v:null;
const txt=(v)=>typeof v==='string'?v:'';
const display=(v)=>Array.isArray(v)&&typeof v[1]==='string'?v[1]:'';
const id=(v)=>Array.isArray(v)&&Number.isSafeInteger(v[0])?v[0]:null;
const round=(v)=>Math.round((v+Number.EPSILON)*100)/100;
const co={'Global Trust Agriculture SA':'GTA','Trim Rocket s.r.o.':'TR'};
const dateOk=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&
  !Number.isNaN(Date.parse(s+'T00:00:00Z'))&&new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s;

function classify(l,p){
 if(l.display_type)return ['display','odoo_display_line'];
 const x=txt(p?.name||l.name)+' '+txt(p?.default_code);
 if(/\b(sample|samples|échantillon|échantillons)\b/i.test(x))return ['sample','sample_excluded_pending_policy'];
 if(/\b(shipping|delivery|livraison|transport|freight|port)\b/i.test(x))return ['shipping','shipping_excluded'];
 if([l.price_subtotal,l.price_unit,l.product_uom_qty,l.discount].some(x=>n(x)===null))
   return ['anomaly','missing_or_invalid_amount'];
 if(l.product_uom_qty<=0)return ['anomaly','non_positive_quantity'];
 if(l.price_subtotal<0)return ['anomaly','negative_subtotal_review'];
 if(l.price_subtotal===0)return ['free','zero_price_review'];
 if(!txt(p?.default_code))return ['review','missing_product_sku'];
 return ['candidate','kino_rules_unverified'];
}
async function rpc(cfg,service,method,args){
 let res;
 try {res=await fetch(cfg.url+'/jsonrpc',{method:'POST',redirect:'error',
  headers:{'content-type':'application/json'},signal:AbortSignal.timeout(12000),
  body:JSON.stringify({jsonrpc:'2.0',id:1,method:'call',params:{service,method,args}})});}
 catch{throw new SafeError('odoo_unreachable')}
 if(!res?.ok)throw new SafeError('odoo_http_error');
 const len=Number(res.headers.get('content-length')||0);
 if(len>1048576)throw new SafeError('odoo_response_too_large');
 let raw;try{raw=await res.text();if(raw.length>1048576)throw Error();const json=JSON.parse(raw);
 if(json.error)throw new SafeError('odoo_remote_error');
 if(!Object.hasOwn(json,'result'))throw Error();return json.result;}
 catch(e){if(e instanceof SafeError)throw e;throw new SafeError('invalid_odoo_response');}
}
async function readPages(cfg,uid,model,domain,fields,max){
 let records=[];while(true){
  const remaining=max-records.length;const limit=Math.min(100,remaining+1);
  const data=await rpc(cfg,'object','execute_kw',[cfg.db,uid,cfg.pass,model,'search_read',[domain],
      {fields,limit,offset:records.length,order:'id asc'}]);
  if(!Array.isArray(data)||data.length>limit||data.some(x=>!x||typeof x!=='object'||Array.isArray(x)))
    throw new SafeError('invalid_odoo_response');
  if(data.length>remaining)throw new SafeError('source_record_limit_exceeded',413);
  records.push(...data);
  if(data.length<limit)break;
  if(records.length===max){
   const extra=await rpc(cfg,'object','execute_kw',[cfg.db,uid,cfg.pass,model,'search_read',[domain],
        {fields:['id'],limit:1,offset:records.length,order:'id asc'}]);
   if(!Array.isArray(extra))throw new SafeError('invalid_odoo_response');
   if(extra.length)throw new SafeError('source_record_limit_exceeded',413);
   break;
  }
 }
 return records;
}

/** Read one complete, immutable Kino catalogue snapshot. No client-supplied prices. */
async function loadCatalog(){
 if(!supa)throw new SafeError('catalog_unavailable',503);
 const {data:snapshot,error:se}=await supa.from('kino_catalog_snapshots')
  .select('id,source_completed_at,item_count,status')
  .eq('status','complete').order('source_completed_at',{ascending:false}).limit(1).maybeSingle();
 if(se||!snapshot||!Number.isSafeInteger(snapshot.item_count)||snapshot.item_count>1500)
  throw new SafeError('catalog_unavailable',503);
 const rows=[];
 for(let offset=0;offset<snapshot.item_count;offset+=400){
  const {data,error}=await supa.from('kino_catalog_products')
   .select('company,sku,product_name,tier,category,cost_eur,list_price_eur')
   .eq('snapshot_id',snapshot.id).order('row_index',{ascending:true})
   .range(offset,Math.min(offset+399,snapshot.item_count-1));
  if(error||!Array.isArray(data))throw new SafeError('catalog_unavailable',503);
  rows.push(...data);
 }
 if(rows.length!==snapshot.item_count)throw new SafeError('catalog_incomplete',503);
 const byKey=new Map();
 const duplicates=new Set();
 for(const row of rows){
  const company=txt(row.company).trim(),sku=txt(row.sku).trim().toUpperCase();
  if(!['GTA','TR'].includes(company)||!sku)throw new SafeError('catalog_invalid',503);
  const k=company+'\u0000'+sku;
  if(byKey.has(k))duplicates.add(k);
  else byKey.set(k,row);
 }
 return {snapshot:{id:snapshot.id,source_completed_at:snapshot.source_completed_at,
    products_total:snapshot.item_count},byKey,duplicates};
}
function matchProduct(company,sku,kind,confirmed,catalog){
 if(!confirmed||!['candidate','review'].includes(kind))
  return {status:'not_applicable'};
 const code=txt(sku).trim().toUpperCase();
 if(!code)return {status:'missing_sku'};
 const key=company+'\u0000'+code;
 if(catalog.duplicates.has(key))return {status:'ambiguous_sku'};
 const r=catalog.byKey.get(key);
 if(!r)return {status:'not_found'};
 const cost=Number(r.cost_eur),price=Number(r.list_price_eur);
 if(!Number.isFinite(cost)||cost<0||!Number.isFinite(price)||price<0)
  return {status:'catalog_invalid_price'};
 return {status:'matched',catalog_name:txt(r.product_name),tier:txt(r.tier),
   category:txt(r.category),cost_eur:cost,list_price_eur:price,
   cost_zero:cost===0,price_zero:price===0};
}

/**
 * Read-only suggestion from an exact [SKU] prefix on the product name.
 * It must not turn the missing Odoo SKU into an official matched line.
 */
function candidateFromDescription(company,productName,catalog){
 const hit=txt(productName).match(/^\s*\[([A-Za-z0-9_+./-]{2,40})\]/);
 if(!hit)return null;
 const sku=hit[1].toUpperCase();
 const k=company+'\u0000'+sku;
 if(catalog.duplicates.has(k))return {sku,status:'ambiguous'};
 const row=catalog.byKey.get(k);
 if(!row)return {sku,status:'not_found'};
 return {sku,status:'found',catalog_name:txt(row.product_name),
  category:txt(row.category),tier:txt(row.tier)};
}

async function review(from,to){
 const catalog=await loadCatalog();
 if(!env.url||!env.db||!env.login||!env.pass)throw new SafeError('odoo_not_configured',503);
 let url;try{url=new URL(env.url)}catch{throw new SafeError('invalid_odoo_configuration',503)}
 if(url.protocol!=='https:'||url.hostname!=='weneedweed.odoo.com'||url.username||url.password||
 url.search||url.hash||url.port)throw new SafeError('invalid_odoo_configuration',503);
 const cfg={url:url.href.replace(/\/+$/,''),db:env.db,login:env.login,pass:env.pass};
 const uid=await rpc(cfg,'common','authenticate',[cfg.db,cfg.login,cfg.pass,{}]);
 const pin=Deno.env.get('ODOO_UID_PIN')||'';
 const credentialsAccepted=Number.isSafeInteger(uid)&&uid>0;
 const pinMismatch=credentialsAccepted&&Boolean(pin)&&String(uid)!==pin;
 if(!credentialsAccepted||pinMismatch){
  // Diagnostic only: never log user IDs, passwords, API keys or request details.
  console.error('commission_odoo_auth_reason',JSON.stringify({
    reason:pinMismatch?'uid_pin_mismatch':'credentials_rejected'
  }));
  throw new SafeError('odoo_auth_failed');
 }
 const orders=await readPages(cfg,uid,'sale.order',[
  ['date_order','>=',from+' 00:00:00'],['date_order','<=',to+' 23:59:59'],['user_id','=',uid]],
  ['id','name','date_order','state','partner_id','user_id','company_id','amount_untaxed','currency_id'],250);
 const ids=orders.map(o=>o.id);
 if(ids.some(x=>!Number.isSafeInteger(x)||x<=0)||new Set(ids).size!==ids.length)
  throw new SafeError('invalid_odoo_response');
 let lines=[];if(ids.length){
  lines=await readPages(cfg,uid,'sale.order.line',[['order_id','in',ids]],
   ['id','name','order_id','product_id','product_uom_qty','price_unit','discount','price_subtotal','display_type'],1500);
 }
 const lineMap=new Map(ids.map(k=>[k,[]]));
 for(const line of lines){
  const key=id(line.order_id);if(!lineMap.has(key))throw new SafeError('unmatched_order_line');
  lineMap.get(key).push(line);
 }
 const pids=[...new Set(lines.map(l=>id(l.product_id)).filter(x=>x>0))];
 if(pids.length>500)throw new SafeError('source_record_limit_exceeded',413);
 const prods=new Map();
 for(let i=0;i<pids.length;i+=100){
  const slice=pids.slice(i,i+100);
  const result=await rpc(cfg,'object','execute_kw',[cfg.db,uid,cfg.pass,'product.product',
    'search_read',[[['id','in',slice]]],{fields:['id','name','default_code'],limit:slice.length,order:'id asc'}]);
  if(!Array.isArray(result)||result.length>slice.length)throw new SafeError('invalid_odoo_response');
  for(const p of result)prods.set(p.id,p);
 }
 const counts={GTA:{sale:0,done:0,cancel:0,draft:0,other:0},
               TR:{sale:0,done:0,cancel:0,draft:0,other:0}};
 const flags={candidate:0,sample:0,shipping:0,free:0,review:0,anomaly:0,display:0};
 let gross=0;
 const grossCurrencies=new Set();
 const report=[];
 const matching={eligible:0,matched:0,not_found:0,missing_sku:0,ambiguous_sku:0,
   catalog_invalid_price:0,zero_cost:0,zero_list_price:0};
 for(const order of orders){
  const company=co[display(order.company_id)];if(!company)continue;
  const state=txt(order.state);const confirmed=state==='sale'||state==='done';
  counts[company][Object.hasOwn(counts[company],state)?state:'other']++;
  if(confirmed&&n(order.amount_untaxed)!==null){gross+=order.amount_untaxed;grossCurrencies.add(display(order.currency_id)||'unknown');}
  const items=[];let sum=0,complete=true;const warnings=[];
  for(const line of lineMap.get(order.id)||[]){
   const pid=id(line.product_id);const product=prods.get(pid);
   const [kind,reason]=classify(line,product);
   flags[kind]++;
   const catalog_match=matchProduct(company,txt(product?.default_code),kind,confirmed,catalog);
   if(catalog_match.status==='missing_sku'){
    const candidate=candidateFromDescription(company,txt(product?.name||line.name),catalog);
    if(candidate)catalog_match.candidate=candidate;
   }
   if(catalog_match.status!=='not_applicable'){
     matching.eligible++;
     if(Object.hasOwn(matching,catalog_match.status))matching[catalog_match.status]++;
     if(catalog_match.status==='matched'){
       if(catalog_match.cost_zero)matching.zero_cost++;
       if(catalog_match.price_zero)matching.zero_list_price++;
     }
   }
   const amt=n(line.price_subtotal);if(amt===null&&!line.display_type)complete=false;
   else sum+=amt||0;
   items.push({id:line.id,sku:txt(product?.default_code),product_name:txt(product?.name||line.name),
    quantity:n(line.product_uom_qty),unit_price:n(line.price_unit),
    discount_pct:n(line.discount),line_ht:amt,kind,
    reason:confirmed?reason:'order_not_confirmed',catalog_match,commission_eur:null});
  }
  const source=n(order.amount_untaxed);
  const gap=complete&&source!==null?round(source-round(sum)):null;
  if(!confirmed)warnings.push('unconfirmed_or_cancelled');
  if(confirmed&&source===0)warnings.push('confirmed_zero_ht_review');
  if(confirmed&&!display(order.partner_id))warnings.push('missing_client');
  if(gap===null)warnings.push('incomplete_source_amount');
  else if(Math.abs(gap)>0.02)warnings.push('lines_total_mismatch');
  if(items.some(x=>x.kind==='review'||x.kind==='anomaly'||x.kind==='free'))
    warnings.push('manual_line_review');
  if(items.some(x=>x.kind==='sample'))warnings.push('sample_policy_to_confirm');
  if(items.some(x=>['missing_sku','not_found','ambiguous_sku','catalog_invalid_price'].includes(x.catalog_match.status)))
    warnings.push('catalog_match_review');
  if(items.some(x=>x.catalog_match.status==='matched'&&(x.catalog_match.cost_zero||x.catalog_match.price_zero)))
    warnings.push('catalog_zero_price_review');
  report.push({id:order.id,reference:txt(order.name),date:txt(order.date_order),
    company,client:display(order.partner_id),salesperson:display(order.user_id),state,
    currency:display(order.currency_id)||null,
    amount_ht:source,line_sum_ht:complete?round(sum):null,amount_difference:gap,
    issues:warnings,lines:items,commission_eur:null,commission_status:'kino_rules_pending'});
 }
 return {period_from:from,period_to:to,source:'odoo_live_read_only',persisted:false,
  orders_count:report.length,source_order_count:orders.length,company_counts:counts,
  catalog_snapshot:catalog.snapshot,catalog_matching:matching,
  line_kinds:flags,confirmed_sales_ht_source_only:grossCurrencies.size===1?round(gross):null,
  confirmed_sales_currency:grossCurrencies.size===1?[...grossCurrencies][0]:null,
  verified_commissions_eur:null,commissions_are_calculated:false,
  warnings:['Kino rules have not been verified: NO commission calculation',
   'Source order totals are not commissions owed',
   'All orders filtered to authenticated Odoo salesperson',
   ...(prods.size<pids.length?['Missing product SKU mappings require review']:[]),
   ...(grossCurrencies.size>1?['Mixed source currencies: gross total disabled']:[]),
   ...(matching.not_found>0?['Some confirmed Odoo SKUs are absent from the Kino catalog']:[]),
   ...(matching.missing_sku>0?['Some confirmed products lack an Odoo SKU']:[]),
   ...(matching.zero_cost>0||matching.zero_list_price>0?['Matched Kino products include zero catalogue prices or costs']:[])],
  orders:report};
}
const baseHeaders={'content-type':'application/json; charset=utf-8','cache-control':'no-store',
  'x-content-type-options':'nosniff','vary':'Origin'};
Deno.serve(async(req)=>{
 const origin=req.headers.get('origin')||'';
 const trustedOrigin = origin === 'https://bradrien.github.io' || (Boolean(env.origin) && origin === env.origin);
 const cors=origin && trustedOrigin?
   {'access-control-allow-origin':origin,
    'access-control-allow-headers':'authorization,apikey,content-type,x-client-info',
    'access-control-allow-methods':'GET,OPTIONS'}:{};
 const headers={...baseHeaders,...cors};
 const error=(status,msg)=>new Response(JSON.stringify({ok:false,error:msg}),{status,headers});
 if(req.method==='OPTIONS')return Object.keys(cors).length?
   new Response(null,{status:204,headers}):error(403,'origin_not_allowed');
 if(req.method!=='GET')return error(405,'method_not_allowed');
 if(origin && !Object.keys(cors).length)return error(403,'origin_not_allowed');
 const token=req.headers.get('authorization')?.match(/^Bearer\s+([^\s]+)$/i)?.[1];
 if(!token||!supa)return error(401,'authentication_required');
 try{
  const {data:who,error:aErr}=await supa.auth.getUser(token);
  if(aErr||!who.user?.email||!who.user.email_confirmed_at)return error(403,'owner_only');
  const {data:access,error:aclErr}=await supa.from('app_access_users').select('role,is_active')
   .eq('email',who.user.email.toLowerCase()).maybeSingle();
  if(aclErr||access?.role!=='owner'||access?.is_active!==true)return error(403,'owner_only');
  const u=new URL(req.url);
  for(const key of u.searchParams.keys())
   if(!['from','to'].includes(key)||u.searchParams.getAll(key).length!==1)
     return error(400,'invalid_query');
  const from=u.searchParams.get('from'),to=u.searchParams.get('to');
  if(!dateOk(from)||!dateOk(to)||from>to||
      Date.parse(to+'T00:00:00Z')-Date.parse(from+'T00:00:00Z')>93*86400000)
      return error(400,'invalid_period');
  const result=await review(from,to);
  return new Response(JSON.stringify({ok:true,data:result}),{status:200,headers});
 }catch(e){
  const code=e instanceof SafeError?e.message:'review_unavailable';
  const status=e instanceof SafeError?e.status:502;
  // Only a bounded diagnostic code/status is logged: never tokens, emails,
  // order content, credentials, or full exception details.
  console.error('commission_catalog_review_failed',JSON.stringify({code,status}));
  return error(status,code);
 }
});