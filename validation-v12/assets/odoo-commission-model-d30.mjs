// D22: Odoo stage is authoritative; invoice_status is NOT proof of payment.
import {cents,sumCents,sourceAmountIssues,COMMISSION_RULE_STATUS} from './commission-integrity-d24.mjs';
import {calculateKinoLine} from './kino-calculation-d31.mjs';
const STAGES=['en_cours','confirme','facture'];
export const statusLabels=Object.freeze({
 en_cours:'Devis en cours',confirme:'Commandes confirmées non entièrement facturées',
 facture:'Facturées (statut Odoo)'});
// Preserve signed Odoo amounts; a return/adjustment is not a missing amount.
const sourceNumber=x=>x===null||typeof x==='number'&&Number.isFinite(x);
const estimate=x=>x===null||typeof x==='number'&&Number.isFinite(x)&&x>=0;
function normalizeCatalogEvidence(raw,line,company){
 if(raw===undefined||raw===null)return null; // Older responses remain readable.
 if(!raw||typeof raw!=='object'||Array.isArray(raw)||raw.company!==company||
  !['odoo_sku','product_label_prefix'].includes(raw.source)||
  typeof raw.sku!=='string'||!raw.sku||raw.sku.length>100||raw.sku!==raw.sku.trim().toUpperCase()||
  !['found','ambiguous','not_found','unavailable'].includes(raw.status)||
  line.commission_estimate!==null||line.reason==='not_eligible')throw Error('invalid_catalog_evidence');
 if(raw.source==='odoo_sku'){
  if(!line.sku.trim()||raw.sku!==line.sku.trim().toUpperCase())throw Error('invalid_catalog_evidence');
 }else{
  const hit=line.product.match(/^\s*\[([A-Za-z0-9_+./-]{2,40})\]/);
  if(line.sku.trim()||line.reason!=='missing_odoo_sku'||!hit||raw.sku!==hit[1].toUpperCase())
   throw Error('invalid_catalog_evidence');
 }
 if(raw.status==='found'){
  if(typeof raw.catalog_name!=='string'||raw.catalog_name.length>180||
   typeof raw.tier!=='string'||raw.tier.length>20||!sourceNumber(raw.cost_eur)||
   !sourceNumber(raw.list_price_eur))throw Error('invalid_catalog_evidence');
 }else if([raw.catalog_name,raw.tier,raw.cost_eur,raw.list_price_eur].some(x=>x!==null))
  throw Error('invalid_catalog_evidence');
 return {source:raw.source,company,sku:raw.sku,status:raw.status,
  catalogName:raw.catalog_name,tier:raw.tier,costEur:raw.cost_eur,listPriceEur:raw.list_price_eur};
}
export function normalizeOdooPipeline(input){
 if(!input||input.version!=='odoo_commission_pipeline_v1'||!Array.isArray(input.orders)||
  input.orders.length>1600||input.scope!=='owner_odoo_salesperson_read_only_states_and_invoice_status_rechecked'||
  input.invoicing_semantics!=='sale.order.invoice_status_not_payment_status'||
  input.formula!=='kino_browser_formula_provisional_without_spiff_units_unverified'||
  !Number.isFinite(Date.parse(input.read_at)))throw Error('invalid_odoo_pipeline');
 const detailed=input.calculation_version==='kino_browser_arithmetic_v1_cent_per_line';
 if(input.calculation_version!==undefined&&!detailed||
  input.catalog_available!==undefined&&typeof input.catalog_available!=='boolean'||
  input.catalog_products_total!==undefined&&input.catalog_products_total!==null&&
   (!Number.isSafeInteger(input.catalog_products_total)||input.catalog_products_total<1||input.catalog_products_total>1600)||
  input.catalog_snapshot_at!==undefined&&input.catalog_snapshot_at!==null&&
   (typeof input.catalog_snapshot_at!=='string'||!Number.isFinite(Date.parse(input.catalog_snapshot_at))))
  throw Error('invalid_odoo_pipeline');
 if(detailed&&(typeof input.catalog_available!=='boolean'||
  input.catalog_available&&(input.catalog_products_total===null||input.catalog_products_total===undefined)||
  !input.catalog_available&&input.catalog_products_total!==null))throw Error('invalid_odoo_pipeline');
 const ids=new Set(),lineIds=new Set();
 const orders=input.orders.map(o=>{
  if(!o||!Number.isSafeInteger(o.id)||o.id<1||ids.has(o.id)||
   typeof o.reference!=='string'||typeof o.client!=='string'||
   !['GTA','TR'].includes(o.company)||!['draft','sent','sale','done'].includes(o.state)||
   typeof o.invoice_status!=='string'||typeof o.currency!=='string'||!/^[A-Z]{3}$/.test(o.currency)||
   typeof o.date!=='string'||!Number.isFinite(Date.parse(o.date))||
   !Array.isArray(o.lines)||o.lines.length>4500||!Number.isSafeInteger(o.matched_lines)||
   !Number.isSafeInteger(o.unmatched_lines)||o.matched_lines<0||o.unmatched_lines<0||
   !sourceNumber(o.amount_ht)||!estimate(o.forecast))
   throw Error('invalid_odoo_pipeline_order');
  const stage=['draft','sent'].includes(o.state)?'en_cours':
   o.invoice_status==='invoiced'?'facture':'confirme';
  if(stage!==o.stage)throw Error('odoo_stage_mismatch');
  ids.add(o.id);
  const lines=o.lines.map(l=>{
   if(!l||!Number.isSafeInteger(l.line_id)||l.line_id<1||lineIds.has(l.line_id)||
    typeof l.product!=='string'||typeof l.sku!=='string'||typeof l.unit!=='string'||
    typeof l.reason!=='string'||!sourceNumber(l.quantity)||!sourceNumber(l.subtotal_ht)||
    !estimate(l.commission_estimate))throw Error('invalid_odoo_line');
   lineIds.add(l.line_id);
   const hasPrice=Object.hasOwn(l,'price_unit'),hasDiscount=Object.hasOwn(l,'discount_pct');
   if(hasPrice!==hasDiscount||hasPrice&&(!sourceNumber(l.price_unit)||!sourceNumber(l.discount_pct)))
    throw Error('invalid_odoo_line');
   // D30 metadata is optional for older fixtures, but fail-closed when present.
   const hasBasis=Object.hasOwn(l,'unit_basis');
   const basis=hasBasis?l.unit_basis:null;
   const effectiveCost=Object.hasOwn(l,'effective_unit_cost_eur')?l.effective_unit_cost_eur:null;
   const catalogUnitPrice=Object.hasOwn(l,'catalog_unit_price_eur')?l.catalog_unit_price_eur:null;
   const packSize=Object.hasOwn(l,'pack_size_g')?l.pack_size_g:null;
   const tier=Object.hasOwn(l,'kino_tier')?l.kino_tier:null;
   const catalogCost=Object.hasOwn(l,'catalog_cost_eur')?l.catalog_cost_eur:null,
    catalogPrice=Object.hasOwn(l,'catalog_price_eur')?l.catalog_price_eur:null;
   if(hasBasis&&(basis!==null&&!['catalog_price_matches_odoo_unit','pack_cost_divided_by_grams'].includes(basis)||
    effectiveCost!==null&&(!Number.isFinite(effectiveCost)||effectiveCost<=0)||
    catalogUnitPrice!==null&&(!Number.isFinite(catalogUnitPrice)||catalogUnitPrice<=0)||
    packSize!==null&&(!Number.isSafeInteger(packSize)||packSize<=0)||
    tier!==null&&!['A','B'].includes(tier)||
    (l.commission_estimate!==null&&(basis===null||effectiveCost===null||catalogUnitPrice===null||tier===null))))
    throw Error('invalid_odoo_unit_basis');
   if(catalogCost!==null||catalogPrice!==null){
    const divisor=basis==='pack_cost_divided_by_grams'?packSize:1;
    if(!basis||!Number.isFinite(catalogCost)||catalogCost<=0||!Number.isFinite(catalogPrice)||catalogPrice<=0||
     !divisor||catalogCost/divisor!==effectiveCost||catalogPrice/divisor!==catalogUnitPrice)
     throw Error('invalid_odoo_unit_basis');
   }
   const catalogEvidence=normalizeCatalogEvidence(l.catalog_evidence,l,o.company);
   let calculation=null;
   const hasCalculation=Object.hasOwn(l,'calculation');
   if(detailed&&!hasCalculation||hasCalculation&&l.calculation!==null&&l.commission_estimate===null)
    throw Error('invalid_odoo_calculation');
   if(l.commission_estimate!==null&&effectiveCost!==null&&tier!==null){
    try{calculation=calculateKinoLine({tier,cost:effectiveCost,quantity:l.quantity,subtotalHT:l.subtotal_ht})}
    catch{throw Error('invalid_odoo_calculation')}
    if(cents(calculation.commission)!==cents(l.commission_estimate))throw Error('invalid_odoo_calculation');
   }
   if(hasCalculation&&l.calculation!==null||detailed&&l.commission_estimate!==null){
    if(!calculation||!l.calculation||typeof l.calculation!=='object'||Array.isArray(l.calculation)||
     Object.entries(calculation).some(([key,value])=>l.calculation[key]!==value))
     throw Error('invalid_odoo_calculation');
   }
   return {id:l.line_id,product:l.product.slice(0,180),sku:l.sku.slice(0,100),
    quantity:l.quantity,unit:l.unit.slice(0,50),
    subtotalHT:l.subtotal_ht,commissionEstimate:l.commission_estimate,
    unitPrice:hasPrice?l.price_unit:null,discountPct:hasDiscount?l.discount_pct:null,
    priceInputsAvailable:hasPrice,reason:l.reason,
    unitBasis:basis,effectiveUnitCostEur:effectiveCost,
    catalogUnitPriceEur:catalogUnitPrice,packSizeG:packSize,kinoTier:tier,catalogEvidence,calculation,
    catalogCostEur:catalogCost,catalogPriceEur:catalogPrice};
  });
  const matched=lines.filter(l=>l.commissionEstimate!==null),
   unmatched=lines.filter(l=>l.commissionEstimate===null&&l.reason!=='not_eligible'),
   excluded=lines.filter(l=>l.reason==='not_eligible');
  if(matched.length!==o.matched_lines||unmatched.length!==o.unmatched_lines||
   matched.some(l=>l.reason!=='estimated_units_unverified'||l.quantity===null||l.quantity<=0||
    l.subtotalHT===null||l.subtotalHT<=0)||
   matched.length+unmatched.length+excluded.length!==lines.length)throw Error('invalid_line_coverage');
  if(o.forecast!==null&&o.matched_lines===0)throw Error('invalid_odoo_forecast');
  const issues=sourceAmountIssues(o.amount_ht,lines);
  if(lines.some(l=>['invalid_amount','line_price_mismatch'].includes(l.reason)||
   l.priceInputsAvailable&&l.quantity!==null&&l.quantity>0&&l.subtotalHT!==null&&l.subtotalHT>0&&
   (l.unitPrice===null||l.unitPrice<0||l.discountPct===null||l.discountPct<0||l.discountPct>100||
    !Number.isFinite(l.quantity*l.unitPrice*(1-l.discountPct/100))||
    Math.abs(l.quantity*l.unitPrice*(1-l.discountPct/100)-l.subtotalHT)>0.04)))
   issues.push('invalid_line_inputs');
  if(o.currency!=='EUR')issues.push('not_eur');
  const lineEstimate=sumCents(matched.map(l=>l.commissionEstimate));
  if(o.forecast!==null&&(lineEstimate===null||cents(o.forecast)!==lineEstimate))
   issues.push('forecast_total_mismatch');
  const excludedMonetaryLines=excluded.filter(l=>l.subtotalHT===null||l.subtotalHT!==0).length;
  return {id:o.id,reference:o.reference.slice(0,120),client:o.client.slice(0,180),
   company:o.company,date:o.date,state:o.state,invoiceStatus:o.invoice_status,
   stage,currency:o.currency,amountHT:o.amount_ht,forecast:issues.length?null:o.forecast,
   matchedLines:o.matched_lines,unmatchedLines:o.unmatched_lines,
   excludedLines:excluded.length,excludedMonetaryLines,
   partial:o.unmatched_lines>0||excludedMonetaryLines>0,issues,lines};
 });
 return {orders,readAt:input.read_at,closedWindowFrom:input.closed_window_from,
  pendingScope:input.pending_scope,catalogSnapshotAt:input.catalog_snapshot_at,
  catalogAvailable:input.catalog_available??null,catalogProductsTotal:input.catalog_products_total??null,
  calculationVersion:input.calculation_version??null,
  sourceInputsRechecked:input.source_lines_rechecked===true&&input.source_amounts_rechecked===true,
  rules:COMMISSION_RULE_STATUS};
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
   ...o.lines.map(l=>l.product+' '+l.sku+' '+(l.catalogEvidence?.sku||'')+' '+
    (l.catalogEvidence?.catalogName||''))].join(' ').toLocaleLowerCase('fr-FR').includes(q)));
}
// Group diagnostics only. Never change coverage, forecasts or official Odoo SKUs.
export function pipelineReconciliationGroups(orders){
 const byKey=new Map();
 for(const order of orders)for(const line of order.lines){
  if(line.commissionEstimate!==null||line.reason==='not_eligible')continue;
  const evidence=line.catalogEvidence,sku=evidence?.sku||line.sku;
  const key=JSON.stringify([order.company,line.reason,evidence||sku,sku?null:line.id]);
  if(!byKey.has(key))byKey.set(key,{company:order.company,reason:line.reason,sku,
   catalogEvidence:evidence,lines:[]});
  byKey.get(key).lines.push({orderId:order.id,reference:order.reference,client:order.client,
   stage:order.stage,currency:order.currency,lineId:line.id,product:line.product,
   quantity:line.quantity,amountHT:line.subtotalHT});
 }
 return [...byKey.values()].map(group=>{
  const currencies=new Set(group.lines.map(l=>l.currency));
  const amounts=group.lines.filter(l=>l.amountHT!==null).map(l=>l.amountHT);
  const total=sumCents(amounts);
  return {...group,amountHT:currencies.size===1&&total!==null&&amounts.length?total/100:null,
   amountKnown:amounts.length,currency:currencies.size===1?[...currencies][0]:null,
   pendingLines:group.lines.filter(l=>l.stage==='en_cours').length,
   confirmedLines:group.lines.filter(l=>l.stage!=='en_cours').length};
 });
}
export function odooPipelineTotals(orders){
 const total={en_cours:0,confirme:0,facture:0,forecastCount:0,forecastPartial:0,
  forecast:0,orders:orders.length,amountHT:0,amountKnown:0,amountCurrency:null,
  mixedCurrencies:false,blocked:0,excludedMonetaryLines:0};
 const currencies=new Set(),amounts=[],forecasts=[];
 for(const x of orders){
  if(!STAGES.includes(x.stage))throw Error('invalid_stage');
  total[x.stage]++;
  currencies.add(x.currency);
  if(x.amountHT!==null){amounts.push(x.amountHT);total.amountKnown++}
  if(x.issues.length)total.blocked++;
  total.excludedMonetaryLines+=x.excludedMonetaryLines;
  if(x.forecast!==null){total.forecastCount++;forecasts.push(x.forecast);
   if(x.partial)total.forecastPartial++;}
 }
 total.mixedCurrencies=currencies.size>1;
 total.amountCurrency=currencies.size===1?[...currencies][0]:null;
 const amount=sumCents(amounts),forecast=sumCents(forecasts);
 total.amountHT=total.mixedCurrencies||amount===null?null:amount/100;
 total.forecast=forecast===null?null:forecast/100;
 return total;
}
