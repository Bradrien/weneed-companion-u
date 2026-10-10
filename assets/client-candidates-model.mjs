/** Unverified candidate identities found via seller-owned Odoo orders and exact partner name. */
export function normalizeOdooCandidates(payload,clientId){
 if(!payload||payload.client_id!==clientId||payload.matching!=='exact_partner_name_and_salesperson_orders'||
  payload.verified!==false||payload.complete!==false||
  !Array.isArray(payload.candidates)||payload.candidates.length>12||
  !Number.isSafeInteger(payload.sampled_orders)||payload.sampled_orders<0||payload.sampled_orders>120)
  throw Error('invalid_odoo_candidates');
 const ids=new Set();
 return {
  partial:true,sampledOrders:payload.sampled_orders,
  candidates:payload.candidates.map(x=>{
   if(!x||!Number.isSafeInteger(x.partner_odoo_id)||x.partner_odoo_id<=0||
    ids.has(x.partner_odoo_id)||typeof x.name!=='string'||!x.name.trim()||
    !Number.isSafeInteger(x.examples)||x.examples<=0||x.examples>120)
    throw Error('invalid_odoo_candidates');
   ids.add(x.partner_odoo_id);
   return {partnerId:x.partner_odoo_id,name:x.name.slice(0,160),
    exampleCount:x.examples,lastDate:typeof x.last_date==='string'?x.last_date.slice(0,10):''};
  })
 };
}
