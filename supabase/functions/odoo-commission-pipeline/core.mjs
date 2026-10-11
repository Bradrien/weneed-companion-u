/** Pure provisional calculation and repeat-read checks. No I/O or payment claims. */
import {reconcileKinoUnit,UNIT_REASON} from './unit-basis.mjs';
const text=x=>typeof x==='string'?x:'';
const relationName=x=>Array.isArray(x)&&typeof x[1]==='string'?x[1]:'';
const relationId=x=>Array.isArray(x)&&Number.isSafeInteger(x[0])&&x[0]>0?x[0]:null;
const number=x=>typeof x==='number'&&Number.isFinite(x)?x:null;
const cents=x=>number(x)!==null&&Number.isSafeInteger(Math.round(x*100))?Math.round(x*100):null;
export const PIPELINE_UNCERTAINTIES=Object.freeze({
 units_verified:false,historical_costs_verified:false,spiff_enabled:false,
 exclusions_contract_verified:false,credit_notes_verified:false,payments_verified:false,payable:false
});
export function assertUnchangedRows(before,after,fields,code='odoo_source_changed'){
 if(!Array.isArray(before)||!Array.isArray(after)||before.length!==after.length)throw Error(code);
 const byId=new Map();
 for(const row of before){
  if(!row||!Number.isSafeInteger(row.id)||row.id<1||byId.has(row.id))throw Error(code);
  byId.set(row.id,row);
 }
 const seen=new Set();
 for(const row of after){
  if(!row||!Number.isSafeInteger(row.id)||row.id<1||seen.has(row.id)||!byId.has(row.id))throw Error(code);
  seen.add(row.id);
  const prior=byId.get(row.id);
  if(fields.some(field=>JSON.stringify(prior[field])!==JSON.stringify(row[field])))throw Error(code);
 }
}
function rate(tier,ratio){
 if(ratio<=0)return tier==='A'?0.2:0.22254;
 if(tier==='B')return ratio>=1?0.3:0.22254+ratio*(0.3-0.22254);
 if(ratio>=0.8)return 0.3;
 if(ratio<=0.15)return 0.2+ratio/0.15*(0.2321-0.2);
 return 0.2321+(ratio-0.15)/0.65*(0.3-0.2321);
}
export function calculateOdooOrder(order,items,{company,products,catalog,duplicates,catalogAvailable}){
 const seen=new Set();
 const presented=items.map(line=>{
  if(!line||!Number.isSafeInteger(line.id)||line.id<1||seen.has(line.id))throw Error('odoo_order_identity_mismatch');
  seen.add(line.id);
  const product=products.get(relationId(line.product_id)??-1),sku=text(product?.default_code).trim(),
   quantity=number(line.product_uom_qty),price=number(line.price_unit),discount=number(line.discount),
   subtotal=number(line.price_subtotal),key=company+'|'+sku.toUpperCase(),row=catalog.get(key);
  let reason='not_eligible',estimate=null,unitBasis=null,unitCost=null,packSizeG=null,catalogPrice=null,tier=null;
  const candidate=!line.display_type&&quantity!==null&&quantity>0&&subtotal!==null&&subtotal>0;
  // A name filter is a provisional scope filter, not an approved compensation policy.
  const namedExclusion=/sample|samples|échantillon|échantillons|delivery|shipping|livraison|transport/i.test(
   text(product?.name)+' '+text(line.name));
  if(!line.display_type&&(quantity===null||subtotal===null))reason='invalid_amount';
  else if(!line.display_type&&quantity>0&&
   (price===null||price<0||discount===null||discount<0||discount>100))reason='invalid_amount';
  else if(candidate){
   const expected=price===null||discount===null?null:quantity*price*(1-discount/100);
   if(expected===null||!Number.isFinite(expected)||Math.abs(expected-subtotal)>0.04)reason='line_price_mismatch';
   else if(namedExclusion)reason='not_eligible';
   else if(!sku)reason='missing_odoo_sku';
   else if(!catalogAvailable)reason='catalog_unavailable';
   else if(duplicates.has(key))reason='ambiguous_sku';
   else if(!row)reason='missing_kino_match';
   else if(!['A','B'].includes(text(row.tier)))reason='invalid_kino_tier';
   else if(number(row.cost_eur)===null||row.cost_eur<=0)reason='missing_kino_cost';
   else if(number(row.list_price_eur)===null||row.list_price_eur<=0)reason='missing_kino_price';
   else{
    const unit=reconcileKinoUnit({sku,productName:text(row.product_name),cost:row.cost_eur,
     listedPrice:row.list_price_eur,odooUnitPrice:price});
    if(!unit.ok)reason=UNIT_REASON;
    else{
     const cost=unit.costPerOdooUnit;
     tier=text(row.tier);unitBasis=unit.basis;unitCost=cost;packSizeG=unit.packSizeG;
     catalogPrice=unit.catalogUnitPrice;
     const marginUnit=subtotal/quantity-cost*(tier==='A'?1.25:1.15),
      raw=Math.max(0,marginUnit*quantity)*(marginUnit>0?rate(tier,marginUnit/cost):0),
      amount=cents(raw);
     if(amount!==null){estimate=amount/100;reason='estimated_units_unverified'}
     else reason='invalid_calculation';
    }
   }
  }
  return {line_id:line.id,sku,product:text(product?.name)||text(line.name).slice(0,160),
   quantity,unit:relationName(line.product_uom),price_unit:price,discount_pct:discount,
   subtotal_ht:subtotal,commission_estimate:estimate,reason,unit_basis:unitBasis,
   effective_unit_cost_eur:unitCost,catalog_unit_price_eur:catalogPrice,
   pack_size_g:packSizeG,kino_tier:tier};
 });
 const issues=[],amount=number(order.amount_untaxed),amountCents=cents(amount),
  lineCents=presented.map(line=>cents(line.subtotal_ht));
 let lineTotal=0,estimateTotal=0;
 for(const n of lineCents)if(n!==null)lineTotal+=n;
 if(amountCents===null||lineCents.some(n=>n===null)||!Number.isSafeInteger(lineTotal))
  issues.push('incomplete_source_amount');
 else if(Math.abs(lineTotal-amountCents)>4)issues.push('lines_total_mismatch');
 if((amount!==null&&amount<0)||presented.some(line=>
  (line.quantity!==null&&line.quantity<0)||(line.subtotal_ht!==null&&line.subtotal_ht<0)))
  issues.push('signed_adjustment');
 if(presented.some(line=>['invalid_amount','line_price_mismatch'].includes(line.reason)))
  issues.push('invalid_line_inputs');
 const matched=presented.filter(line=>line.commission_estimate!==null),
  unmatched=presented.filter(line=>line.commission_estimate===null&&line.reason!=='not_eligible');
 for(const line of matched)estimateTotal+=cents(line.commission_estimate);
 if(!Number.isSafeInteger(estimateTotal))issues.push('invalid_calculation');
 const state=text(order.state),invoiceStatus=text(order.invoice_status),currency=relationName(order.currency_id);
 if(currency!=='EUR')issues.push('not_eur');
 return {id:order.id,reference:text(order.name).slice(0,100),date:text(order.date_order).slice(0,19),
  company,client:relationName(order.partner_id).slice(0,140),state,invoice_status:invoiceStatus,
  stage:state==='draft'||state==='sent'?'en_cours':invoiceStatus==='invoiced'?'facture':'confirme',
  currency,amount_ht:amount,forecast:matched.length&&!issues.length?estimateTotal/100:null,
  matched_lines:matched.length,unmatched_lines:unmatched.length,lines:presented,issues,
  excluded_lines:presented.filter(line=>line.reason==='not_eligible').length,
  uncertainties:PIPELINE_UNCERTAINTIES};
}
