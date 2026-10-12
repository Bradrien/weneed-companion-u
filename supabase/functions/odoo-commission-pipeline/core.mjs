/** Pure provisional calculation and repeat-read checks. No I/O or payment claims. */
import {reconcileKinoUnit,UNIT_REASON} from './unit-basis.mjs';
import {calculateKinoLine} from './calculation.mjs';
import {resolveCatalogProduct} from './product-match.mjs';
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
// Read-only evidence: a bracketed label never substitutes for default_code.
function catalogEvidence({company,sku,product,reason,catalog,duplicates,catalogAvailable}){
 let source='odoo_sku',code=sku.toUpperCase();
 if(!code){
  const hit=product.match(/^\s*\[([A-Za-z0-9_+./-]{2,40})\]/);
  if(!hit)return null;
  source='product_label_prefix';code=hit[1].toUpperCase();
 }
 const key=company+'|'+code,row=catalog.get(key),status=!catalogAvailable?'unavailable':
  duplicates.has(key)?'ambiguous':row?'found':'not_found';
 return {source,company,sku:code,status,
  catalog_name:status==='found'?text(row.product_name).slice(0,180):null,
  tier:status==='found'?text(row.tier).slice(0,20):null,
  cost_eur:status==='found'?number(row.cost_eur):null,
  list_price_eur:status==='found'?number(row.list_price_eur):null};
}
export function calculateOdooOrder(order,items,{company,products,catalog,duplicates,catalogAvailable}){
 const seen=new Set();
 const presented=items.map(line=>{
  if(!line||!Number.isSafeInteger(line.id)||line.id<1||seen.has(line.id))throw Error('odoo_order_identity_mismatch');
  seen.add(line.id);
  const product=products.get(relationId(line.product_id)??-1),sku=text(product?.default_code).trim(),
   quantity=number(line.product_uom_qty),price=number(line.price_unit),discount=number(line.discount),
   subtotal=number(line.price_subtotal),key=company+'|'+sku.toUpperCase();
  const productLabel=text(product?.name)||text(line.name).slice(0,160);
  const resolved=resolveCatalogProduct({company,sku,product:productLabel,catalog,duplicates,catalogAvailable}),row=resolved.row;
  let reason='not_eligible',estimate=null,unitBasis=null,unitCost=null,packSizeG=null,catalogPrice=null,tier=null,calculation=null;
  const candidate=!line.display_type&&quantity!==null&&quantity>0&&subtotal!==null&&subtotal>0;
  // A name filter is a provisional scope filter, not an approved compensation policy.
  // Product identity is authoritative. Invoice notes can mention samples/shipping
  // without turning a sold product into an excluded sample or delivery charge.
  const identity=(text(product?.name)||text(line.name).split('\n')[0])+' '+sku;
  const namedExclusion=/(?:^|[^\p{L}\p{N}_])(?:samples?|échantillons?|delivery|shipping|livraison|transport|freight|port)(?=$|[^\p{L}\p{N}_])/iu.test(identity);
  if(!line.display_type&&(quantity===null||subtotal===null))reason='invalid_amount';
  else if(!line.display_type&&quantity>0&&
   (price===null||price<0||discount===null||discount<0||discount>100))reason='invalid_amount';
  else if(candidate){
   const expected=price===null||discount===null?null:quantity*price*(1-discount/100);
   if(expected===null||!Number.isFinite(expected)||Math.abs(expected-subtotal)>0.04)reason='line_price_mismatch';
   else if(namedExclusion)reason='not_eligible';
   else if(!product)reason='missing_odoo_sku';
   else if(!row)reason=resolved.reason;
   else if(!['A','B'].includes(text(row.tier)))reason='invalid_kino_tier';
   else if(number(row.cost_eur)===null||row.cost_eur<=0)reason='missing_kino_cost';
   else if(number(row.list_price_eur)===null||row.list_price_eur<=0)reason='missing_kino_price';
   else{
    const unit=reconcileKinoUnit({sku:resolved.match?.catalog_sku||sku,productName:text(row.product_name),cost:row.cost_eur,
     listedPrice:row.list_price_eur,odooUnitPrice:price});
    if(!unit.ok)reason=UNIT_REASON;
    else{
     const cost=unit.costPerOdooUnit;
     tier=text(row.tier);unitBasis=unit.basis;unitCost=cost;packSizeG=unit.packSizeG;
     catalogPrice=unit.catalogUnitPrice;
     try{
      calculation=calculateKinoLine({tier,cost,quantity,subtotalHT:subtotal});
      estimate=calculation.commission;reason='estimated_units_unverified';
     }catch{reason='invalid_calculation'}
    }
   }
  }
  const evidence=!resolved.match&&estimate===null&&reason!=='not_eligible'?catalogEvidence({company,sku,
   product:productLabel,reason,catalog,duplicates,catalogAvailable}):null;
  return {line_id:line.id,sku,product:productLabel,
   quantity,unit:relationName(line.product_uom),price_unit:price,discount_pct:discount,
   subtotal_ht:subtotal,commission_estimate:estimate,reason,unit_basis:unitBasis,
   effective_unit_cost_eur:unitCost,catalog_unit_price_eur:catalogPrice,
   catalog_cost_eur:unitBasis?number(row.cost_eur):null,catalog_price_eur:unitBasis?number(row.list_price_eur):null,
   pack_size_g:packSizeG,kino_tier:tier,catalog_evidence:evidence,listing_match:resolved.match,calculation};
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
