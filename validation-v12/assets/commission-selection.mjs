import {selectedCommissionOrders} from './commission-audit-d31.mjs?v=v1-1';
import {odooPipelineTotals} from './odoo-commission-model-d30.mjs?v=v1-1';
export const COMMISSION_STATUSES=Object.freeze([
 {key:'draft',label:'À valider',hint:'Devis brouillons, pas encore envoyés.'},
 {key:'sent',label:'En cours',hint:'Devis envoyés, en attente de confirmation.'},
 {key:'confirmed',label:'Validés',hint:'Commandes confirmées, pas encore entièrement facturées.'},
 {key:'invoiced',label:'Facturés',hint:'Commandes entièrement facturées. Ce statut ne signifie pas qu’elles sont payées.'}
]);
export const defaultCommissionStatuses=()=>new Set(['confirmed','invoiced']);
export function commissionStatus(order){
 if(order.state==='draft')return 'draft';
 if(order.state==='sent')return 'sent';
 return order.stage==='facture'?'invoiced':'confirmed';
}
export function commissionGroup(orders){
 const t=odooPipelineTotals(orders);
 return {orders,count:orders.length,forecast:!orders.length?0:t.forecastCount?t.forecast:null,
  estimatedCount:t.forecastCount,unavailableCount:orders.length-t.forecastCount,
  partialCount:t.forecastPartial,blockedCount:t.blocked};
}
export function selectCommissions(data,{month,company='all',query='',statuses=defaultCommissionStatuses()}={}){
 const candidates=selectedCommissionOrders(data,{month,company,query});
 const counts=Object.fromEntries(COMMISSION_STATUSES.map(s=>[s.key,0]));
 for(const order of candidates)counts[commissionStatus(order)]++;
 const orders=candidates.filter(o=>statuses.has(commissionStatus(o)));
 return {...commissionGroup(orders),counts,
  companies:Object.fromEntries(['TR','GTA'].map(c=>[c,commissionGroup(orders.filter(o=>o.company===c))])),
  potentialCount:orders.filter(o=>o.stage==='en_cours').length};
}
