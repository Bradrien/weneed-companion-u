// D20 — Owner-only manually managed quotes. No Odoo writes or inferred payable commissions.
import {createClient} from 'npm:@supabase/supabase-js@2';
const ORIGIN='https://bradrien.github.io';
const allowedStatus=new Set(['en_cours','valide','facture','annule']);
const allowedCompany=new Set(['GTA','TR']);
const QUOTE_SELECT='id,reference,client_name,client_id,quote_date,company,amount_ht,commission_amount,status,calculation_source,source_payload,expected_decision_at,created_at,updated_at';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const obj=(v:unknown):v is Record<string,unknown>=>Boolean(v)&&typeof v==='object'&&!Array.isArray(v);
const safeText=(v:unknown,max:number)=>typeof v==='string'?v.trim().slice(0,max):'';
const money=(v:unknown)=>v===null||v===undefined||v===''?null:
 (typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=1_000_000_000&&Math.round(v*100)===v*100?v:null);
const dateOK=(v:unknown)=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&
 !Number.isNaN(Date.parse(v+'T00:00:00Z'))&&new Date(v+'T00:00:00Z').toISOString().slice(0,10)===v;
const issue=(code:string,status=400)=>Object.assign(new Error(code),{status});
function headers(req:Request){
 const origin=req.headers.get('origin');
 return {'content-type':'application/json; charset=utf-8','cache-control':'no-store','vary':'origin',
  'x-content-type-options':'nosniff',
  ...(origin===ORIGIN?{'access-control-allow-origin':ORIGIN}:{}),
  'access-control-allow-headers':'authorization,apikey,content-type,x-client-info',
  'access-control-allow-methods':'GET,POST,OPTIONS'};
}
function reply(req:Request,value:unknown,status=200){return new Response(JSON.stringify(value),{status,headers:headers(req)})}
function clean(raw:unknown){
 if(!obj(raw))throw issue('invalid_quote');
 const reference=safeText(raw.reference,75).toUpperCase();
 const clientName=safeText(raw.client_name,160);
 const company=raw.company,status=raw.status;
 if(!reference||!/^[A-Z0-9][A-Z0-9_./-]{2,74}$/.test(reference))throw issue('invalid_reference');
 if(clientName.length<2)throw issue('invalid_client_name');
 if(!allowedCompany.has(company as string))throw issue('invalid_company');
 if(!allowedStatus.has(status as string))throw issue('invalid_status');
 if(!dateOK(raw.quote_date))throw issue('invalid_quote_date');
 if(raw.expected_decision_at!==null&&raw.expected_decision_at!==undefined&&raw.expected_decision_at!==''&&!dateOK(raw.expected_decision_at))
  throw issue('invalid_expected_decision_at');
 const amountHT=money(raw.amount_ht),estimated=money(raw.commission_amount);
 if(raw.amount_ht!==null&&raw.amount_ht!==''&&raw.amount_ht!==undefined&&amountHT===null)throw issue('invalid_amount_ht');
 if(raw.commission_amount!==null&&raw.commission_amount!==''&&raw.commission_amount!==undefined&&estimated===null)throw issue('invalid_commission_estimate');
 const notes=safeText(raw.notes,1200),productSummary=safeText(raw.products,450);
 if(typeof raw.notes==='string'&&raw.notes.length>1200||typeof raw.products==='string'&&raw.products.length>450)
  throw issue('text_too_long');
 if(raw.client_id!==null&&raw.client_id!==undefined&&raw.client_id!==''&&!UUID.test(String(raw.client_id)))
  throw issue('invalid_client_id');
 return {reference,client_name:clientName,client_id:raw.client_id||null,
  company,quote_date:raw.quote_date,expected_decision_at:raw.expected_decision_at||null,
  status,amount_ht:amountHT,commission_amount:estimated,calculation_source:'manual_quote_d20',
  source_payload:{notes,products:productSummary,origin:'manual_entry',commission_estimate_verified:false}};
}
Deno.serve(async(req:Request)=>{
 const origin=req.headers.get('origin');
 if(origin&&origin!==ORIGIN)return reply(req,{ok:false,error:'origin_not_allowed'},403);
 if(req.method==='OPTIONS')return new Response(null,{status:204,headers:headers(req)});
 if(!['GET','POST'].includes(req.method))return reply(req,{ok:false,error:'method_not_allowed'},405);
 const jwt=req.headers.get('authorization')?.match(/^Bearer\s+([^\s]+)$/i)?.[1];
 if(!jwt)return reply(req,{ok:false,error:'authentication_required'},401);
 let keys:Record<string,string>={};try{keys=JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS')||'{}')}catch{}
 const base=Deno.env.get('SUPABASE_URL')||'',secret=keys.default||Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||'';
 if(!base||!secret)return reply(req,{ok:false,error:'not_configured'},503);
 try{
  const sb=createClient(base,secret,{auth:{autoRefreshToken:false,persistSession:false}});
  const {data:account,error:authError}=await sb.auth.getUser(jwt);
  const user=account?.user;
  if(authError||!user?.email||!user.email_confirmed_at)return reply(req,{ok:false,error:'invalid_session'},401);
  const {data:access,error:accessError}=await sb.from('app_access_users').select('role,is_active')
   .eq('email',user.email.toLowerCase()).maybeSingle();
  if(accessError||!access?.is_active||access.role!=='owner')return reply(req,{ok:false,error:'owner_only'},403);
  if(new URL(req.url).search)return reply(req,{ok:false,error:'unsupported_query'},400);
  if(req.method==='GET'){
   const {data,error}=await sb.from('commission_quotes').select(QUOTE_SELECT)
    .eq('calculation_source','manual_quote_d20').order('quote_date',{ascending:false}).limit(201);
   if(error)throw error;
   if(!data||data.length>200)return reply(req,{ok:false,error:'too_many_quotes'},413);
   return reply(req,{ok:true,quotes:data,source:'owner_manual_quotes',payable:false});
  }
  const contentLength=Number(req.headers.get('content-length')||0);
  if(contentLength>15000)return reply(req,{ok:false,error:'request_too_large'},413);
  let body:unknown;try{body=await req.json()}catch{throw issue('invalid_json')}
  if(!obj(body)||!['create','update'].includes(String(body.action)))
   throw issue('invalid_action');
  const row=clean(body.quote);
  if(body.action==='create'){
   const {data,error}=await sb.from('commission_quotes').insert(row).select(QUOTE_SELECT).single();
   if(error?.code==='23505')return reply(req,{ok:false,error:'duplicate_reference'},409);
   if(error?.code==='23503')return reply(req,{ok:false,error:'unknown_client_id'},409);
   if(error)throw error;
   return reply(req,{ok:true,quote:data},201);
  }
  const id=body.id,expected=body.expected_updated_at;
  if(typeof id!=='string'||!UUID.test(id)||typeof expected!=='string'||!Number.isFinite(Date.parse(expected)))
   throw issue('invalid_update_version');
  // Never update imported/computed quotes. Version match prevents silent overwrites.
  const {data,error}=await sb.from('commission_quotes')
   .update({...row,updated_at:new Date().toISOString()})
   .eq('id',id).eq('calculation_source','manual_quote_d20').eq('updated_at',expected)
   .select(QUOTE_SELECT).maybeSingle();
  if(error?.code==='23505')return reply(req,{ok:false,error:'duplicate_reference'},409);
  if(error?.code==='23503')return reply(req,{ok:false,error:'unknown_client_id'},409);
  if(error)throw error;
  if(!data)return reply(req,{ok:false,error:'quote_conflict_reload'},409);
  return reply(req,{ok:true,quote:data});
 }catch(e){
  const known=['invalid_quote','invalid_reference','invalid_client_name','invalid_company','invalid_status',
   'invalid_quote_date','invalid_expected_decision_at','invalid_amount_ht','invalid_commission_estimate',
   'text_too_long','invalid_client_id','invalid_json','invalid_action','invalid_update_version'];
  const reason=e instanceof Error?e.message:'';
  return reply(req,{ok:false,error:known.includes(reason)?reason:'quote_service_unavailable'},
    known.includes(reason)?400:503);
 }
});
