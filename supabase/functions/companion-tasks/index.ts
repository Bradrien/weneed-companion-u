import {createClient} from 'npm:@supabase/supabase-js@2.58.0';
import {UUID,validateMutation} from './core.mjs';
const cors={'Access-Control-Allow-Origin':'https://bradrien.github.io','Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info','Access-Control-Allow-Methods':'GET,POST,OPTIONS'};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,'Content-Type':'application/json','Cache-Control':'no-store'}});
Deno.serve(async(req:Request)=>{
 const origin=req.headers.get('origin');
 if(origin&&origin!=='https://bradrien.github.io')return json({ok:false,error:'origin_not_allowed'},403);
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
 if(!['GET','POST'].includes(req.method))return json({ok:false,error:'method_not_allowed'},405);
 try{
  const bag=JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS')||'{}');
  const url=Deno.env.get('SUPABASE_URL'),key=bag.default||Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if(!url||!key)return json({ok:false,error:'server_not_configured'},503);
  const sb=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
  const match=(req.headers.get('authorization')||'').match(/^Bearer\s+(.+)$/i);
  if(!match)return json({ok:false,error:'missing_bearer_token'},401);
  const {data:auth,error:authError}=await sb.auth.getUser(match[1]);
  const user=auth?.user;
  if(authError||!user?.email||!user.email_confirmed_at)return json({ok:false,error:'invalid_session'},401);
  const {data:access,error:accessError}=await sb.from('app_access_users').select('role,is_active').eq('email',user.email.toLowerCase()).maybeSingle();
  if(accessError)throw accessError;
  if(access?.role!=='owner'||!access?.is_active)return json({ok:false,error:'owner_only'},403);
  if(req.method==='GET'){
   const u=new URL(req.url),status=u.searchParams.get('status')||'OPEN',client=u.searchParams.get('client_id');
   if(!['OPEN','DONE','CANCELLED','ALL'].includes(status)||client&&!UUID.test(client))return json({ok:false,error:'invalid_filter'},400);
   const {data,error}=await sb.rpc('api_owner_tasks_list',{p_status:status,p_client_id:client||null,p_query:(u.searchParams.get('q')||'').trim().slice(0,120),p_offset:Math.max(0,Math.min(100000,Number(u.searchParams.get('offset'))||0))});
   if(error)throw error;
   return json({ok:true,data});
  }
  if(Number(req.headers.get('content-length')||0)>16000)return json({ok:false,error:'body_too_large'},413);
  const raw=await req.text();
  if(raw.length>16000)return json({ok:false,error:'body_too_large'},413);
  let args;
  try{args=validateMutation(JSON.parse(raw))}catch(e){return json({ok:false,error:e instanceof Error?e.message:'invalid_request'},400)}
  const {data,error}=await sb.rpc('api_owner_task_mutate',{...args,p_actor:user.id});
  if(error)throw error;
  if(!data?.ok)return json(data||{ok:false,error:'task_unavailable'},data?.error==='task_not_found'?404:409);
  return json(data);
 }catch{return json({ok:false,error:'tasks_unavailable'},503)}
});
