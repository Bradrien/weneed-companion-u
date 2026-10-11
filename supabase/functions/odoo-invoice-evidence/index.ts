// Owner-only, on-demand, bounded Odoo invoices. No writes or commission allocation.
import {createClient} from 'npm:@supabase/supabase-js@2.58.0';
import {parseInvoiceOrderId,readInvoiceEvidence} from './core.mjs';
const ORIGIN='https://bradrien.github.io';
const safe=(code:string,status=502)=>Object.assign(new Error(code),{status});
function headers(req:Request){return {'content-type':'application/json; charset=utf-8','cache-control':'no-store',
 'vary':'origin','x-content-type-options':'nosniff',
 ...(req.headers.get('origin')===ORIGIN?{'access-control-allow-origin':ORIGIN}:{}),
 'access-control-allow-headers':'authorization,apikey,content-type,x-client-info',
 'access-control-allow-methods':'GET,OPTIONS'}};
const answer=(req:Request,body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:headers(req)});
async function rpc(host:string,args:unknown[],service='object',method='execute_kw'){
 let response:Response;
 try{response=await fetch(host+'/jsonrpc',{method:'POST',redirect:'error',headers:{'content-type':'application/json'},
  signal:AbortSignal.timeout(15000),body:JSON.stringify({jsonrpc:'2.0',id:1,method:'call',params:{service,method,args}})})}
 catch{throw safe('odoo_unreachable',503)}
 if(!response.ok)throw safe('odoo_http_error');
 if(Number(response.headers.get('content-length')||0)>400000)throw safe('odoo_response_too_large',413);
 const raw=await response.text();if(raw.length>400000)throw safe('odoo_response_too_large',413);
 let body;try{body=JSON.parse(raw)}catch{throw safe('odoo_invalid_response')}
 if(body.error)throw safe('odoo_invoice_read_refused');
 if(!Object.hasOwn(body,'result'))throw safe('odoo_invalid_response');return body.result;
}
Deno.serve(async(req:Request)=>{
 const origin=req.headers.get('origin');if(origin&&origin!==ORIGIN)return answer(req,{ok:false,error:'origin_not_allowed'},403);
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers:headers(req)});
 if(req.method!=='GET')return answer(req,{ok:false,error:'method_not_allowed'},405);
 let orderId:number;try{orderId=parseInvoiceOrderId(req.url)}catch{return answer(req,{ok:false,error:'invalid_order_id'},400)}
 const jwt=req.headers.get('authorization')?.match(/^Bearer\s+([^\s]+)$/i)?.[1];
 if(!jwt)return answer(req,{ok:false,error:'authentication_required'},401);
 let phase='owner_auth';
 try{
  let keys:Record<string,string>={};try{keys=JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS')||'{}')}catch{}
  const base=Deno.env.get('SUPABASE_URL')||'',service=keys.default||Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
  if(!base||!service)throw safe('not_configured',503);
  const sb=createClient(base,service,{auth:{autoRefreshToken:false,persistSession:false}});
  const {data:auth,error:ae}=await sb.auth.getUser(jwt),user=auth?.user;
  if(ae||!user?.email||!user.email_confirmed_at)return answer(req,{ok:false,error:'invalid_session'},401);
  const {data:acl,error:ce}=await sb.from('app_access_users').select('role,is_active')
   .eq('email',user.email.toLowerCase()).maybeSingle();
  if(ce||!acl?.is_active||acl.role!=='owner')return answer(req,{ok:false,error:'owner_only'},403);
  phase='odoo_auth';
  const db=Deno.env.get('ODOO_DB')||'',login=Deno.env.get('ODOO_USERNAME')||'',key=Deno.env.get('ODOO_API_KEY')||'';
  let url:URL;try{url=new URL(Deno.env.get('ODOO_URL')||'')}catch{throw safe('odoo_not_configured',503)}
  if(url.protocol!=='https:'||url.hostname!=='weneedweed.odoo.com'||url.port||url.username||url.password||
   url.search||url.hash||!db||!login||!key)throw safe('odoo_not_configured',503);
  const host=url.origin,uid=await rpc(host,[db,login,key,{}],'common','authenticate');
  if(!Number.isSafeInteger(uid)||uid<1||Deno.env.get('ODOO_UID_PIN')&&String(uid)!==Deno.env.get('ODOO_UID_PIN'))
   throw safe('odoo_auth_failed',503);
  phase='invoice_evidence_read';
  const read=async(model:string,domain:unknown[],fields:string[],limit:number)=>{
   if(!['sale.order','account.move'].includes(model)||!Number.isSafeInteger(limit)||limit<1||limit>61)
    throw safe('invoice_scope_limit',413);
   const rows=await rpc(host,[db,uid,key,model,'search_read',[domain],{fields,limit,order:'id asc'}]);
   if(!Array.isArray(rows)||rows.length>limit)throw safe('odoo_invalid_response');return rows;
  };
  const data=await readInvoiceEvidence(orderId,{uid,read});return answer(req,{ok:true,data});
 }catch(error){
  const message=error instanceof Error?error.message:'invoice_evidence_unavailable';
  const known=['not_configured','odoo_not_configured','odoo_auth_failed','odoo_unreachable','odoo_http_error',
   'odoo_response_too_large','odoo_invalid_response','odoo_invoice_read_refused','odoo_source_changed',
   'invoice_scope_mismatch','invoice_scope_limit','order_not_accessible','invoices_not_accessible'];
  const code=known.includes(message)?message:'invoice_evidence_unavailable';
  console.error('odoo_invoice_evidence_failure',JSON.stringify({phase,code}));
  return answer(req,{ok:false,error:code,stage:phase},code==='odoo_source_changed'?409:
   code==='order_not_accessible'?404:code==='invoice_scope_limit'||code==='odoo_response_too_large'?413:503);
 }
});
