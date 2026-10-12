// Authenticated monthly accounting evidence and provisional reversal estimates. Read only.
import {createClient} from 'npm:@supabase/supabase-js@2.58.0';
import {parseCreditMonth,readMonthlyCredits,CREDIT_LINE_FIELDS,SALE_LINE_FIELDS} from './core.mjs';
const ORIGIN='https://bradrien.github.io';
const head=(req:Request)=>({'content-type':'application/json; charset=utf-8','cache-control':'no-store','vary':'origin',
 'x-content-type-options':'nosniff',...(req.headers.get('origin')===ORIGIN?{'access-control-allow-origin':ORIGIN}:{}),
 'access-control-allow-headers':'authorization,apikey,content-type,x-client-info','access-control-allow-methods':'GET,OPTIONS'});
const answer=(req:Request,body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:head(req)});
async function rpc(host:string,args:unknown[],service='object',method='execute_kw'){
 let response:Response;
 try{response=await fetch(host+'/jsonrpc',{method:'POST',redirect:'error',headers:{'content-type':'application/json'},
  signal:AbortSignal.timeout(15000),body:JSON.stringify({jsonrpc:'2.0',id:1,method:'call',params:{service,method,args}})})}
 catch{throw Error('odoo_unreachable')}
 if(!response.ok)throw Error('odoo_http_error');
 if(Number(response.headers.get('content-length')||0)>1000000)throw Error('odoo_response_too_large');
 const raw=await response.text();if(raw.length>1000000)throw Error('odoo_response_too_large');
 let body;try{body=JSON.parse(raw)}catch{throw Error('odoo_invalid_response')}
 if(body.error)throw Error('odoo_credit_read_refused');
 if(!Object.hasOwn(body,'result'))throw Error('odoo_invalid_response');return body.result;
}
Deno.serve(async(req:Request)=>{
 const origin=req.headers.get('origin');if(origin&&origin!==ORIGIN)return answer(req,{ok:false,error:'origin_not_allowed'},403);
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers:head(req)});
 if(req.method!=='GET')return answer(req,{ok:false,error:'method_not_allowed'},405);
 let period:{month:string,from:string,to:string};try{period=parseCreditMonth(req.url)}catch{return answer(req,{ok:false,error:'invalid_month'},400)}
 const jwt=req.headers.get('authorization')?.match(/^Bearer\s+([^\s]+)$/i)?.[1];
 if(!jwt)return answer(req,{ok:false,error:'authentication_required'},401);
 let phase='owner_auth';
 try{
  let keys:Record<string,string>={};try{keys=JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS')||'{}')}catch{}
  const base=Deno.env.get('SUPABASE_URL')||'',service=keys.default||Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
  if(!base||!service)throw Error('not_configured');
  const sb=createClient(base,service,{auth:{autoRefreshToken:false,persistSession:false}});
  const {data:auth,error:ae}=await sb.auth.getUser(jwt),user=auth?.user;
  if(ae||!user?.email||!user.email_confirmed_at||user.is_anonymous===true)return answer(req,{ok:false,error:'invalid_session'},401);
  const {data:acl,error:ce}=await sb.from('app_access_users').select('role,is_active').eq('email',user.email.toLowerCase()).maybeSingle();
  if(ce||!acl?.is_active||acl.role!=='owner')return answer(req,{ok:false,error:'owner_only'},403);
  phase='odoo_auth';
  const db=Deno.env.get('ODOO_DB')||'',login=Deno.env.get('ODOO_USERNAME')||'',key=Deno.env.get('ODOO_API_KEY')||'';
  let url:URL;try{url=new URL(Deno.env.get('ODOO_URL')||'')}catch{throw Error('odoo_not_configured')}
  if(url.protocol!=='https:'||url.hostname!=='weneedweed.odoo.com'||url.port||url.username||url.password||url.search||url.hash||!db||!login||!key)
   throw Error('odoo_not_configured');
  const host=url.origin,uid=await rpc(host,[db,login,key,{}],'common','authenticate');
  if(!Number.isSafeInteger(uid)||uid<1||Deno.env.get('ODOO_UID_PIN')&&String(uid)!==Deno.env.get('ODOO_UID_PIN'))throw Error('odoo_auth_failed');
  const read=async(model:string,domain:unknown[],fields:string[],limit:number)=>{
   if(!['res.company','account.move','account.move.line','sale.order','sale.order.line','product.product'].includes(model)||
    !Number.isSafeInteger(limit)||limit<1||limit>401||fields.length>24)throw Error('credit_scope_limit');
   const result=await rpc(host,[db,uid,key,model,'search_read',[domain],{fields,limit,order:'id asc',
    ...(model==='product.product'?{context:{active_test:false}}:{})}]);
   if(!Array.isArray(result)||result.length>limit)throw Error('odoo_invalid_response');return result;
  };
  phase='odoo_schema';
  const unitField=async(model:string,required:readonly string[])=>{
   const candidates=['product_uom_id','product_uom'];
   const result=await rpc(host,[db,uid,key,model,'fields_get',[[...required,...candidates]],{attributes:['type']}]);
   if(!result||typeof result!=='object'||Array.isArray(result)||required.some(k=>!result[k]))throw Error('odoo_schema_unavailable');
   return candidates.find(k=>result[k]?.type==='many2one')||null;
  };
  const invoiceUnitField=await unitField('account.move.line',CREDIT_LINE_FIELDS);
  const saleUnitField=await unitField('sale.order.line',SALE_LINE_FIELDS);
  phase='catalog_read';
  const {data:snapshot,error:se}=await sb.from('kino_catalog_snapshots').select('id,source_completed_at,item_count')
   .eq('status','complete').order('source_completed_at',{ascending:false}).limit(1).maybeSingle();
  const catalog=new Map(),duplicates=new Set();let catalogAvailable=false;
  if(!se&&snapshot&&Number.isSafeInteger(snapshot.item_count)&&snapshot.item_count>0&&snapshot.item_count<=1600){
   const rows=[];
   for(let offset=0;offset<snapshot.item_count;offset+=400){
    const {data,error}=await sb.from('kino_catalog_products').select('company,sku,product_name,tier,cost_eur,list_price_eur')
     .eq('snapshot_id',snapshot.id).order('row_index').range(offset,Math.min(snapshot.item_count-1,offset+399));
    if(error||!Array.isArray(data)){rows.length=0;break}rows.push(...data);
   }
   if(rows.length===snapshot.item_count){
    catalogAvailable=true;
    for(const r of rows){const k=String(r.company)+'|'+String(r.sku).trim().toUpperCase();if(catalog.has(k))duplicates.add(k);else catalog.set(k,r)}
   }
  }
  phase='credits_reconciliation';
  const data=await readMonthlyCredits(period,{uid,read,catalog,catalogAvailable,duplicates,
   catalogSnapshotAt:snapshot?.source_completed_at||null,invoiceUnitField,saleUnitField});
  return answer(req,{ok:true,data});
 }catch(error){
  const msg=error instanceof Error?error.message:'credit_evidence_unavailable';
  const allowed=['not_configured','odoo_not_configured','odoo_auth_failed','odoo_unreachable','odoo_http_error','odoo_response_too_large',
   'odoo_invalid_response','odoo_credit_read_refused','odoo_schema_unavailable','credit_scope_limit','credit_scope_mismatch','odoo_source_changed'];
  const code=allowed.includes(msg)?msg:'credit_evidence_unavailable';console.error('monthly_credit_read_failed',JSON.stringify({phase,code}));
  return answer(req,{ok:false,error:code,stage:phase},code==='odoo_source_changed'?409:code==='credit_scope_limit'?413:503);
 }
});
