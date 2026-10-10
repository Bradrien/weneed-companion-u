import {createClient} from 'npm:@supabase/supabase-js@2.58.0';
import {readStock} from './core.mjs';
import {vapid,validSubscription,sendPush,dispatch} from './push.mjs';
const env=Object.fromEntries(['ODOO_URL','ODOO_DB','ODOO_USERNAME','ODOO_API_KEY','ODOO_UID_PIN'].map(k=>[k,Deno.env.get(k)||'']));
let bag={};try{bag=JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS')||'{}')}catch{}
const base=Deno.env.get('SUPABASE_URL');
const key=bag.default||Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const sb=base&&key?createClient(base,key,{auth:{persistSession:false,autoRefreshToken:false}}):null;
const cors={'access-control-allow-origin':'https://bradrien.github.io','access-control-allow-methods':'GET,POST,DELETE,OPTIONS','access-control-allow-headers':'authorization,apikey,content-type','vary':'Origin'};
const reply=(body,status=200)=>Response.json(body,{status,headers:{...cors,'cache-control':'no-store','x-content-type-options':'nosniff'}});
async function owner(token){
 const {data,error}=await sb.auth.getUser(token);
 if(error||!data?.user?.email_confirmed_at||!data.user.email)return false;
 const {data:access,error:e}=await sb.from('app_access_users').select('role,is_active').eq('email',data.user.email.toLowerCase()).maybeSingle();
 return !e&&access?.role==='owner'&&access.is_active===true?data.user:null;
}
Deno.serve(async req=>{
 if(req.headers.get('origin')&&req.headers.get('origin')!=='https://bradrien.github.io')return reply({ok:false,error:'origin_not_allowed'},403);
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
 if(!sb)return reply({ok:false,error:'server_not_configured'},503);
 const token=req.headers.get('authorization')?.match(/^Bearer\s+(\S+)$/i)?.[1];
 if(!token)return reply({ok:false,error:'authentication_required'},401);
 const query=new URL(req.url).searchParams;
 const action=query.get('action');
 if(action){
  const user=await owner(token);if(!user)return reply({ok:false,error:'owner_only'},403);
  try{
   if(action==='push-key'&&req.method==='GET'){const keys=await vapid(sb);return reply({ok:true,publicKey:keys.publicKey})}
   if(!['subscribe','unsubscribe','test'].includes(action)||req.method!=='POST')return reply({ok:false,error:'invalid_action'},400);
   if(Number(req.headers.get('content-length')||0)>4096)return reply({ok:false,error:'invalid_subscription'},400);
   const raw=await req.text();if(raw.length>4096)return reply({ok:false,error:'invalid_subscription'},400);
   const sub=JSON.parse(raw);if(!validSubscription(sub))return reply({ok:false,error:'invalid_subscription'},400);
   if(action==='unsubscribe'){const {error}=await sb.rpc('stock_push_unregister',{p_owner:user.id,p_endpoint:sub.endpoint});
    return error?reply({ok:false,error:'push_update_failed'},503):reply({ok:true});}
   if(action==='subscribe'){const {error}=await sb.rpc('stock_push_register',{p_owner:user.id,p_endpoint:sub.endpoint,p_keys:sub.keys});
    return error?reply({ok:false,error:'push_update_failed'},503):reply({ok:true});}
   // Test only the subscription owned by this user; register through the same guarded RPC.
   const {error}=await sb.rpc('stock_push_register',{p_owner:user.id,p_endpoint:sub.endpoint,p_keys:sub.keys});
   if(error)return reply({ok:false,error:'push_update_failed'},503);
   const result=await sendPush(sub,{title:'WeNeed Companion',body:'Notifications de stocks TR / GTA activées.',tag:'stock-test'},await vapid(sb));
   return reply({ok:result==='sent',delivery:result},result==='sent'?200:502);
  }catch{return reply({ok:false,error:'push_unavailable'},503)}
 }
 if(req.method==='GET'){
  if(!await owner(token))return reply({ok:false,error:'owner_only'},403);
  const company=query.get('company')||'ALL',q=(query.get('q')||'').slice(0,120),offset=Number(query.get('offset')||0);
  if(!['ALL','GTA','TR'].includes(company)||!Number.isSafeInteger(offset)||offset<0||offset>10000)return reply({ok:false,error:'invalid_query'},400);
  const {data,error}=await sb.rpc('stock_read_dashboard',{p_company:company,p_query:q,p_offset:offset});
  return error?reply({ok:false,error:'stock_read_failed'},503):reply({ok:true,data});
 }
 if(req.method!=='POST')return reply({ok:false,error:'method_not_allowed'},405);
 const {data:valid,error:authError}=await sb.rpc('stock_validate_worker_token',{p_token:token});
 if(authError||valid!==true)return reply({ok:false,error:'worker_only'},403);
 const {data:scan,error:leaseError}=await sb.rpc('stock_begin_scan');
 if(leaseError)return reply({ok:false,error:'scan_start_failed'},503);
 if(!scan)return reply({ok:true,skipped:'scan_already_running'});
 try{
  const {rows,metadata}=await readStock(env);
  const {data,error}=await sb.rpc('stock_commit_snapshot',{p_scan:scan,p_rows:rows,p_meta:metadata});
  if(error)throw new Error('snapshot_commit_failed');
  let notifications;try{notifications=await dispatch(sb)}catch{notifications={error:'push_dispatch_failed'}}
  return reply({ok:true,data,notifications});
 }catch(e){
  const safeCodes=new Set(['odoo_credentials_rejected','odoo_not_configured','invalid_odoo_configuration','odoo_unreachable','odoo_http_error','odoo_remote_error','stock_fields_unavailable','stock_company_scope_unverified','invalid_stock_response','stock_source_limit_exceeded','stock_empty_company','snapshot_commit_failed']);
  const code=safeCodes.has(e?.message)?e.message:'stock_scan_failed';
  await sb.rpc('stock_fail_scan',{p_scan:scan,p_error:code});
  return reply({ok:false,error:code},502);
 }
});
