// D20 manual quotes are forecasts only, never payable commissions.
export const quoteStatusLabels=Object.freeze({en_cours:'En cours',valide:'Validé',facture:'Facturé (déclaratif)',annule:'Annulé'});
const STATUSES=new Set(Object.keys(quoteStatusLabels));
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const money=x=>typeof x==='number'&&Number.isFinite(x)&&x>=0?x:null;
const text=(x,n)=>typeof x==='string'?x.slice(0,n):'';
export function normalizeQuotes(value){
 if(!Array.isArray(value)||value.length>200)throw Error('invalid_quotes');
 return value.map(q=>{
  if(!q||!UUID.test(q.id)||typeof q.reference!=='string'||typeof q.client_name!=='string'||
   !STATUSES.has(q.status)||!['GTA','TR'].includes(q.company)||
   !/^\d{4}-\d{2}-\d{2}$/.test(q.quote_date)||
   !Number.isFinite(Date.parse(q.updated_at))||q.calculation_source!=='manual_quote_d20')
   throw Error('invalid_quote_record');
  return {id:q.id,reference:text(q.reference,75),client_name:text(q.client_name,160),
   client_id:UUID.test(q.client_id)?q.client_id:null,quote_date:q.quote_date,
   expected_decision_at:typeof q.expected_decision_at==='string'?q.expected_decision_at:null,
   company:q.company,status:q.status,amount_ht:money(q.amount_ht),
   commission_amount:money(q.commission_amount),
   notes:text(q.source_payload?.notes,1200),products:text(q.source_payload?.products,450),
   mode:q.source_payload?.mode==='automatic'?'automatic':'manual',
   lines:Array.isArray(q.source_payload?.lines)?q.source_payload.lines.slice(0,20).map(l=>({
    snapshot_id:text(l?.snapshot_id,40),row_index:Number(l?.row_index),sku:text(l?.sku,90),
    product_name:text(l?.product_name,160),company:text(l?.company,5),tier:text(l?.tier,2),
    cost_eur:Number(l?.cost_eur),quantity:Number(l?.quantity),unit_price:Number(l?.unit_price),
    sales_ht:Number(l?.sales_ht),commission_estimate:Number(l?.commission_estimate)
   })).filter(l=>Number.isInteger(l.row_index)&&l.sku&&['A','B'].includes(l.tier)):[],
   updated_at:q.updated_at,created_at:q.created_at};
 });
}
export function quoteStats(quotes){
 const out={totalCount:quotes.length,pendingCount:0,pendingHt:0,pendingHtKnown:0,
  forecastCommission:0,forecastKnown:0,validatedCount:0,invoicedCount:0,cancelledCount:0};
 for(const q of quotes){
  if(q.status==='en_cours'){
   out.pendingCount++;
   if(q.amount_ht!==null){out.pendingHt+=q.amount_ht;out.pendingHtKnown++}
   if(q.commission_amount!==null){out.forecastCommission+=q.commission_amount;out.forecastKnown++}
  }else if(q.status==='valide')out.validatedCount++;
  else if(q.status==='facture')out.invoicedCount++;
  else if(q.status==='annule')out.cancelledCount++;
 }
 return out;
}
export function prepareQuote(values){
 const reference=String(values.reference||'').trim().toUpperCase(),clientName=String(values.client_name||'').trim();
 if(!/^[A-Z0-9][A-Z0-9_./-]{2,74}$/.test(reference))throw Error('invalid_reference');
 if(clientName.length<2||clientName.length>160)throw Error('invalid_client_name');
 if(!['GTA','TR'].includes(values.company))throw Error('invalid_company');
 if(!STATUSES.has(values.status))throw Error('invalid_status');
 if(!/^\d{4}-\d{2}-\d{2}$/.test(values.quote_date)||Number.isNaN(Date.parse(values.quote_date)))throw Error('invalid_quote_date');
 const optionalCurrency=v=>{
  const s=String(v??'').trim().replace(',','.');
  if(!s)return null;
  const x=Number(s);
  if(!/^\d{1,9}(?:\.\d{1,2})?$/.test(s)||!Number.isFinite(x)||x<0)return NaN;
  return x;
 };
 const amount_ht=optionalCurrency(values.amount_ht),commission_amount=optionalCurrency(values.commission_amount);
 if(Number.isNaN(amount_ht)||Number.isNaN(commission_amount))throw Error('invalid_currency');
 if(String(values.notes||'').length>1200||String(values.products||'').length>450)throw Error('text_too_long');
 const expected=String(values.expected_decision_at||'').trim();
 if(expected&&(!/^\d{4}-\d{2}-\d{2}$/.test(expected)||Number.isNaN(Date.parse(expected))))throw Error('invalid_expected_decision_date');
 return {reference,client_name:clientName,client_id:values.client_id||null,quote_date:values.quote_date,
  expected_decision_at:expected||null,company:values.company,status:values.status,
  amount_ht,commission_amount,notes:String(values.notes||'').trim(),products:String(values.products||'').trim()};
}
