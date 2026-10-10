// Read-only private strategy portfolio: Odoo confirmed sales and CRM/WhatsApp evidence.
// Never interprets emails, texts, or quotes as accounting sales or paid invoices.
import {createClient} from "npm:@supabase/supabase-js@2";
const ALLOWED_ORIGIN="https://bradrien.github.io";
const contentHeaders={"content-type":"application/json; charset=utf-8","cache-control":"no-store","vary":"origin","x-content-type-options":"nosniff"};
const aliases={"Global Trust Agriculture SA":"GTA","Trim Rocket s.r.o.":"TR"};
const asText=(v:unknown)=>typeof v==="string"?v:"";
const oid=(v:unknown)=>Array.isArray(v)&&Number.isSafeInteger(v[0])&&v[0]>0?v[0]:null;
const display=(v:unknown)=>Array.isArray(v)&&typeof v[1]==="string"?v[1]:"";
const number=(v:unknown)=>typeof v==="number"&&Number.isFinite(v)?v:null;
const safeErr=(code:string,status=502)=>Object.assign(new Error(code),{status});
function response(req:Request,data:unknown,status=200){
 const origin=req.headers.get("origin");
 const cors=origin===ALLOWED_ORIGIN?{"access-control-allow-origin":ALLOWED_ORIGIN,
   "access-control-allow-headers":"authorization,apikey,content-type,x-client-info",
   "access-control-allow-methods":"GET,OPTIONS"}:{};
 return new Response(JSON.stringify(data),{status,headers:{...contentHeaders,...cors}});
}
async function rpc(host:string,db:string,uid:number,secret:string,model:string,method:string,args:unknown[]){
 const res=await fetch(host+"/jsonrpc",{method:"POST",redirect:"error",signal:AbortSignal.timeout(12000),
  headers:{"content-type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",id:1,method:"call",params:
   {service:model,method,args}})}).catch(()=>{throw safeErr("odoo_unreachable")});
 if(!res.ok)throw safeErr("odoo_http_error");
 if(Number(res.headers.get("content-length")||0)>1_000_000)throw safeErr("odoo_response_too_large");
 const raw=await res.text();if(raw.length>1_000_000)throw safeErr("odoo_response_too_large");
 let value;try{value=JSON.parse(raw)}catch{throw safeErr("odoo_invalid_response")}
 if(value.error||!Object.hasOwn(value,"result"))throw safeErr("odoo_remote_error");
 return value.result;
}
async function odooOrders(){
 const h=Deno.env.get("ODOO_URL")||"",db=Deno.env.get("ODOO_DB")||"",
 username=Deno.env.get("ODOO_USERNAME")||"",password=Deno.env.get("ODOO_API_KEY")||"";
 let parsed:URL;try{parsed=new URL(h)}catch{throw safeErr("odoo_not_configured",503)}
 if(parsed.protocol!=="https:"||parsed.hostname!=="weneedweed.odoo.com"||parsed.username||parsed.password||
   parsed.search||parsed.hash||parsed.port||!db||!username||!password)
   throw safeErr("odoo_not_configured",503);
 const host=parsed.origin;
 const auth=await rpc(host,db,0,"","common","authenticate",[db,username,password,{}]);
 const pin=Deno.env.get("ODOO_UID_PIN")||"";
 if(!Number.isSafeInteger(auth)||auth<=0||(pin&&String(auth)!==pin))throw safeErr("odoo_auth_failed");
 const uid=auth as number;
 const until=new Date(),since=new Date(until.getTime()-365*86400000);
 const start=since.toISOString().slice(0,10),end=until.toISOString().slice(0,10);
 const domain=[["user_id","=",uid],["date_order",">=",start+" 00:00:00"],
  ["date_order","<=",end+" 23:59:59"]];
 const fields=["id","name","date_order","state","partner_id","user_id","company_id","amount_untaxed","currency_id"];
 const raw:Record<string,unknown>[]=[];
 const MAX=1200, PAGE=80;
 for(let off=0;off<=MAX;off+=PAGE){
  const batch=await rpc(host,db,uid,password,"object","execute_kw",
   [db,uid,password,"sale.order","search_read",[domain],
    {fields,limit:PAGE,offset:off,order:"id asc"}]);
  if(!Array.isArray(batch)||batch.length>PAGE||batch.some(x=>!x||typeof x!=="object"||Array.isArray(x)))
    throw safeErr("odoo_invalid_response");
  if(off+batch.length>MAX)throw safeErr("odoo_period_too_large",413);
  raw.push(...batch);
  if(batch.length<PAGE)break;
  if(off+PAGE>=MAX)throw safeErr("odoo_period_too_large",413);
 }
 const all=raw.filter(x=>aliases[display(x.company_id)]);
 const ids=all.map(x=>x.id);
 if(ids.some(x=>!Number.isSafeInteger(x)||Number(x)<=0)||new Set(ids).size!==ids.length)
  throw safeErr("odoo_order_identity_mismatch");
 // Explicit confirmation of status before publishing any sales metrics.
 const latest=new Map<number,string>();
 for(let at=0;at<ids.length;at+=80){
  const part=ids.slice(at,at+80);
  const data=await rpc(host,db,uid,password,"object","execute_kw",
   [db,uid,password,"sale.order","search_read",[[["id","in",part],["user_id","=",uid]]],
    {fields:["id","state","partner_id"],limit:part.length+1,order:"id asc"}]);
  if(!Array.isArray(data)||data.length!==part.length)throw safeErr("odoo_status_unverifiable",409);
  for(const item of data){
   if(!Number.isSafeInteger(item?.id)||typeof item.state!=="string"||
     latest.has(item.id)||oid(item.partner_id)!==oid(all.find(o=>o.id===item.id)?.partner_id))
     throw safeErr("odoo_status_unverifiable",409);
   latest.set(item.id,item.state);
  }
 }
 const orders=[];
 for(const o of all){
  if(oid(o.user_id)!==uid||!latest.has(Number(o.id))||latest.get(Number(o.id))!==o.state)
   throw safeErr("odoo_order_state_changed",409);
  const company=aliases[display(o.company_id)],partnerId=oid(o.partner_id),
   currency=display(o.currency_id),amount=number(o.amount_untaxed);
  if(!partnerId||!company||!asText(o.date_order)||!asText(o.state)||!asText(o.name))
   throw safeErr("odoo_invalid_response");
  orders.push({odoo_id:o.id,reference:asText(o.name).slice(0,80),date:asText(o.date_order).slice(0,19),
   state:o.state,partner_id:partnerId,partner_name:display(o.partner_id).slice(0,140),
   company,amount_ht:amount,currency:currency.slice(0,15)});
 }
 return {available:true,error:null,window:{from:start,to:end,checked_at:new Date().toISOString()},
  orders,scope:"odoo_salesperson_read_only_status_rechecked"};
}
Deno.serve(async req=>{
 const origin=req.headers.get("origin");
 if(origin&&origin!==ALLOWED_ORIGIN)return response(req,{ok:false,error:"origin_not_allowed"},403);
 if(req.method==="OPTIONS")return new Response(null,{status:204,headers:
   {"access-control-allow-origin":ALLOWED_ORIGIN,"access-control-allow-headers":"authorization,apikey,content-type,x-client-info",
    "access-control-allow-methods":"GET,OPTIONS","vary":"origin"}});
 if(req.method!=="GET")return response(req,{ok:false,error:"method_not_allowed"},405);
 const jwt=req.headers.get("authorization")?.match(/^Bearer\s+([^\s]+)$/i)?.[1];
 if(!jwt)return response(req,{ok:false,error:"authentication_required"},401);
 let keys:Record<string,string>={};try{keys=JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS")||"{}")}catch{}
 const base=Deno.env.get("SUPABASE_URL")||"",
 service=keys.default||Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"";
 if(!base||!service)return response(req,{ok:false,error:"not_configured"},503);
 try{
  const sb=createClient(base,service,{auth:{autoRefreshToken:false,persistSession:false}});
  const {data:userData,error:userError}=await sb.auth.getUser(jwt);
  const user=userData?.user;
  if(userError||!user?.email||!user.email_confirmed_at)return response(req,{ok:false,error:"invalid_session"},401);
  const {data:acl,error:aclErr}=await sb.from("app_access_users")
    .select("role,is_active").eq("email",user.email.toLowerCase()).maybeSingle();
  if(aclErr||!acl?.is_active||acl.role!=="owner")return response(req,{ok:false,error:"owner_only"},403);
  const query=new URL(req.url).searchParams;
  if([...query.keys()].length) return response(req,{ok:false,error:"unsupported_query"},400);
  const [clients,links,wa,memories,odoo]=await Promise.all([
   sb.from("clients").select("id,canonical_name,status").order("canonical_name").limit(200),
   sb.from("crm_odoo_partner_links").select("client_id,partner_odoo_id,confirmed_at")
     .eq("status","active").limit(200),
   sb.rpc("api_whatsapp_brief_overview",{p_limit:150}),
   sb.from("client_memory").select("client_id,summary,open_loops,opportunities,objections,last_event_at").limit(200),
   odooOrders().catch(e=>({available:false,error:asText(e?.message)||"odoo_unavailable",
      window:null,orders:[],scope:"odoo_unavailable_do_not_infer_zero_sales"}))
  ]);
  if(clients.error||links.error||wa.error||memories.error)throw Error("db_unavailable");
  const allClients=clients.data||[],validLinks=links.data||[];
  if(allClients.length>=200||validLinks.length>=200)throw Error("record_limit_exceeded");
  const idSet=new Set(allClients.map(c=>c.id));
  const clientLinkCounts=new Map<string,number>();
  const partnerLinkCounts=new Map<number,number>();
  for(const link of validLinks){
   clientLinkCounts.set(link.client_id,(clientLinkCounts.get(link.client_id)||0)+1);
   partnerLinkCounts.set(link.partner_odoo_id,(partnerLinkCounts.get(link.partner_odoo_id)||0)+1);
  }
  const uniqueLinks=validLinks.filter(l=>idSet.has(l.client_id)&&
    clientLinkCounts.get(l.client_id)===1&&partnerLinkCounts.get(l.partner_odoo_id)===1);
  return response(req,{ok:true,data:{
    version:"strategy_verified_v1",checked_at:new Date().toISOString(),
    clients:allClients,verified_links:uniqueLinks,
    invalid_links:validLinks.length-uniqueLinks.length,
    whatsapp:wa.data||[],memories:memories.data||[],
    odoo
  }});
 }catch{return response(req,{ok:false,error:"portfolio_unavailable"},503)}
});
