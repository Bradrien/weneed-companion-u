/** Strict, read-only client API boundary; no persistence or personal data in URLs except opaque IDs. */
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const str=(value,max=1200)=>typeof value==='string'?value.slice(0,max):'';
const count=value=>Number.isSafeInteger(value)&&value>=0?value:0;
export const validClientId=value=>typeof value==='string'&&UUID.test(value);
export function normalizeClientList(value){
 if(!Array.isArray(value)||value.length>100)throw Error('invalid_clients');
 const ids=new Set();
 return value.map(item=>{
  if(!item||!validClientId(item.client_id)||typeof item.canonical_name!=='string'||!item.canonical_name.trim()||ids.has(item.client_id))throw Error('invalid_clients');
  ids.add(item.client_id);
  return {id:item.client_id,name:str(item.canonical_name,180),status:str(item.status,60),
   summary:str(item.summary,400),lastActivity:str(item.last_activity_at,40),
   openTasks:count(item.open_task_count),overdueTasks:count(item.overdue_task_count),
   events:count(item.event_count)};
 });
}
export function normalizeOdooLink(value){
 if(value===null||value===undefined)return null;
 if(!value||typeof value!=='object'||Array.isArray(value)||
  !Number.isSafeInteger(value.partner_odoo_id)||value.partner_odoo_id<=0||
  value.confirmed_by!=='owner_explicit'||
  typeof value.confirmed_at!=='string'||!Number.isFinite(Date.parse(value.confirmed_at)))
  throw Error('invalid_odoo_link');
 return {partnerId:value.partner_odoo_id,confirmedAt:value.confirmed_at,confirmedBy:'owner_explicit'};
}
export function normalizeClientCard(value,expectedId){
 if(!value||typeof value!=='object'||Array.isArray(value)||!value.profile||
   !validClientId(value.profile.id)||value.profile.id!==expectedId||
   typeof value.profile.name!=='string'||!value.profile.name.trim())throw Error('invalid_client');
 const contacts=Array.isArray(value.contacts)?value.contacts.slice(0,100):[];
 const tasks=Array.isArray(value.attention?.tasks)?value.attention.tasks.slice(0,100):[];
 const recent=Array.isArray(value.activity?.recent)?value.activity.recent.slice(0,100):[];
 return {
  profile:{name:str(value.profile.name,180),status:str(value.profile.status,60),
   address:str(value.profile.address,250),country:str(value.profile.country,80),
   notes:str(value.profile.notes,1200)},
  memory:str(value.memory?.summary,1800),
  odooPartnerLink:normalizeOdooLink(value.odoo_partner_link),
  contacts:contacts.filter(x=>x&&typeof x==='object').map(c=>({
   name:str(c.name,180),role:str(c.role,80),
   channels:Array.isArray(c.channels)?c.channels.slice(0,30).filter(x=>x&&typeof x==='object').map(ch=>({type:str(ch.type,30),value:str(ch.value,200)})):[]
  })),
  attention:{openTasks:count(value.attention?.open_task_count),overdueTasks:count(value.attention?.overdue_task_count),
   tasks:tasks.filter(x=>x&&typeof x==='object').map(t=>({title:str(t.title,250),description:str(t.description,450),dueAt:str(t.due_at,40)}))},
  activity:recent.filter(x=>x&&typeof x==='object').map(e=>({source:str(e.source,40),type:str(e.type,50),
   when:str(e.occurred_at,40),body:str(e.body,500)}))
 };
}

export function normalizeCrmDashboard(value){
 if(!value||typeof value!=='object'||Array.isArray(value)||!value.stats||typeof value.stats!=='object')
  throw Error('invalid_crm_dashboard');
 const s=value.stats;
 return {
  clients:count(s.clients_total),attentionCount:count(s.clients_needing_attention),
  tasks:count(s.open_actionable_tasks),overdue:count(s.overdue_actionable_tasks),
  attention:normalizeClientList(Array.isArray(value.attention_clients)?value.attention_clients.slice(0,10):[]),
  unassigned:(Array.isArray(value.unassigned_actionable_tasks)?value.unassigned_actionable_tasks.slice(0,10):[])
   .filter(x=>x&&typeof x==='object').map(t=>({title:str(t.title,250),dueAt:str(t.due_at,40)}))
 };
}
