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
 (typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=1_000_000_000&&Math.abs(Math.round(v*100)-v*100)<0.000001?v:null);
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

type SB = ReturnType<typeof createClient>;
function rate(tier:string, ratio:number) {
 if(ratio<=0)return tier==='A'?0.2:0.22254;
 if(tier==='B')return ratio>=1?0.3:0.22254+ratio*(0.3-0.22254);
 if(ratio>=0.8)return 0.3;
 if(ratio<=0.15)return 0.2+ratio/0.15*(0.2321-0.2);
 return 0.2321+(ratio-0.15)/0.65*(0.3-0.2321);
}
const round2=(v:number)=>Math.round((v+Number.EPSILON)*100)/100;
async function snapshot(sb:SB){
 const {data,error}=await sb.from('kino_catalog_snapshots')
 .select('id,item_count,status,source_completed_at').eq('status','complete')
 .order('source_completed_at',{ascending:false}).limit(1).maybeSingle();
 if(error||!data||data.item_count<1||data.item_count>1600)throw issue('catalog_unavailable',503);
 return data;
}
async function catalogSearch(sb:SB,company:string,q:string){
 if(!allowedCompany.has(company)||q.length<2||q.length>55)throw issue('invalid_search');
 const snap=await snapshot(sb);
 const {data,error}=await sb.from('kino_catalog_products')
  .select('snapshot_id,row_index,sku,product_name,company,tier,cost_eur,list_price_eur')
  .eq('snapshot_id',snap.id).eq('company',company).order('row_index').limit(1601);
 if(error||!data||data.length>1600)throw issue('catalog_unavailable',503);
 const needle=q.normalize('NFKC').toLocaleLowerCase('fr-FR').trim();
 const matches=data.filter(r=>(String(r.sku||'')+' '+String(r.product_name||''))
  .normalize('NFKC').toLocaleLowerCase('fr-FR').includes(needle)&&
   !/sample|échantillon|echantillon/i.test(String(r.sku||'')+' '+String(r.product_name||'')) &&
   ['A','B'].includes(String(r.tier)) && Number(r.cost_eur)>0);
 matches.sort((a,b)=>{
  const x=String(a.sku).toLowerCase(),y=String(b.sku).toLowerCase();
  return Number(y===needle)-Number(x===needle)||Number(y.startsWith(needle))-Number(x.startsWith(needle))||
   String(a.product_name).localeCompare(String(b.product_name),'fr');
 });
 return {snapshot_id:snap.id,source_completed_at:snap.source_completed_at,products:matches.slice(0,20)};
}
async function computeQuote(sb:SB,raw:Record<string,unknown>,company:string) {
 const lines=raw.lines;
 if(!Array.isArray(lines)||lines.length<1||lines.length>20)throw issue('invalid_quote_lines');
 const snap=await snapshot(sb);
 const indexes:number[]=[];
 for(const l of lines){
  if(!obj(l)||!Number.isSafeInteger(l.row_index)||Number(l.row_index)<0||
   l.snapshot_id!==snap.id||typeof l.sku!=='string')throw issue('catalog_changed',409);
  if(indexes.includes(l.row_index as number))throw issue('duplicate_product_line');
  indexes.push(l.row_index as number);
 }
 const {data:found,error}=await sb.from('kino_catalog_products')
 .select('row_index,sku,product_name,company,tier,cost_eur,list_price_eur')
 .eq('snapshot_id',snap.id).eq('company',company).in('row_index',indexes).limit(21);
 if(error||!found||found.length!==lines.length)throw issue('quote_catalog_mismatch',409);
 const map=new Map<number,Record<string,unknown>>();
 for(const p of found){
  if(map.has(p.row_index))throw issue('quote_catalog_mismatch',409);
  map.set(p.row_index,p);
 }
 let sumHT=0,sumCommission=0;const calculated=[];
 for(const row of lines){
  const p=map.get(row.row_index);
  if(!p||p.sku!==row.sku||!['A','B'].includes(p.tier as string)||
   /sample|échantillon|echantillon/i.test(String(p.sku)+' '+String(p.product_name)))
   throw issue('quote_catalog_mismatch',409);
  const qty=Number(row.quantity),price=Number(row.unit_price),cost=Number(p.cost_eur);
  if(!Number.isFinite(qty)||qty<=0||qty>100000||Math.abs(qty*1000-Math.round(qty*1000))>0.00001||
   !Number.isFinite(price)||price<=0||price>1000000||Math.abs(price*10000-Math.round(price*10000))>0.00001 ||
   !Number.isFinite(cost)||cost<=0||cost>1000000)throw issue('invalid_quote_unit_price');
  const effectiveCost=cost*(p.tier==='A'?1.25:1.15),unitMargin=price-effectiveCost;
  const ratio=unitMargin/cost,commission=Math.max(0,unitMargin*qty)*
   (unitMargin>0?rate(String(p.tier),ratio):0);
  const sales=qty*price;
  if(!Number.isFinite(sales)||!Number.isFinite(commission))throw issue('invalid_quote_forecast');
  sumHT+=sales;sumCommission+=commission;
  calculated.push({snapshot_id:snap.id,row_index:p.row_index,sku:p.sku,
   product_name:p.product_name,company:p.company,tier:p.tier,
   quantity:qty,unit_price:price,cost_eur:cost,
   sales_ht:round2(sales),commission_estimate:round2(commission),commission_rate:round2(rate(String(p.tier),ratio)*100),
   unit_confirmed:false,spiff:false});
 }
 if(sumHT>1_000_000_000||sumCommission>1_000_000_000)throw issue('invalid_quote_amount');
 return {amount_ht:round2(sumHT),commission_amount:round2(sumCommission),
  source_snapshot:snap.id,
  lines:calculated,method:'kino_browser_formula_provisional_without_spiff',unit_confirmed:false};
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
  const params=new URL(req.url).searchParams;
  if(req.method==='GET'&&params.get('mode')==='catalog'){
   try{
    const company=params.get('company')||'',search=params.get('q')||'';
    const result=await catalogSearch(sb,company,search);
    return reply(req,{ok:true,...result});
   }catch(e){
    const code=e instanceof Error?e.message:'';
    return reply(req,{ok:false,error:['invalid_search','catalog_unavailable'].includes(code)?code:'catalog_unavailable'},
      code==='invalid_search'?400:503);
   }
  }
  if([...params.keys()].length)return reply(req,{ok:false,error:'unsupported_query'},400);
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
  if(obj(body.quote)&&body.quote.mode==='automatic'){
    const computed=await computeQuote(sb,body.quote,row.company);
    row.amount_ht=computed.amount_ht;
    row.commission_amount=computed.commission_amount;
    row.source_payload={...row.source_payload,mode:'automatic',
     ...computed,commission_estimate_verified:false,origin:'kinosnapshot_user_quote'};
  }else if(obj(body.quote)&&body.quote.mode&&body.quote.mode!=='manual'){
    throw issue('invalid_quote_mode');
  }else{
    row.source_payload={...row.source_payload,mode:'manual'};
  }
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
   'text_too_long','invalid_client_id','invalid_json','invalid_action','invalid_update_version',
   'invalid_quote_mode','invalid_quote_lines','duplicate_product_line','invalid_quote_unit_price',
   'invalid_quote_amount','catalog_changed','quote_catalog_mismatch'];
  const reason=e instanceof Error?e.message:'';
  return reply(req,{ok:false,error:known.includes(reason)?reason:'quote_service_unavailable'},
    ['catalog_changed','quote_catalog_mismatch'].includes(reason)?409:known.includes(reason)?400:503);
 }
});
