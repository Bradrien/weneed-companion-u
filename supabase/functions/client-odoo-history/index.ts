// WeNeed Companion — private historical Odoo sales by exact res.partner.id.
// Read-only; no persistent CRM association, commissions or inferred invoices.
import {createClient} from 'npm:@supabase/supabase-js@2';

let keys:Record<string,string>={};
try { keys=JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS')||'{}') }catch{}
const base=Deno.env.get('SUPABASE_URL')||'';
const secret=keys.default||Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
const supa=base&&secret?createClient(base,secret,{auth:{autoRefreshToken:false,persistSession:false}}):null;
const od={url:Deno.env.get('ODOO_URL')||'',db:Deno.env.get('ODOO_DB')||'',
 login:Deno.env.get('ODOO_USERNAME')||'',pass:Deno.env.get('ODOO_API_KEY')||'',
 origin:Deno.env.get('ODOO_ALLOWED_ORIGIN')||''};
const responseHeaders={'content-type':'application/json; charset=utf-8','cache-control':'no-store',
 'x-content-type-options':'nosniff','vary':'Origin'};
const companies:Record<string,string>={
 'Global Trust Agriculture SA':'GTA','Trim Rocket s.r.o.':'TR'};
const dateOK=(x:string|null)=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(x)&&
 !Number.isNaN(Date.parse(x+'T00:00:00Z'))&&new Date(x+'T00:00:00Z').toISOString().slice(0,10)===x;
const oid=(x:unknown)=>Array.isArray(x)&&Number.isSafeInteger(x[0])&&x[0]>0?x[0]:null;
const display=(x:unknown)=>Array.isArray(x)&&typeof x[1]==='string'?x[1]:'';
const str=(x:unknown)=>typeof x==='string'?x:'';
const amount=(x:unknown)=>typeof x==='number'&&Number.isFinite(x)?x:null;
class SafeError extends Error{status:number;constructor(code:string,status=502){super(code);this.status=status}}
function config(){
 if(!od.url||!od.db||!od.login||!od.pass)throw new SafeError('odoo_not_configured',503);
 let u:URL;try{u=new URL(od.url)}catch{throw new SafeError('invalid_odoo_configuration',503)}
 if(u.protocol!=='https:'||u.hostname!=='weneedweed.odoo.com'||u.username||u.password||
  u.search||u.hash||u.port)throw new SafeError('invalid_odoo_configuration',503);
 return {base:u.href.replace(/\/+$/,''),db:od.db,login:od.login,pass:od.pass};
}
type Config=ReturnType<typeof config>;
async function rpc(c:Config,service:string,method:string,args:unknown[]){
 let res:Response;
 try{res=await fetch(c.base+'/jsonrpc',{method:'POST',redirect:'error',
  headers:{'content-type':'application/json'},signal:AbortSignal.timeout(12000),
  body:JSON.stringify({jsonrpc:'2.0',id:1,method:'call',params:{service,method,args}})})}
 catch{throw new SafeError('odoo_unreachable')}
 if(!res.ok)throw new SafeError('odoo_http_error');
 const length=Number(res.headers.get('content-length')||0);
 if(length>1048576)throw new SafeError('odoo_response_too_large');
 let json:any;
 try{
  const raw=await res.text();
  if(raw.length>1048576)throw Error();
  json=JSON.parse(raw);
 }catch{throw new SafeError('invalid_odoo_response')}
 if(json.error)throw new SafeError('odoo_remote_error');
 if(!Object.hasOwn(json,'result'))throw new SafeError('invalid_odoo_response');
 return json.result;
}
async function list(c:Config,uid:number,partnerId:number,from:string,to:string){
 const domain=[['partner_id','=',partnerId],['user_id','=',uid],
  ['date_order','>=',from+' 00:00:00'],['date_order','<=',to+' 23:59:59']];
 const fields=['id','name','date_order','state','partner_id','user_id','company_id',
  'amount_untaxed','currency_id','write_date'];
 const output:any[]=[];
 for(let offset=0;offset<250;offset+=80){
  const data=await rpc(c,'object','execute_kw',[c.db,uid,c.pass,'sale.order','search_read',[domain],
   {fields,offset,limit:80,order:'id asc'}]);
  if(!Array.isArray(data)||data.length>80||data.some(x=>!x||typeof x!=='object'||Array.isArray(x)))
   throw new SafeError('invalid_odoo_response');
  output.push(...data);
  if(data.length<80)break;
  if(offset+80>=250)throw new SafeError('history_limit_exceeded',413);
 }
 if(output.length>250)throw new SafeError('history_limit_exceeded',413);
 const seen=new Set<number>();
 const orders=[];
 for(const o of output){
  if(!Number.isSafeInteger(o.id)||seen.has(o.id)||
     oid(o.partner_id)!==partnerId||oid(o.user_id)!==uid)
   throw new SafeError('odoo_identity_mismatch',409);
  seen.add(o.id);
  const company=companies[display(o.company_id)];
  if(!company)continue;
  if(!str(o.name)||!str(o.date_order)||!str(o.state))throw new SafeError('invalid_odoo_response');
  orders.push({id:o.id,reference:str(o.name),company,partner_odoo_id:partnerId,
   date:str(o.date_order),state:str(o.state),
   amount_ht:amount(o.amount_untaxed),currency:display(o.currency_id)||null,
   source_updated_at:str(o.write_date)});
 }
 // Recheck just before responding so a cancelled order doesn't silently remain 'sale'.
 if(orders.length){
  const ids=orders.map(o=>o.id);
  const fresh=await rpc(c,'object','execute_kw',[c.db,uid,c.pass,'sale.order','search_read',
   [[['id','in',ids],['partner_id','=',partnerId],['user_id','=',uid]]],
   {fields:['id','state'],limit:ids.length+1,order:'id asc'}]);
  if(!Array.isArray(fresh)||fresh.length!==ids.length)throw new SafeError('odoo_order_status_unverifiable',409);
  const status=new Map<number,string>();
  for(const item of fresh){
   if(!Number.isSafeInteger(item?.id)||typeof item.state!=='string'||status.has(item.id))
    throw new SafeError('odoo_order_status_unverifiable',409);
   status.set(item.id,item.state);
  }
  if(orders.some(o=>status.get(o.id)!==o.state))throw new SafeError('odoo_order_state_changed',409);
 }
 orders.sort((a,b)=>b.date.localeCompare(a.date)||b.id-a.id);
 return orders;
}
Deno.serve(async req=>{
 const origin=req.headers.get('origin')||'';
 const allowed=origin==='https://bradrien.github.io'||Boolean(od.origin)&&origin===od.origin;
 const cors=origin&&allowed?{
  'access-control-allow-origin':origin,
  'access-control-allow-headers':'authorization,apikey,content-type,x-client-info',
  'access-control-allow-methods':'GET,OPTIONS'}:{};
 const headers={...responseHeaders,...cors};
 const err=(status:number,code:string)=>new Response(JSON.stringify({ok:false,error:code}),{status,headers});
 if(req.method==='OPTIONS')return Object.keys(cors).length?new Response(null,{status:204,headers}):err(403,'origin_not_allowed');
 if(req.method!=='GET')return err(405,'method_not_allowed');
 if(origin&&!allowed)return err(403,'origin_not_allowed');
 const jwt=req.headers.get('authorization')?.match(/^Bearer\s+([^\s]+)$/i)?.[1];
 if(!supa||!jwt)return err(401,'authentication_required');
 try{
  const {data:who,error:authErr}=await supa.auth.getUser(jwt);
  if(authErr||!who.user?.email||!who.user.email_confirmed_at)return err(403,'owner_only');
  const {data:acl,error:aclErr}=await supa.from('app_access_users').select('role,is_active')
   .eq('email',who.user.email.toLowerCase()).maybeSingle();
  if(aclErr||acl?.role!=='owner'||acl?.is_active!==true)return err(403,'owner_only');
  const url=new URL(req.url);
  for(const key of url.searchParams.keys()){
   if(!['partner_id','from','to'].includes(key)||url.searchParams.getAll(key).length!==1)
    return err(400,'invalid_query');
  }
  const partnerRaw=url.searchParams.get('partner_id');
  if(!partnerRaw||!/^[1-9]\d{0,9}$/.test(partnerRaw))return err(400,'invalid_partner_id');
  const partnerId=Number(partnerRaw);
  if(!Number.isSafeInteger(partnerId))return err(400,'invalid_partner_id');
  const from=url.searchParams.get('from'),to=url.searchParams.get('to');
  if(!dateOK(from)||!dateOK(to)||from!>to!||
    Date.parse(to!+'T00:00:00Z')-Date.parse(from!+'T00:00:00Z')>1127*86400000)
   return err(400,'invalid_period');
  const c=config();
  const uid=await rpc(c,'common','authenticate',[c.db,c.login,c.pass,{}]);
  const pin=Deno.env.get('ODOO_UID_PIN')||'';
  if(!Number.isSafeInteger(uid)||uid<=0||(pin&&String(uid)!==pin))
   throw new SafeError('odoo_auth_failed');
  const orders=await list(c,uid,partnerId,from!,to!);
  return new Response(JSON.stringify({ok:true,data:{
   partner_odoo_id:partnerId,period_from:from,period_to:to,
   source:'odoo_partner_history_read_only',identity_verified:false,
   checked_at:new Date().toISOString(),orders}}),{status:200,headers});
 }catch(e){
  const code=e instanceof SafeError?e.message:'history_unavailable';
  const status=e instanceof SafeError?e.status:502;
  console.error('client_odoo_history_failed',JSON.stringify({code,status}));
  return err(status,code);
 }
});
