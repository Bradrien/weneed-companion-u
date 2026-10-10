import test from 'node:test';
import assert from 'node:assert/strict';
import {simulateOdooReport} from '../assets/commission-scenario.mjs';
const round=n=>Math.round((n+Number.EPSILON)*100)/100;
const line=(override={})=>({
 id:1,sku:'SL/I',product_name:'Slurp',quantity:100,unit_price:2.5,
 discount_pct:0,line_ht:250,kind:'candidate',commission_eur:null,
 catalog_match:{status:'matched',tier:'A',category:'Indoor',cost_eur:1.4,list_price_eur:3},
 ...override
});
const order=(override={})=>({
 id:71,reference:'SO-TEST',company:'GTA',client:'Test boutique',state:'sale',
 currency:'EUR',amount_ht:250,commission_eur:null,lines:[line()],...override
});
const report=(orders)=>({
 source:'odoo_live_read_only',persisted:false,
 verified_commissions_eur:null,commissions_are_calculated:false,
 source_order_status_rechecked:true,source_order_status_checked_at:'2026-10-10T15:00:00.000Z',
 catalog_matching:{matched:orders.reduce((sum,o)=>sum+o.lines.filter(l=>l.catalog_match.status==='matched').length,0)},
 orders
});
test('100g GTA Slurp simulation reproduces 20.43 EUR without SPIFF',()=>{
 const result=simulateOdooReport(report([order()]));
 assert.equal(round(result.total),20.43);
 assert.equal(result.simulatedLines,1);
 assert.equal(result.companies.GTA.lineCount,1);
 assert.equal(result.companies.TR.commission,0);
 assert.equal(result.spiff,false);
 assert.equal(result.payable,false);
});
test('TR Toad Venom unit simulation matches 91.09 and basket 111.51',()=>{
 const tr=order({id:72,reference:'T999',company:'TR',amount_ht:800,
  lines:[line({id:2,sku:'TO/TR/250',product_name:'Toad Venom',
   quantity:1,unit_price:800,line_ht:800,
   catalog_match:{status:'matched',tier:'A',cost_eur:395,list_price_eur:1000}})]});
 const result=simulateOdooReport(report([order(),tr]));
 assert.equal(round(result.companies.TR.commission),91.09);
 assert.equal(round(result.total),111.51);
 assert.equal(result.simulatedLines,2);
 assert.equal(result.companies.GTA.orders,1);
 assert.equal(result.companies.TR.orders,1);
});
test('discounted Odoo HT subtotal determines effective selling price',()=>{
 const withDiscount=order({amount_ht:200,lines:[line({discount_pct:20,line_ht:200})]});
 const result=simulateOdooReport(report([withDiscount]));
 assert.equal(result.ready[0].effective_unit_price,2);
 assert.equal(result.ready[0].margin,25);
 assert.equal(round(result.total),5.88);
});
test('excluded cancelled, draft and sent orders never join provisional total',()=>{
 const orders=['cancel','draft','sent'].map((state,i)=>order({id:i+1,state}));
 const result=simulateOdooReport(report(orders));
 assert.equal(result.total,0);
 assert.equal(result.excluded.length,3);
 assert.equal(result.reasons.not_confirmed,3);
});
test('unmatched lines and even found candidate codes stay excluded',()=>{
 const missing=line({sku:'',kind:'review',catalog_match:{status:'missing_sku',
  candidate:{status:'found',sku:'TT/G',catalog_name:'Tangie Tonic'}}});
 const result=simulateOdooReport(report([order({lines:[line(),missing]})]));
 assert.equal(result.ready.length,1);
 assert.equal(result.reasons.excluded_kind,1);
});
test('sample, shipping, free and anomaly kinds never enter scenario',()=>{
 const types=['sample','shipping','free','anomaly'];
 const result=simulateOdooReport(report([order({lines:types.map((kind,i)=>line({id:i+1,kind}))})]));
 assert.equal(result.simulatedLines,0);
 assert.equal(result.reasons.excluded_kind,4);
});
test('zero cost or zero catalogue price and invalid tier are excluded',()=>{
 const zeroCost=line({catalog_match:{status:'matched',tier:'A',cost_eur:0,list_price_eur:3}});
 const zeroCatalog=line({catalog_match:{status:'matched',tier:'A',cost_eur:1,list_price_eur:0}});
 const tierC=line({catalog_match:{status:'matched',tier:'C',cost_eur:1,list_price_eur:3}});
 const result=simulateOdooReport(report([order({lines:[zeroCost,zeroCatalog,tierC]})]));
 assert.equal(result.simulatedLines,0);
 assert.equal(result.reasons.invalid_cost,2);
 assert.equal(result.reasons.invalid_tier,1);
});
test('unit and HT subtotal disagreements are flagged, not simulated',()=>{
 const conflicting=line({quantity:100,unit_price:2.5,line_ht:210});
 const result=simulateOdooReport(report([order({lines:[conflicting]})]));
 assert.equal(result.simulatedLines,0);
 assert.equal(result.reasons.inconsistent_subtotal,1);
});
test('non-EUR source is excluded from EUR totals',()=>{
 const result=simulateOdooReport(report([order({currency:'USD'})]));
 assert.equal(result.total,0);
 assert.equal(result.reasons.not_eur,1);
});
test('invalid quantities, discounts, missing line HT reject the line',()=>{
 const lines=[
  line({id:1,quantity:0}),line({id:2,quantity:-1}),
  line({id:3,discount_pct:200}),line({id:4,line_ht:null}),
  line({id:5,unit_price:NaN})
 ];
 const result=simulateOdooReport(report([order({lines})]));
 assert.equal(result.simulatedLines,0);
 assert.equal(result.reasons.invalid_quantity,2);
 assert.equal(result.reasons.invalid_amount,3);
});
test('verified, persisted or calculated reports rejected even if all lines match',()=>{
 for(const extra of [{persisted:true},{verified_commissions_eur:12},{commissions_are_calculated:true}]){
  assert.throws(()=>simulateOdooReport({...report([order()]),...extra}),/simulation_requires_unverified_read_only_report/);
 }
});
test('non-null line and order commissions rejected to prevent mixing validated payout',()=>{
 const a=simulateOdooReport(report([order({lines:[line({commission_eur:2})]})]));
 const b=simulateOdooReport(report([order({commission_eur:15})]));
 assert.equal(a.reasons.unverified_commission,1);
 assert.equal(b.reasons.unverified_commission,1);
});
test('missing catalog and empty report produce no estimated payout',()=>{
 const a=simulateOdooReport(report([]));
 assert.equal(a.total,0);
 assert.equal(a.simulatedLines,0);
 assert.equal(simulateOdooReport(null),null);
});
test('multiple lines in same order are grouped as one order',()=>{
 const one=order({lines:[line({id:1}),line({id:2})]});
 const r=simulateOdooReport(report([one]));
 assert.equal(r.simulatedLines,2);
 assert.equal(r.companies.GTA.orders,1);
});

test('incomplete or mismatched order totals block entire order scenario',()=>{
 const faulty=order({issues:['lines_total_mismatch'],amount_ht:300});
 const r=simulateOdooReport(report([faulty]));
 assert.equal(r.simulatedLines,0);
 assert.equal(r.reasons.invalid_order_totals,1);
});
test('rounding and Odoo reporting never mutate the original report',()=>{
 const source=report([order()]);
 const snapshot=structuredClone(source);
 const r=simulateOdooReport(source);
 assert.deepEqual(source,snapshot);
 assert.equal(source.orders[0].lines[0].commission_eur,null);
 assert.equal(r.payable,false);
});

test('report without independent Odoo state recheck never produces monetary simulation',()=>{
 const src=report([order()]);
 for(const props of [{source_order_status_rechecked:false},{source_order_status_checked_at:''},
  {source_order_status_checked_at:'not-a-date'}]){
  assert.throws(()=>simulateOdooReport({...src,...props}),/simulation_requires_rechecked_order_status/);
 }
});
test('cancelled order is reported separately and never appears in candidate or total',()=>{
 const orders=[
  order({id:123,reference:'SO-VALID',state:'sale'}),
  order({id:456,reference:'SO-CANCELLED',state:'cancel',amount_ht:400})
 ];
 const result=simulateOdooReport(report(orders));
 assert.equal(result.ready.length,1);
 assert.equal(result.cancelledOrders.length,1);
 assert.equal(result.cancelledOrders[0].reference,'SO-CANCELLED');
 assert.equal(round(result.total),20.43);
 assert.equal(result.excluded.filter(x=>x.reason==='not_confirmed').length,1);
 assert.ok(result.ready.every(x=>x.reference!=='SO-CANCELLED'));
});
