// D25 — Pure monthly view on top of the owner-only Odoo pipeline.
// No extra source, claims of earned commissions, or Odoo writes.
import {filterOdooPipeline,odooPipelineTotals} from './odoo-commission-model-d24.mjs';
const validMonth=value=>typeof value==='string'&&/^\d{4}-(0[1-9]|1[0-2])$/.test(value);
export function currentCommissionMonth(now=new Date()){
 if(!(now instanceof Date)||!Number.isFinite(now.getTime()))throw Error('invalid_month');
 return String(now.getFullYear()).padStart(4,'0')+'-'+String(now.getMonth()+1).padStart(2,'0');
}
export function shiftCommissionMonth(month,delta){
 if(!validMonth(month)||!Number.isSafeInteger(delta)||Math.abs(delta)>120)throw Error('invalid_month');
 const [year,m]=month.split('-').map(Number);
 const date=new Date(Date.UTC(year,m-1+delta,1));
 if(!Number.isFinite(date.getTime()))throw Error('invalid_month');
 return date.getUTCFullYear()+'-'+String(date.getUTCMonth()+1).padStart(2,'0');
}
export function labelCommissionMonth(month){
 if(!validMonth(month))throw Error('invalid_month');
 return new Intl.DateTimeFormat('fr-FR',{month:'long',year:'numeric',timeZone:'UTC'})
  .format(new Date(month+'-01T12:00:00Z'));
}
function group(orders){
 const totals=odooPipelineTotals(orders);
 return {
  orders,count:orders.length,
  forecast:totals.forecastCount>0?totals.forecast:null,
  estimatedCount:totals.forecastCount,
  unavailableCount:orders.length-totals.forecastCount,
  partialCount:totals.forecastPartial,
  blockedCount:totals.blocked
 };
}
export function summarizeCommissionMonth(data,{month,company='all',query=''}={}){
 if(!validMonth(month))throw Error('invalid_month');
 if(!data||!Array.isArray(data.orders))throw Error('invalid_monthly_source');
 // Filter on source order date, never on a payment date inferred from invoicing.
 const selected=filterOdooPipeline(data,{company,query}).filter(o=>
  typeof o.date==='string'&&o.date.slice(0,7)===month);
 const pending=selected.filter(o=>o.stage==='en_cours');
 const confirmed=selected.filter(o=>o.stage==='confirme'||o.stage==='facture');
 if(pending.length+confirmed.length!==selected.length)throw Error('invalid_stage');
 return {month,pending:group(pending),confirmed:group(confirmed),
  validated:{amount:null,available:false,reason:'Aucune preuve de commission acquise ou payée dans les sources.'},
  totalDocuments:selected.length};
}
