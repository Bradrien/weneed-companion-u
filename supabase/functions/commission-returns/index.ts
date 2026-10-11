// Owner-only read of explicitly sourced return commission deductions. No Odoo or ledger writes.
import {createClient} from 'npm:@supabase/supabase-js@2.58.0';
const ORIGIN='https://bradrien.github.io';
function headers(req:Request){return {'content-type':'application/json; charset=utf-8','cache-control':'no-store',
 'vary':'origin','x-content-type-options':'nosniff',
 ...(req.headers.get('origin')===ORIGIN?{'access-control-allow-origin':ORIGIN}:{}),
 'access-control-allow-headers':'authorization,apikey,content-type,x-client-info',
 'access-control-allow-methods':'GET,OPTIONS'}};
const answer=(req:Request,body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:headers(req)});
Deno.serve(async(req:Request)=>{
 const origin=req.headers.get('origin');if(origin&&origin!==ORIGIN)return answer(req,{ok:false,error:'origin_not_allowed'},403);
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers:headers(req)});
 if(req.method!=='GET')return answer(req,{ok:false,error:'method_not_allowed'},405);
 const url=new URL(req.url),month=url.searchParams.get('month');
 if(url.searchParams.getAll('month').length!==1||[...url.searchParams.keys()].some(k=>k!=='month')||
  !month||!/^20\d{2}-(0[1-9]|1[0-2])$/.test(month))return answer(req,{ok:false,error:'invalid_month'},400);
 const jwt=req.headers.get('authorization')?.match(/^Bearer\s+([^\s]+)$/i)?.[1];
 if(!jwt)return answer(req,{ok:false,error:'authentication_required'},401);
 try{
  let keys:Record<string,string>={};try{keys=JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS')||'{}')}catch{}
  const base=Deno.env.get('SUPABASE_URL')||'',service=keys.default||Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
  if(!base||!service)return answer(req,{ok:false,error:'not_configured'},503);
  const sb=createClient(base,service,{auth:{autoRefreshToken:false,persistSession:false}});
  const {data:auth,error:ae}=await sb.auth.getUser(jwt),user=auth?.user;
  if(ae||!user?.email||!user.email_confirmed_at||user.is_anonymous===true)
   return answer(req,{ok:false,error:'invalid_session'},401);
  const {data:acl,error:ce}=await sb.from('app_access_users').select('role,is_active')
   .eq('email',user.email.toLowerCase()).maybeSingle();
  if(ce||!acl?.is_active||acl.role!=='owner')return answer(req,{ok:false,error:'owner_only'},403);
  const {data,error}=await sb.rpc('api_owner_commission_returns',{p_month:month});
  if(error||!data||data.month!==month||data.scope!=='recorded_deductions_only'||
   !Number.isSafeInteger(data.total)||data.total>500||!Array.isArray(data.deductions)||
   data.deductions.length!==data.total)return answer(req,{ok:false,error:'return_deductions_unavailable'},503);
  return answer(req,{ok:true,data});
 }catch{return answer(req,{ok:false,error:'return_deductions_unavailable'},503)}
});
