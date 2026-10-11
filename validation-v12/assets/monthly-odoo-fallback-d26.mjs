// D26 read-only fallback for a month when the enriched commission pipeline fails.
// Uses a separately verified Odoo gateway; it NEVER converts a source sale into an earned commission.
const eligibleStates=new Set(['draft','sent','sale','done']);
const isoMonth=v=>typeof v==='string'&&/^\d{4}-(0[1-9]|1[0-2])$/.test(v);
const text=v=>typeof v==='string'?v:'';
const money=v=>typeof v==='number'&&Number.isFinite(v)?v:null;
export function normalizeMonthlyOdooSource(report,month){
 if(!isoMonth(month)||!report||report.source!=='odoo_live_read_only'||
  report.persisted!==false||report.commissions_are_calculated!==false||
  report.verified_commissions_eur!==null||report.source_order_status_rechecked!==true||
  !Array.isArray(report.orders)||report.orders.length>250||
  report.orders_count!==report.orders.length||
  report.period_from!==month+'-01'||report.period_to!==new Date(
   Date.UTC(+month.slice(0,4),+month.slice(5),0)).toISOString().slice(0,10))
  throw Error('invalid_monthly_source');
 const ids=new Set(),docs=[],excluded=[];
 for(const r of report.orders){
  if(!r||!Number.isSafeInteger(r.id)||r.id<=0||ids.has(r.id)||
   !['GTA','TR'].includes(r.company)||typeof r.state!=='string'||typeof r.date!=='string'||
   !Array.isArray(r.lines)||r.lines.length>1500||!text(r.reference)||!text(r.client)||
   !Number.isFinite(Date.parse(r.date)))throw Error('invalid_monthly_source');
  ids.add(r.id);
  if(r.date.slice(0,7)!==month)throw Error('invalid_monthly_source');
  if(!eligibleStates.has(r.state)){excluded.push(r);continue}
  if(money(r.amount_ht)===null&&r.amount_ht!==null)throw Error('invalid_monthly_source');
  const lines=r.lines.map(l=>{
   if(!l||!Number.isSafeInteger(l.id)||l.id<=0||typeof l.sku!=='string'||
    typeof l.product_name!=='string')throw Error('invalid_monthly_source');
   return {id:l.id,sku:l.sku,product:l.product_name};
  });
  docs.push({id:r.id,reference:r.reference,client:r.client,company:r.company,
   date:r.date,state:r.state,invoiceStatus:'non consulté',currency:text(r.currency)||null,
   amountHT:r.amount_ht,stage:['draft','sent'].includes(r.state)?'en_cours':'confirme',
   forecast:null,lines,matchedLines:0,unmatchedLines:lines.length,excludedLines:0,
   excludedMonetaryLines:0,partial:false,issues:[]});
 }
 return {orders:docs,excludedCount:excluded.length,readAt:report.source_order_status_checked_at,
  source:'commission-catalog-review',month,coverage:'current_month_seller_only',enriched:false};
}
