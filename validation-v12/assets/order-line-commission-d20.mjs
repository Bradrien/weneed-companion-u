// D20: share the already guarded Kino simulation with the Orders product detail.
// Never infer "owed" commission from Odoo, or treat missing SKU as payable.
import {simulateOdooReport,SCENARIO_REASONS} from './commission-scenario-d8.mjs';
const safe=(v)=>typeof v==='number'&&Number.isFinite(v);
export function buildOrderLineCommissions(report){
 const data={status:'no_report',simulations:new Map(),excluded:new Map(),orders:new Map(),note:
  'Estimation conditionnelle, non validée par le moteur serveur Kino'};
 if(!report)return data;
 let simulated;
 try{simulated=simulateOdooReport(report)}
 catch{return {...data,status:'invalid_report'};}
 if(!simulated)return data;
 const key=(a,b)=>String(a)+'|'+String(b);
 for(const x of simulated.ready){
  if(!safe(x.commission)||!safe(x.margin)||!safe(x.rate))continue;
  const k=key(x.order_id,x.line_id);
  if(data.simulations.has(k))return {...data,status:'invalid_report',simulations:new Map(),orders:new Map()};
  const entry={commission:x.commission,rate:x.rate,costPerAssumedUnit:x.cost_per_assumed_unit,
   quantity:x.quantity,reference:x.reference,rateVerified:false};
  data.simulations.set(k,entry);
  if(!data.orders.has(x.order_id))data.orders.set(x.order_id,{amount:0,simulatedLines:0,excludedLines:0});
  const group=data.orders.get(x.order_id);group.amount+=x.commission;group.simulatedLines++;
 }
 for(const x of simulated.excluded){
  const k=key(x.order_id,x.line_id);
  if(data.excluded.has(k)||data.simulations.has(k))
   return {...data,status:'invalid_report',simulations:new Map(),excluded:new Map(),orders:new Map()};
  data.excluded.set(k,{reason:x.reason,label:SCENARIO_REASONS[x.reason]||'Non vérifié'});
  if(!data.orders.has(x.order_id))data.orders.set(x.order_id,{amount:0,simulatedLines:0,excludedLines:0});
  data.orders.get(x.order_id).excludedLines++;
 }
 return {...data,status:'ok',sourceStatusCheckedAt:simulated.sourceStatusCheckedAt};
}
export function lineCommission(index,orderId,lineId){
 if(index?.status!=='ok')return {status:'unavailable',reason:'Le rapport n’autorise pas la simulation'};
 const key=String(orderId)+'|'+String(lineId);
 const eligible=index.simulations.get(key);
 if(eligible)return {status:'simulated',...eligible};
 const excluded=index.excluded.get(key);
 return excluded?{status:'excluded',reason:excluded.label}:{status:'unavailable',reason:'Ligne absente du scénario'};
}
