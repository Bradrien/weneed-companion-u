/** Source-backed commercial digest. Derived on demand and never stored as confirmed facts. */
const finite=x=>typeof x==='number'&&Number.isFinite(x)?x:null;
const date=x=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}/.test(x)?x.slice(0,10):'';
const safe=(x,max=280)=>typeof x==='string'?x.slice(0,max):'';
/**
 * Odoo claims are included only when the exact partner link was owner-approved.
 * CRM messages/documents remain claims with their provenance, never receipts.
 */
export function buildCommercialMemory(card,full,history){
 if(!card?.profile||typeof card.profile.name!=='string')throw Error('invalid_memory_input');
 const linkedId=card.odooPartnerLink?.partnerId;
 const backed=Number.isSafeInteger(linkedId)&&linkedId>0&&history&&
  history.partnerOdooId===linkedId&&Array.isArray(history.orders);
 const timeline=[];
 if(backed){
  for(const order of history.orders){
   if(!['sale','done','cancel'].includes(order.state))continue;
   timeline.push({date:date(order.date),source:'odoo',status:['sale','done'].includes(order.state)?'confirmed_order':'cancelled_order',
    title:safe(order.reference,90)+' · '+safe(order.company,10),
    detail:safe(order.state,30),amount:finite(order.amount),currency:safe(order.currency,8),
    ref:'Odoo sale.order '+safe(order.reference,90)});
  }
 }
 for(const e of Array.isArray(card.activity)?card.activity.slice(0,30):[]){
  const d=date(e.when);if(!d||!e.body)continue;
  timeline.push({date:d,source:safe(e.source,30)||'crm',status:'exchange_unverified',
   title:safe(e.type,70)||'Échange CRM',detail:safe(e.body,250),amount:null,currency:'',
   ref:'CRM activité · '+d});
 }
 timeline.sort((a,b)=>b.date.localeCompare(a.date));
 const taskList=Array.isArray(card.attention?.tasks)?card.attention.tasks.slice(0,20):[];
 const tasks=taskList.map(t=>({title:safe(t.title,180),description:safe(t.description,280),
  dueAt:date(t.dueAt),source:'CRM tâche',status:'to_review'}))
  .filter(t=>t.title);
 const openLoops=Array.isArray(full?.openLoops)?full.openLoops.slice(0,15).map(t=>({
  title:safe(t.title,180),description:safe(t.description,280),source:'CRM extraction automatique',
  status:'unverified'})).filter(t=>t.title):[];
 const facts=Array.isArray(full?.facts)?full.facts.slice(0,20).filter(t=>t.text).map(f=>({
  type:safe(f.type,50),title:safe(f.text,280),source:'CRM extrait de conversation',
  status:'unverified'})):[];
 const business=Array.isArray(full?.businessObjects)?full.businessObjects.slice(0,25).map(o=>({
  ref:safe(o.reference,140),kind:safe(o.type,35),status:safe(o.status,45),amount:finite(o.amount),
  currency:safe(o.currency,8),date:date(o.observedAt),source:'CRM document, non rapproché de la comptabilité'
 })).filter(o=>o.ref):[];
 const conversations=Array.isArray(full?.conversations)?full.conversations.slice(0,25).map(o=>({
  source:safe(o.source,40),title:safe(o.title,150),date:date(o.updatedAt)
 })).filter(o=>o.title):[];
 const orders=backed?history.orders.filter(o=>['sale','done','cancel'].includes(o.state)):[];
 const confirmed=orders.filter(o=>['sale','done'].includes(o.state));
 const cancelled=orders.filter(o=>o.state==='cancel');
 const confirmedTotal=backed&&history.totals&&Number.isFinite(history.totals.GTA)&&Number.isFinite(history.totals.TR)?
  {GTA:history.totals.GTA,TR:history.totals.TR}:null;
 return {
  title:card.profile.name,odooBacked:Boolean(backed),
  period:backed?{from:date(history.from),to:date(history.to),checkedAt:safe(history.checkedAt,40)}:null,
  orders:{confirmed:confirmed.length,cancelled:cancelled.length,total:orders.length,
   lastConfirmed:confirmed.map(o=>date(o.date)).sort().reverse()[0]||null,confirmedTotal},
  timeline:timeline.slice(0,40),tasks,openLoops,facts,business,conversations,
  provenance:{odoo:backed?'Partenaire confirmé par le propriétaire · commandes Odoo en lecture seule':'Aucun partenaire Odoo lié ou historique non chargé',
    crm:'CRM · documents et messages non vérifiés par la comptabilité'},
  certainty:'Les commandes au statut confirmé ne prouvent ni facture acquittée ni encaissement. Les échanges ne prouvent pas les paiements.'
 };
}
