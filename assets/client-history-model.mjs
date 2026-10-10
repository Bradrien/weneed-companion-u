/** Bounded, strictly identity-scoped read-only Odoo partner history. */
const number=x=>typeof x==='number'&&Number.isFinite(x)?x:null;
export function normalizePartnerHistory(input,partnerId){
 if(!Number.isSafeInteger(partnerId)||partnerId<=0||!input||
  input.source!=='odoo_partner_history_read_only'||input.identity_verified!==false||
  input.partner_odoo_id!==partnerId||!Array.isArray(input.orders)||
  input.orders.length>250||typeof input.checked_at!=='string'||
  !Number.isFinite(Date.parse(input.checked_at)))
  throw Error('invalid_partner_history');
 const p=input.partner;
 let partner=null;
 if(p!==null&&p!==undefined){
  if(typeof p!=='object'||p.id!==partnerId)throw Error('invalid_partner_history');
  const safe=(x,n)=>typeof x==='string'?x.slice(0,n):'';
  partner={id:partnerId,name:safe(p.name,160),email:safe(p.email,180),
   phone:safe(p.phone,50),mobile:safe(p.mobile,50),street:safe(p.street,180),
   zip:safe(p.zip,24),city:safe(p.city,100),
   parentOdooId:Number.isSafeInteger(p.parent_odoo_id)&&p.parent_odoo_id>0?p.parent_odoo_id:null};
 }
 const seen=new Set();
 const orders=input.orders.map(x=>{
  if(!x||!Number.isSafeInteger(x.id)||x.id<=0||seen.has(x.id)||
   x.partner_odoo_id!==partnerId||!['GTA','TR'].includes(x.company)||
   typeof x.reference!=='string'||!x.reference||
   typeof x.date!=='string'||!/^\d{4}-\d{2}-\d{2}/.test(x.date)||
   typeof x.state!=='string'||!x.state)
   throw Error('invalid_partner_history');
  seen.add(x.id);
  return {id:x.id,partnerOdooId:partnerId,reference:x.reference.slice(0,100),
   company:x.company,date:x.date.slice(0,10),state:x.state.slice(0,40),
   amount:number(x.amount_ht),currency:typeof x.currency==='string'?x.currency.slice(0,8):null};
 });
 const statuses={confirmed:0,cancelled:0,other:0};
 const totals={GTA:0,TR:0},possibleCurrencies=new Set();
 for(const order of orders){
  if(['sale','done'].includes(order.state)){
   statuses.confirmed++;
   if(order.currency!=='EUR'||order.amount===null)possibleCurrencies.add('missing_or_non_EUR');
   else totals[order.company]+=order.amount;
  }else if(order.state==='cancel')statuses.cancelled++;
  else statuses.other++;
 }
 orders.sort((a,b)=>b.date.localeCompare(a.date)||b.id-a.id);
 return {partnerOdooId:partnerId,orders,checkedAt:input.checked_at,
  from:input.period_from,to:input.period_to,identityVerified:false,
  partner,
  statuses,totals:possibleCurrencies.size?null:totals};
}

const norm=x=>typeof x==='string'?x.normalize('NFKC').trim().toLocaleLowerCase('fr-FR').replace(/\s+/g,' '):'';
const phone=x=>{
 const digits=(typeof x==='string'?x:'').replace(/\D/g,'');
 if(!digits)return '';
 return digits.startsWith('33')&&digits.length===11?'0'+digits.slice(2):digits;
};
/** Diagnostic evidence only, never an automatic CRM-to-Odoo merge or verified link. */
export function assessPartnerIdentity(profile,contacts,partner){
 if(!partner||typeof partner!=='object')return null;
 const names=[profile?.name,profile?.canonical_name].filter(Boolean).map(norm);
 const emails=(Array.isArray(contacts)?contacts:[])
   .flatMap(c=>Array.isArray(c?.channels)?c.channels:[])
   .filter(c=>c?.type==='email').map(c=>norm(c.value)).filter(Boolean);
 const phones=(Array.isArray(contacts)?contacts:[])
   .flatMap(c=>Array.isArray(c?.channels)?c.channels:[])
   .filter(c=>c?.type==='phone').map(c=>phone(c.value)).filter(Boolean);
 const partnerPhones=[phone(partner.phone),phone(partner.mobile)].filter(Boolean);
 return {nameMatch:!!norm(partner.name)&&names.includes(norm(partner.name)),
  emailMatch:!!norm(partner.email)&&emails.includes(norm(partner.email)),
  phoneMatch:partnerPhones.some(v=>phones.includes(v)),verified:false,
  evidenceAvailable:emails.length>0||phones.length>0};
}
