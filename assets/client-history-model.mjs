/** Bounded, strictly identity-scoped read-only Odoo partner history. */
const number=x=>typeof x==='number'&&Number.isFinite(x)?x:null;
export function normalizePartnerHistory(input,partnerId){
 if(!Number.isSafeInteger(partnerId)||partnerId<=0||!input||
  input.source!=='odoo_partner_history_read_only'||input.identity_verified!==false||
  input.partner_odoo_id!==partnerId||!Array.isArray(input.orders)||
  input.orders.length>250||typeof input.checked_at!=='string'||
  !Number.isFinite(Date.parse(input.checked_at)))
  throw Error('invalid_partner_history');
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
  statuses,totals:possibleCurrencies.size?null:totals};
}
