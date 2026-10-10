// D22: Odoo stage is authoritative; invoice_status is NOT proof of payment.
const STAGES=['en_cours','confirme','facture'];
export const statusLabels=Object.freeze({
 en_cours:'Devis en cours',confirme:'Commandes confirmées non entièrement facturées',
 facture:'Facturées (statut Odoo)'});
const money=x=>typeof x==='number'&&Number.isFinite(x)&&x>=0?x:null;
export function normalizeOdooPipeline(input){
 if(!input||input.version!=='odoo_commission_pipeline_v1'||!Array.isArray(input.orders)||
  input.orders.length>1600||input.scope!=='owner_odoo_salesperson_read_only_states_and_invoice_status_rechecked'||
  input.invoicing_semantics!=='sale.order.invoice_status_not_payment_status'||
  input.formula!=='kino_browser_formula_provisional_without_spiff_units_unverified'||
  !Number.isFinite(Date.parse(input.read_at)))throw Error('invalid_odoo_pipeline');
 const ids=new Set();
 const orders=input.orders.map(o=>{
  if(!o||!Number.isSafeInteger(o.id)||o.id<1||ids.has(o.id)||
   typeof o.reference!=='string'||typeof o.client!=='string'||
   !['GTA','TR'].includes(o.company)||!['draft','sent','sale','done'].includes(o.state)||
   typeof o.invoice_status!=='string'||!['EUR'].includes(o.currency)||
   typeof o.date!=='string'||!Number.isFinite(Date.parse(o.date))||
   !Array.isArray(o.lines)||o.lines.length>4500||!Number.isSafeInteger(o.matched_lines)||
   !Number.isSafeInteger(o.unmatched_lines)||o.matched_lines<0||o.unmatched_lines<0)
   throw Error('invalid_odoo_pipeline_order');
  const stage=['draft','sent'].includes(o.state)?'en_cours':
   o.invoice_status==='invoiced'?'facture':'confirme';
  if(stage!==o.stage)throw Error('odoo_stage_mismatch');
  ids.add(o.id);
  const lines=o.lines.map(l=>{
   if(!l||!Number.isSafeInteger(l.line_id)||typeof l.product!=='string'||
    typeof l.reason!=='string')throw Error('invalid_odoo_line');
   return {id:l.line_id,product:l.product.slice(0,180),sku:String(l.sku||'').slice(0,100),
    quantity:money(l.quantity),unit:String(l.unit||'').slice(0,50),
    subtotalHT:money(l.subtotal_ht),commissionEstimate:money(l.commission_estimate),
    reason:l.reason};
  });
  if(lines.filter(l=>l.commissionEstimate!==null).length!==o.matched_lines)throw Error('invalid_line_coverage');
  if(o.forecast!==null&&
   (o.matched_lines===0||money(o.forecast)===null))throw Error('invalid_odoo_forecast');
  return {id:o.id,reference:o.reference.slice(0,120),client:o.client.slice(0,180),
   company:o.company,date:o.date,state:o.state,invoiceStatus:o.invoice_status,
   stage,amountHT:money(o.amount_ht),forecast:money(o.forecast),
   matchedLines:o.matched_lines,unmatchedLines:o.unmatched_lines,lines};
 });
 return {orders,readAt:input.read_at,closedWindowFrom:input.closed_window_from,
  pendingScope:input.pending_scope,catalogSnapshotAt:input.catalog_snapshot_at};
}
export function filterOdooPipeline(data,{stage='all',stages=null,company='all',query=''}={}){
 if(!data)return [];
 if(stage!=='all'&&!STAGES.includes(stage))throw Error('invalid_filter');
 const active=stages===null?null:new Set(stages);
 if(active&&(active.size!==stages.length||stages.some(x=>!STAGES.includes(x))))throw Error('invalid_filter');
 if(company!=='all'&&!['GTA','TR'].includes(company))throw Error('invalid_filter');
 const q=query.trim().toLocaleLowerCase('fr-FR');
 return data.orders.filter(o=>(active?active.has(o.stage):(stage==='all'||o.stage===stage))&&
  (company==='all'||o.company===company)&&(!q||[o.reference,o.client,o.company,
   ...o.lines.map(l=>l.product+' '+l.sku)].join(' ').toLocaleLowerCase('fr-FR').includes(q)));
}
export function odooPipelineTotals(orders){
 const total={en_cours:0,confirme:0,facture:0,forecastCount:0,forecastPartial:0,
  forecast:0,orders:orders.length,amountHT:0,amountKnown:0};
 for(const x of orders){
  if(!STAGES.includes(x.stage))throw Error('invalid_stage');
  total[x.stage]++;
  if(x.amountHT!==null){total.amountHT+=x.amountHT;total.amountKnown++}
  if(x.forecast!==null){total.forecastCount++;total.forecast+=x.forecast;
   if(x.unmatchedLines>0)total.forecastPartial++;}
 }
 total.forecast=Math.round(total.forecast*100)/100;
 return total;
}
