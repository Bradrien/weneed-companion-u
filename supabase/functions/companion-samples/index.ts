import {createClient} from 'npm:@supabase/supabase-js@2.58.0';
import {UUID,SAMPLE_STATUSES,validateSampleMutation} from './core.mjs';
const cors={'Access-Control-Allow-Origin':'https://bradrien.github.io','Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info','Access-Control-Allow-Methods':'GET,POST,OPTIONS'};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,'Content-Type':'application/json','Cache-Control':'no-store'}});
Deno.serve(async(req:Request)=>{
 if(req.headers.get('origin')&&req.headers.get('origin')!=='https://bradrien.github.io')return json({ok:false,error:'origin_not_allowed'},403);
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
 if(!['GET','POST'].includes(req.method))return json({ok:false,error:'method_not_allowed'},405);
 try{
  const bag=JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS')||'{}');
  const url=Deno.env.get('SUPABASE_URL'),key=bag.default||Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if(!url||!key)return json({ok:false,error:'server_not_configured'},503);
  const sb=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
  const bearer=(req.headers.get('authorization')||'').match(/^Bearer\s+(.+)$/i);
  if(!bearer)return json({ok:false,error:'missing_bearer_token'},401);
  const {data:auth,error:authError}=await sb.auth.getUser(bearer[1]);const user=auth?.user;
  if(authError||!user?.id||!user.email||!user.email_confirmed_at||user.is_anonymous)return json({ok:false,error:'invalid_session'},401);
  const {data:access,error:accessError}=await sb.from('app_access_users').select('role,is_active').eq('email',user.email.toLowerCase()).maybeSingle();
  if(accessError)throw accessError;
  if(access?.role!=='owner'||!access.is_active)return json({ok:false,error:'owner_only'},403);
  if(req.method==='GET'){
   const u=new URL(req.url),status=u.searchParams.get('status')||'ACTIVE',client=u.searchParams.get('client_id'),offset=Number(u.searchParams.get('offset')||0);
   if(!['ACTIVE','OVERDUE','ALL',...SAMPLE_STATUSES].includes(status)||client&&!UUID.test(client)||!Number.isSafeInteger(offset)||offset<0||offset>100000)return json({ok:false,error:'invalid_filter'},400);
   const {data,error}=await sb.rpc('api_owner_samples_list',{p_actor:user.id,p_status:status,p_client_id:client||null,p_query:(u.searchParams.get('q')||'').trim().slice(0,120),p_offset:offset});
   if(error)throw error;if(data?.error)return json({ok:false,error:data.error},403);return json({ok:true,data});
  }
  if(Number(req.headers.get('content-length')||0)>16000)return json({ok:false,error:'body_too_large'},413);
  const raw=await req.text();if(raw.length>16000)return json({ok:false,error:'body_too_large'},413);
  let args;try{args=validateSampleMutation(JSON.parse(raw))}catch(e){return json({ok:false,error:e instanceof Error?e.message:'invalid_request'},400)}
  const {data,error}=await sb.rpc('api_owner_sample_mutate',{...args,p_actor:user.id});
  if(error)throw error;if(!data?.ok)return json(data||{ok:false,error:'samples_unavailable'},data?.error==='sample_not_found'?404:409);return json(data);
 }catch{return json({ok:false,error:'samples_unavailable'},503)}
});
