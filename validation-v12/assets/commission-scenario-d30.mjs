/**
 * Pure, provisional per-line Kino simulation from the authenticated read-only Odoo report.
 * Uses the same conservative unit basis and line-cent rounding as the D30 pipeline.
 * Historical costs and Kino server rules remain unverified. Never payable.
 */
import {simulateKinoLine} from './kino-simulator-d24.mjs';
import {sourceAmountIssues,COMMISSION_RULE_STATUS,cents,sumCents} from './commission-integrity-d24.mjs';
import {reconcileKinoUnit} from './kino-unit-basis-d30.mjs';

const CONFIRMED=new Set(['sale','done']);
export const SCENARIO_REASONS=Object.freeze({
  not_confirmed:'Commande non confirmée',
  invalid_order_totals:'Sous-total de commande Odoo incohérent ou incomplet',
  signed_adjustment:'Ligne négative ou ajustement : estimation de la commande suspendue',
  excluded_kind:'Échantillon, livraison, gratuité ou ligne non éligible',
  not_matched:'Référence ou SKU non officiellement rapproché',
  not_eur:'Devise différente de EUR',
  invalid_tier:'Catégorie Kino différente de A/B',
  invalid_cost:'Coût ou prix catalogue Kino indisponible / nul',
  invalid_quantity:'Quantité Odoo invalide',
  invalid_amount:'Prix de vente ou montant HT Odoo invalide',
  inconsistent_subtotal:'Remise ou sous-total Odoo incohérent',
  unverified_unit_scale:'Coût au gramme ou au sachet non identifiable : estimation suspendue',
  unverified_commission:'Source contenant une commission non nulle',
  simulation_error:'Erreur de simulation'
});
function usable(n){return typeof n==='number'&&Number.isFinite(n)}
function roundedSum(values){
 const amount=sumCents(values);
 if(amount===null)throw new Error('invalid_simulation_total');
 return amount/100;
}
function checkLine(order,line,orderIssues){
 if(!CONFIRMED.has(order.state))return 'not_confirmed';
 if(orderIssues.includes('signed_adjustment'))return 'signed_adjustment';
 if(orderIssues.some(x=>x==='lines_total_mismatch'||x==='incomplete_source_amount'))return 'invalid_order_totals';
 if(line.kind!=='candidate')return 'excluded_kind';
 const match=line.catalog_match;
 if(!match||match.status!=='matched')return 'not_matched';
 if(order.currency!=='EUR')return 'not_eur';
 if(match.tier!=='A'&&match.tier!=='B')return 'invalid_tier';
 if(!usable(match.cost_eur)||match.cost_eur<=0||
    !usable(match.list_price_eur)||match.list_price_eur<=0)return 'invalid_cost';
 if(!usable(line.quantity)||line.quantity<=0)return 'invalid_quantity';
 if(!usable(line.unit_price)||line.unit_price<0||
    !usable(line.line_ht)||line.line_ht<0||
    !usable(line.discount_pct)||line.discount_pct<0||line.discount_pct>100)return 'invalid_amount';
 const expected=line.quantity*line.unit_price*(1-line.discount_pct/100);
 if(Math.abs(expected-line.line_ht)>0.04)
  return 'inconsistent_subtotal';
 if(line.commission_eur!==null||order.commission_eur!==null)return 'unverified_commission';
 if(!unitBasis(line).ok)return 'unverified_unit_scale';
 return null;
}
function unitBasis(line){
 const match=line.catalog_match;
 return reconcileKinoUnit({sku:line.sku,productName:match?.catalog_name,
  cost:match?.cost_eur,listedPrice:match?.list_price_eur,odooUnitPrice:line.unit_price});
}
export function simulateOdooReport(report){
 if(!report||!Array.isArray(report.orders))return null;
 // The gateway asserts that no commission has been verified or persisted.
 if(report.verified_commissions_eur!==null||
    report.commissions_are_calculated!==false||report.persisted!==false)
  throw new Error('simulation_requires_unverified_read_only_report');
 // Prevent presenting figures from older gateway versions without a second Odoo status read.
 if(report.source_order_status_rechecked!==true||
    typeof report.source_order_status_checked_at!=='string'||
    !Number.isFinite(Date.parse(report.source_order_status_checked_at)))
  throw new Error('simulation_requires_rechecked_order_status');
 const byCompany={GTA:{company:'GTA',lineCount:0,simulated:0,commission:0,margin:0,sales:0,orders:new Set()},
                  TR:{company:'TR',lineCount:0,simulated:0,commission:0,margin:0,sales:0,orders:new Set()}};
 const ready=[],excluded=[],reasons={},cancelledOrders=[];
 const orderIds=new Set(),lineIds=new Set();
 for(const order of report.orders){
  if(!order||!Number.isSafeInteger(order.id)||order.id<1||orderIds.has(order.id)||
   !Array.isArray(order.lines))throw new Error('invalid_simulation_order');
  orderIds.add(order.id);
  if(!byCompany[order.company])throw new Error('unknown_company');
  const orderIssues=[...(order.issues||[]),...sourceAmountIssues(order.amount_ht,order.lines,
   {amountKey:'line_ht'})];
  if(order.state==='cancel')cancelledOrders.push({
   id:order.id,reference:order.reference,company:order.company,client:order.client,
   amount_ht:order.amount_ht
  });
  for(const line of order.lines||[]){
   if(!line||!Number.isSafeInteger(line.id)||line.id<1||lineIds.has(line.id))
    throw new Error('invalid_simulation_line');
   lineIds.add(line.id);
   const reason=checkLine(order,line,orderIssues);
   const row={order_id:order.id,reference:order.reference,company:order.company,
    client:order.client,line_id:line.id,sku:line.sku,product_name:line.product_name,
    quantity:line.quantity,sale_ht:line.line_ht};
   if(reason){excluded.push({...row,reason});reasons[reason]=(reasons[reason]||0)+1;continue}
   let calc,unit;
   try{
    unit=unitBasis(line);
    calc=simulateKinoLine(
      {tier:line.catalog_match.tier,cost:unit.costPerOdooUnit,unit:'Units'},
      {price:line.line_ht/line.quantity,quantity:line.quantity,spiff:false}
    );
    const amount=cents(calc.commission);
    if(amount===null||![calc.margin,calc.sales].every(usable))throw Error('invalid_simulation');
    calc.commission=amount/100;
   }catch{excluded.push({...row,reason:'simulation_error'});reasons.simulation_error=(reasons.simulation_error||0)+1;continue}
   const entry={...row,commission:calc.commission,margin:calc.margin,
    effective_unit_price:line.line_ht/line.quantity,tier:line.catalog_match.tier,
    cost_per_assumed_unit:unit.costPerOdooUnit,rate:calc.rate,order_state:order.state,
    unit_basis:unit.basis,pack_size_g:unit.packSizeG,catalog_unit_price:unit.catalogUnitPrice};
   ready.push(entry);
   const company=byCompany[order.company];
   company.lineCount++;company.simulated++;company.commission+=calc.commission;
   company.margin+=calc.margin;company.sales+=calc.sales;company.orders.add(String(order.id));
  }
 }
 const groups=Object.fromEntries(Object.entries(byCompany).map(([company,d])=>[company,{
  company,lineCount:d.lineCount,orders:d.orders.size,
  sales:d.sales,margin:d.margin,commission:roundedSum(ready.filter(x=>x.company===company).map(x=>x.commission))
 }]));
 return {companies:groups,ready,excluded,reasons,cancelledOrders,
  sourceStatusCheckedAt:report.source_order_status_checked_at,
  eligibleMatched:report.catalog_matching?.matched??null,
  total:roundedSum([groups.GTA.commission,groups.TR.commission]),
  simulatedLines:ready.length,
  // Not a "validated percentage": only a theoretical scenario for matching price units.
  assumption:'Current Kino costs reconciled conservatively with Odoo billing units; historical costs remain unverified',
  spiff:false,payable:false,rules:COMMISSION_RULE_STATUS};
}
