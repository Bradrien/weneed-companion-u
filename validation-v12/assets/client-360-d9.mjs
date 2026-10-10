/**
 * Private client-360 API boundary. Only read-only facts, not a verified
 * Odoo/order linkage or evidence that payment was received.
 */
const UUID=/^[a-f\d]{8}-[a-f\d]{4}-[1-5][a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i;
const str=(x,n=400)=>typeof x==='string'?x.slice(0,n):'';
const entries=(x,n)=>Array.isArray(x)?x.slice(0,n).filter(y=>y&&typeof y==='object'&&!Array.isArray(y)):[];
const finite=(x)=>typeof x==='number'&&Number.isFinite(x)?x:null;
export function normalizeClient360(v,id){
 if(!v||typeof v!=='object'||Array.isArray(v)||!v.profile||!UUID.test(id)||
  v.profile.id!==id)throw Error('invalid_client_360');
 const memory=v.memory&&typeof v.memory==='object'?v.memory:{};
 const facts=entries(v.key_facts,40).map(f=>{
  const value=f.value&&typeof f.value==='object'&&!Array.isArray(f.value)?f.value:{};
  return{type:str(f.type,40),status:str(f.status,35),confidence:finite(f.confidence),
   text:str(value.text,450),amount:finite(value.amount),currency:str(value.currency,8),
   createdAt:str(f.created_at,40)};
 });
 return {
  profileId:id,
  opportunities:entries(memory.opportunities,20).map(x=>({title:str(x.title,150),description:str(x.description,400)})),
  productsPrices:entries(memory.products_prices,20).map(x=>({name:str(x.name,150),description:str(x.description,300)})),
  openLoops:entries(memory.open_loops,20).map(x=>({title:str(x.title,150),description:str(x.description,300)})),
  businessObjects:entries(v.business_objects,60).map(o=>({
   id:str(o.id,50),type:str(o.type,40),reference:str(o.key,160),
   status:str(o.status,50),amount:finite(o.amount),currency:str(o.currency,8),
   observedAt:str(o.last_seen_at,40)
  })),
  conversations:entries(v.conversations,30).map(c=>({
   id:str(c.id,50),source:str(c.source,40),title:str(c.title,190),
   updatedAt:str(c.last_event_at,40)
  })),
  facts,
  staleTasks:entries(v.stale_tasks,30).map(t=>({
   title:str(t.title,180),description:str(t.description,350),
   reason:str(t.actionability_reason,150),dueAt:str(t.due_at,40)
  }))
 };
}
const canon=s=>typeof s==='string'?s.normalize('NFKC').trim().toLocaleLowerCase('fr-FR').replace(/\s+/g,' '):'';
/** Only an exact display-name proposal from a period-specific Odoo report.
 * Without a verified partner_id -> client_id link, this is never authoritative.
 * Avoid broad substring or fuzzy matching, including matching child shops.
 */
export function proposePeriodOdooOrders(crmName,report){
 const needle=canon(crmName);
 if(needle.length<3||!report||!Array.isArray(report.orders))return[];
 return report.orders.filter(o=>o&&canon(o.client)===needle&&
  (o.company==='GTA'||o.company==='TR')&&
  typeof o.reference==='string'&&o.reference.length>0)
  .slice(0,50).map(o=>({
   id:o.id,reference:str(o.reference,80),company:o.company,state:str(o.state,30),
   date:str(o.date,40),amount:finite(o.amount_ht),currency:str(o.currency,8)
  }));
}
