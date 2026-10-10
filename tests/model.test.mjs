import test from 'node:test';
import assert from 'node:assert/strict';
import {assertReport,filteredOrders,deriveStats,monthOf,formatMoney} from '../assets/model.mjs';
const fixture=()=>({source:'odoo_live_read_only',persisted:false,
 verified_commissions_eur:null,commissions_are_calculated:false,orders_count:1,
 catalog_snapshot:{id:'snapshot',products_total:1385,source_completed_at:'2026-10-10T00:22:04Z'},
 catalog_matching:{eligible:2,matched:1,not_found:1,missing_sku:0,ambiguous_sku:0,catalog_invalid_price:0,zero_cost:1,zero_list_price:0},
 orders:[{id:11,reference:'S03515',company:'GTA',client:'Client Test',currency:'EUR',state:'sale',amount_ht:220,commission_eur:null,issues:[],
  lines:[
   {id:1,sku:'ML/G',product_name:'Example',kind:'candidate',commission_eur:null,catalog_match:{status:'matched',cost_eur:0,list_price_eur:1.2}},
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
