// Owner-only CRM ↔ Odoo partner approval / revocation.
// This API never changes Odoo records and never accepts asserted contact matches from the browser.
import {createClient} from 'npm:@supabase/supabase-js@2';
const env=(key:string)=>Deno.env.get(key)||'';
const CORS={'access-control-allow-origin':'https://bradrien.github.io','vary':'Origin',
 'access-control-allow-methods':'POST,OPTIONS',
 'access-control-allow-headers':'authorization,apikey,content-type,x-client-info'};
const HEAD={'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff'};
const UUID=/^[\da-f]{8}-[\da-f]{4}-[1-5][\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i;
const canon=(x:unknown)=>typeof x==='string'?x.normalize('NFKC').trim().toLocaleLowerCase('fr-FR').replace(/\s+/g,' '):'';
const phone=(x:unknown)=>{const n=(typeof x==='string'?x:'').replace(/\D/g,'');
 return n.startsWith('33')&&n.length===11?'0'+n.slice(2):n;};
const id=(x:unknown)=>Number.isSafeInteger(x)&&Number(x)>0?Number(x):null;
type Cfg={url:string,db:string,login:string,pass:string};
class SafeError extends Error{status:number;constructor(code:string,status=422){super(code);this.status=status}}
function cfg():Cfg{
 const raw=env('ODOO_URL');let url:URL;
 try{url=new URL(raw)}catch{throw new SafeError('odoo_not_configured',503)}
 if(url.protocol!=='https:'||url.hostname!=='weneedweed.odoo.com'||url.port||
  url.search||url.hash||url.username||url.password)throw new SafeError('odoo_not_configured',503);
 const db=env('ODOO_DB'),login=env('ODOO_USERNAME'),pass=env('ODOO_API_KEY');
 if(!db||!login||!pass)throw new SafeError('odoo_not_configured',503);
 return {url:url.href.replace(/\/+$/,''),db,login,pass};
}
async function rpc(c:Cfg,service:string,method:string,args:unknown[]){
 let res:Response;
 try{res=await fetch(c.url+'/jsonrpc',{method:'POST',redirect:'error',
  headers:{'content-type':'application/json'},signal:AbortSignal.timeout(12000),
  body:JSON.stringify({jsonrpc:'2.0',id:1,method:'call',params:{service,method,args}})})}
 catch{throw new SafeError('odoo_unreachable',502)}
 if(!res.ok)throw new SafeError('odoo_http_error',502);
 let raw:string;try{raw=await res.text()}catch{throw new SafeError('odoo_unreadable',502)}
 if(raw.length>100000)throw new SafeError('odoo_oversized',502);
 let output:any;try{output=JSON.parse(raw)}catch{throw new SafeError('odoo_invalid_reply',502)}
 if(output?.error||!Object.hasOwn(output||{},'result'))throw new SafeError('odoo_request_rejected',502);
 return output.result;
}
async function validateLive(c:Cfg,partnerId:number,crm:any){
 const uid=await rpc(c,'common','authenticate',[c.db,c.login,c.pass,{}]);
 const pin=env('ODOO_UID_PIN');
 if(!id(uid)||(pin&&pin!==String(uid)))throw new SafeError('odoo_auth_failed',502);
 // Candidate must have at least one order owned by this exact salesperson.
 const orders=await rpc(c,'object','execute_kw',[c.db,uid,c.pass,
  'sale.order','search_read',[[['partner_id','=',partnerId],['user_id','=',uid]]],
  {fields:['id','partner_id','user_id'],limit:1}]);
 if(!Array.isArray(orders)||orders.length!==1||
  !Array.isArray(orders[0]?.partner_id)||orders[0].partner_id[0]!==partnerId||
  !Array.isArray(orders[0]?.user_id)||orders[0].user_id[0]!==uid)
  throw new SafeError('no_salesperson_order_for_partner');
 // Minimal partner fields: the complete version may be unreadable because of field-level ACL.
 let partner:any=null;
 for(const fields of [['id','name','email','phone','mobile'],['id','name','email','phone']]){
  try{
   const rows=await rpc(c,'object','execute_kw',[c.db,uid,c.pass,
    'res.partner','search_read',[[['id','=',partnerId]]],{fields,limit:2}]);
   if(Array.isArray(rows)&&rows.length===1&&rows[0]?.id===partnerId){partner=rows[0];break}
  }catch{}
 }
 if(!partner)throw new SafeError('partner_contact_unavailable');
 const expected=canon(crm?.profile?.name);
 if(!expected||canon(partner.name)!==expected)throw new SafeError('partner_name_mismatch');
 const emails=new Set<string>(),phones=new Set<string>();
 for(const contact of Array.isArray(crm?.contacts)?crm.contacts:[]){
  for(const ch of Array.isArray(contact?.channels)?contact.channels:[]){
   if(ch?.type==='email'&&canon(ch.value))emails.add(canon(ch.value));
   if(ch?.type==='phone'&&phone(ch.value).length>=9)phones.add(phone(ch.value));
  }
 }
 const emailMatch=!!canon(partner.email)&&emails.has(canon(partner.email));
 const phoneMatch=[partner.phone,partner.mobile].some(x=>phone(x).length>=9&&phones.has(phone(x)));
 if(!emailMatch&&!phoneMatch)throw new SafeError('contact_evidence_not_confirmed');
 return {name_match:true,email_match:emailMatch,phone_match:phoneMatch};
}
Deno.serve(async req=>{
 const origin=req.headers.get('origin');
 const cors=origin==='https://bradrien.github.io'?CORS:{};
 const headers={...HEAD,...cors};
 const send=(status:number,data:unknown)=>new Response(JSON.stringify(data),{status,headers});
 if(origin&&origin!=='https://bradrien.github.io')return send(403,{ok:false,error:'origin_not_allowed'});
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
 if(req.method!=='POST')return send(405,{ok:false,error:'method_not_allowed'});
 if(req.headers.get('content-type')?.split(';')[0]?.trim()!=='application/json')
  return send(415,{ok:false,error:'json_required'});
 if(Number(req.headers.get('content-length')||0)>2500)return send(413,{ok:false,error:'payload_too_large'});
 const token=req.headers.get('authorization')?.match(/^Bearer\s+([^\s]+)$/i)?.[1];
 if(!token)return send(401,{ok:false,error:'session_required'});
 const base=env('SUPABASE_URL');let keyBag:Record<string,string>={};
 try{keyBag=JSON.parse(env('SUPABASE_SECRET_KEYS')||'{}')}catch{}
 const secret=keyBag.default||env('SUPABASE_SERVICE_ROLE_KEY');
 if(!base||!secret)return send(503,{ok:false,error:'server_unavailable'});
 const sb=createClient(base,secret,{auth:{persistSession:false,autoRefreshToken:false}});
 try{
  const {data:auth,error:authError}=await sb.auth.getUser(token);
  if(authError||!auth.user?.email||!auth.user.email_confirmed_at)
   return send(403,{ok:false,error:'owner_only'});
  const {data:owner,error:ownerError}=await sb.from('app_access_users')
   .select('role,is_active').eq('email',auth.user.email.toLowerCase()).maybeSingle();
  if(ownerError||owner?.role!=='owner'||owner?.is_active!==true)
   return send(403,{ok:false,error:'owner_only'});
  let input:any;
  try{
   const raw=await req.text();
   if(raw.length>2500)throw Error();
   input=JSON.parse(raw);
  }catch{return send(400,{ok:false,error:'invalid_json'})}
  if(!input||typeof input!=='object'||Array.isArray(input))return send(400,{ok:false,error:'invalid_request'});
  const keys=Object.keys(input);
  if(keys.some(k=>!['action','client_id','partner_id','confirmation'].includes(k))||
   !UUID.test(input.client_id)||!id(input.partner_id))
   return send(400,{ok:false,error:'invalid_request'});
  const clientId=input.client_id,partnerId=Number(input.partner_id),action=input.action;
  const {data:client,error:ce}=await sb.from('clients').select('id,canonical_name').eq('id',clientId).maybeSingle();
  if(ce||!client)return send(404,{ok:false,error:'client_not_found'});
  const {data:active,error:ae}=await sb.from('crm_odoo_partner_links')
   .select('id,client_id,partner_odoo_id,status').eq('status','active')
   .or('client_id.eq.'+clientId+',partner_odoo_id.eq.'+partnerId).limit(5);
  if(ae)throw new SafeError('link_lookup_failed',503);
  const matches=Array.isArray(active)?active:[];
  if(action==='revoke'){
   if(input.confirmation!=='REVOQUER_LIAISON')return send(400,{ok:false,error:'explicit_confirmation_required'});
   const linked=matches.find(x=>x.client_id===clientId&&x.partner_odoo_id===partnerId);
   if(!linked)return send(409,{ok:false,error:'active_link_not_found'});
   const {data:rev,error:re}=await sb.from('crm_odoo_partner_links')
    .update({status:'revoked',revoked_at:new Date().toISOString()})
    .eq('id',linked.id).eq('status','active').select('id').maybeSingle();
   if(re||!rev)throw new SafeError('revocation_conflict',409);
   return send(200,{ok:true,status:'revoked',partner_odoo_id:partnerId});
  }
  if(action!=='confirm'||input.confirmation!=='CONFIRMER_LIAISON')
   return send(400,{ok:false,error:'explicit_confirmation_required'});
  if(matches.length>0){
   if(matches.length===1&&matches[0].client_id===clientId&&matches[0].partner_odoo_id===partnerId)
    return send(200,{ok:true,status:'already_linked',partner_odoo_id:partnerId});
   return send(409,{ok:false,error:'existing_client_or_partner_link'});
  }
  const {data:crm,error:crmError}=await sb.rpc('api_get_client_card',{p_client_id:clientId});
  if(crmError||!crm||canon(crm?.profile?.name)!==canon(client.canonical_name))
   throw new SafeError('client_data_unavailable',503);
  const evidence=await validateLive(cfg(),partnerId,crm);
  const {data:inserted,error:insertError}=await sb.from('crm_odoo_partner_links')
   .insert({client_id:clientId,partner_odoo_id:partnerId,status:'active',confirmed_by:'owner_explicit',
    evidence:{...evidence,method:'owner_confirmed_live_odoo_crm_comparison'}})
   .select('id,partner_odoo_id,confirmed_at').single();
  if(insertError||!inserted)throw new SafeError('link_conflict_or_insert_failed',409);
  return send(201,{ok:true,status:'linked',partner_odoo_id:inserted.partner_odoo_id,
   confirmed_at:inserted.confirmed_at});
 }catch(e){
  const code=e instanceof SafeError?e.message:'link_unavailable';
  const status=e instanceof SafeError?e.status:503;
  console.error('crm_odoo_link_operation',code);
  return send(status,{ok:false,error:code});
 }
});
