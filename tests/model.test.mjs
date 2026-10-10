import test from 'node:test';
import assert from 'node:assert/strict';
import {assertReport,filteredOrders,deriveStats,monthOf,formatMoney} from '../assets/model.mjs';
const fixture=()=>({source:'odoo_live_read_only',period_from:'2026-09-01',period_to:'2026-09-30',persisted:false,
 verified_commissions_eur:null,commissions_are_calculated:false,orders_count:1,
 catalog_snapshot:{id:'snapshot',products_total:1385,source_completed_at:'2026-10-10T00:22:04Z'},
 catalog_matching:{eligible:2,matched:1,not_found:1,missing_sku:0,ambiguous_sku:0,catalog_invalid_price:0,zero_cost:1,zero_list_price:0},
 orders:[{id:11,reference:'S03515',company:'GTA',client:'Client Test',currency:'EUR',state:'sale',amount_ht:220,commission_eur:null,issues:[],
  lines:[
   {id:1,sku:'ML/G',product_name:'Example',kind:'candidate',commission_eur:null,catalog_match:{status:'matched',cost_eur:0,list_price_eur:1.2,cost_zero:true,price_zero:false}},
   {id:2,sku:'NOT-KNOWN',product_name:'Another',kind:'candidate',commission_eur:null,catalog_match:{status:'not_found'}}]}]});
test('catalog reconciliation report accepted, payouts null',()=>assertReport(fixture()));
test('search SKU and client',()=>{assert.equal(filteredOrders(fixture(),{query:'ML/G'}).length,1);assert.equal(filteredOrders(fixture(),{query:'CLIENT TEST'}).length,1)});
test('no orders when company filter mismatched',()=>assert.equal(filteredOrders(fixture(),{company:'TR'}).length,0));
test('source revenue is separate from commission',()=>assert.equal(deriveStats(fixture().orders).sourceAmount,220));
test('reject a commission amount in report',()=>{const r=fixture();r.verified_commissions_eur=1;assert.throws(()=>assertReport(r))});
test('reject a commission on a line',()=>{const r=fixture();r.orders[0].lines[0].commission_eur=1;assert.throws(()=>assertReport(r))});
test('reject a catalog with mismatch count',()=>{const r=fixture();r.catalog_matching.matched=10;assert.throws(()=>assertReport(r))});
test('reject a false cost',()=>{const r=fixture();r.orders[0].lines[0].catalog_match.cost_eur=-100;assert.throws(()=>assertReport(r))});
test('reject an unknown match status',()=>{const r=fixture();r.orders[0].lines[1].catalog_match.status='invented';assert.throws(()=>assertReport(r))});
test('reject invalid total rows',()=>{const r=fixture();r.orders_count=2;assert.throws(()=>assertReport(r))});
test('allow fallback legacy Odoo report',()=>{const r=fixture();delete r.catalog_snapshot;delete r.catalog_matching;r.orders[0].lines.forEach(l=>delete l.catalog_match);assertReport(r)});
test('reject mixed-currency gross amount',()=>{const r=fixture();r.orders.push({...r.orders[0],id:12,currency:'CHF',amount_ht:100,lines:[]});assert.equal(deriveStats(r.orders).sourceAmount,null)});
test('date conversion',()=>assert.equal(monthOf(new Date(2026,8,1)).from,'2026-09-01'));
test('money display handles missing values',()=>assert.equal(formatMoney(null),'—'));

test('reject report for a different requested period',()=>{
 const r=fixture();
 assert.throws(()=>assertReport(r,{from:'2026-10-01',to:'2026-10-31'}),{message:'report_period_mismatch'});
});
test('accept report for the exact requested period',()=>{
 assert.doesNotThrow(()=>assertReport(fixture(),{from:'2026-09-01',to:'2026-09-30'}));
});
test('prevent samples counting as eligible catalog matches',()=>{
 const r=fixture();r.orders[0].lines[0].kind='sample';
 assert.throws(()=>assertReport(r),{message:'invalid_report'});
});
test('prevent cancelled orders counting as catalog matches',()=>{
 const r=fixture();r.orders[0].state='cancel';
 assert.throws(()=>assertReport(r),{message:'invalid_report'});
});
test('allow correctly excluded cancelled orders without matches',()=>{
 const r=fixture();r.orders[0].state='cancel';
 r.orders[0].lines.forEach(l=>l.catalog_match={status:'not_applicable'});
 Object.assign(r.catalog_matching,{eligible:0,matched:0,not_found:0,missing_sku:0,ambiguous_sku:0,catalog_invalid_price:0,zero_cost:0,zero_list_price:0});
 assert.doesNotThrow(()=>assertReport(r));
});
test('reject catalog status totals contradicting line details',()=>{
 const r=fixture();r.catalog_matching.not_found=0;r.catalog_matching.matched=2;
 assert.throws(()=>assertReport(r),{message:'invalid_report'});
});
test('reject incorrect Kino zero-cost flags',()=>{
 const r=fixture();r.orders[0].lines[0].catalog_match.cost_zero=false;
 assert.throws(()=>assertReport(r),{message:'invalid_report'});
});
test('reject commission amounts also in legacy Odoo fallback lines',()=>{
 const r=fixture();delete r.catalog_snapshot;delete r.catalog_matching;
 r.orders[0].lines.forEach(l=>delete l.catalog_match);
 r.orders[0].lines[0].commission_eur=12;
 assert.throws(()=>assertReport(r),{message:'invalid_orders'});
});
test('missing confirmed Odoo amount must not be presented as zero revenue',()=>{
 const r=fixture();r.orders[0].amount_ht=null;
 assert.equal(deriveStats(r.orders).sourceAmount,null);
});
