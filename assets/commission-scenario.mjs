/**
 * Pure, provisional per-line Kino simulation from the authenticated read-only Odoo report.
 * A matched catalog COST is assumed to be in the same billing unit as the Odoo line;
 * this has NOT been verified in Kino server rules. Never use as payable commission.
 */
import {simulateKinoLine} from './kino-simulator.mjs';

const CONFIRMED=new Set(['sale','done']);
export const SCENARIO_REASONS=Object.freeze({
  not_confirmed:'Commande non confirmée',
  invalid_order_totals:'Sous-total de commande Odoo incohérent ou incomplet',
  excluded_kind:'Échantillon, livraison, gratuité ou ligne non éligible',
  not_matched:'Référence ou SKU non officiellement rapproché',
  not_eur:'Devise différente de EUR',
  invalid_tier:'Catégorie Kino différente de A/B',
  invalid_cost:'Coût ou prix catalogue Kino indisponible / nul',
  invalid_quantity:'Quantité Odoo invalide',
  invalid_amount:'Prix de vente ou montant HT Odoo invalide',
  inconsistent_subtotal:'Remise ou sous-total Odoo incohérent',
  unverified_commission:'Source contenant une commission non nulle',
  simulation_error:'Erreur de simulation'
});
function usable(n){return typeof n==='number'&&Number.isFinite(n)}
function checkLine(order,line){
 if(!CONFIRMED.has(order.state))return 'not_confirmed';
 if((order.issues||[]).some(x=>x==='lines_total_mismatch'||x==='incomplete_source_amount'))return 'invalid_order_totals';
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
 if(Math.abs(expected-line.line_ht)>0.03)
  return 'inconsistent_subtotal';
 if(line.commission_eur!==null||order.commission_eur!==null)return 'unverified_commission';
 return null;
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
 for(const order of report.orders){
  if(!byCompany[order.company])throw new Error('unknown_company');
  if(order.state==='cancel')cancelledOrders.push({
   id:order.id,reference:order.reference,company:order.company,client:order.client,
   amount_ht:order.amount_ht
  });
  for(const line of order.lines||[]){
   const reason=checkLine(order,line);
   const row={order_id:order.id,reference:order.reference,company:order.company,
    client:order.client,line_id:line.id,sku:line.sku,product_name:line.product_name,
    quantity:line.quantity,sale_ht:line.line_ht};
   if(reason){excluded.push({...row,reason});reasons[reason]=(reasons[reason]||0)+1;continue}
   let calc;
   try{
    calc=simulateKinoLine(
      {tier:line.catalog_match.tier,cost:line.catalog_match.cost_eur,unit:'Units'},
      {price:line.line_ht/line.quantity,quantity:line.quantity,spiff:false}
    );
    if(![calc.commission,calc.margin,calc.sales].every(usable))throw Error('invalid_simulation');
   }catch{excluded.push({...row,reason:'simulation_error'});reasons.simulation_error=(reasons.simulation_error||0)+1;continue}
   const entry={...row,commission:calc.commission,margin:calc.margin,
    effective_unit_price:line.line_ht/line.quantity,tier:line.catalog_match.tier,
    cost_per_assumed_unit:line.catalog_match.cost_eur,rate:calc.rate,order_state:order.state};
   ready.push(entry);
   const company=byCompany[order.company];
   company.lineCount++;company.simulated++;company.commission+=calc.commission;
   company.margin+=calc.margin;company.sales+=calc.sales;company.orders.add(String(order.id));
  }
 }
 const groups=Object.fromEntries(Object.entries(byCompany).map(([company,d])=>[company,{
  company,lineCount:d.lineCount,orders:d.orders.size,
  sales:d.sales,margin:d.margin,commission:d.commission
 }]));
 return {companies:groups,ready,excluded,reasons,cancelledOrders,
  sourceStatusCheckedAt:report.source_order_status_checked_at,
  eligibleMatched:report.catalog_matching?.matched??null,
  total:groups.GTA.commission+groups.TR.commission,
  simulatedLines:ready.length,
  // Not a "validated percentage": only a theoretical scenario for matching price units.
  assumption:'Kino catalogue costs and Odoo line prices use the same unit; not yet verified',
  spiff:false,payable:false};
}
