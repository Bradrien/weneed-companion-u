import test from 'node:test';
import assert from 'node:assert/strict';
import {buildOrderLineCommissions,lineCommission} from '../assets/order-line-commission-d20.mjs';
const base={verified_commissions_eur:null,commissions_are_calculated:false,persisted:false,
 source_order_status_rechecked:true,source_order_status_checked_at:'2026-10-11T12:00:00Z',
 catalog_matching:{matched:1},orders:[{id:100,reference:'SO100',company:'GTA',state:'sale',currency:'EUR',
 client:'Test Client',commission_eur:null,issues:[],lines:[
  {id:3,kind:'candidate',commission_eur:null,quantity:100,unit_price:3,
   discount_pct:0,line_ht:300,sku:'SKU',product_name:'A',
   catalog_match:{status:'matched',tier:'A',cost_eur:2,list_price_eur:3}},
  {id:4,kind:'sample',commission_eur:null,quantity:1,unit_price:0,
   discount_pct:0,line_ht:0,sku:'',product_name:'Échantillon',
   catalog_match:{status:'not_applicable'}}
 ]}]};
test('line-level scenario remains non-payable and matches quote simulation exclusions',()=>{
 const index=buildOrderLineCommissions(base);
 assert.equal(index.status,'ok');
 assert.equal(lineCommission(index,100,3).status,'simulated');
 assert.ok(lineCommission(index,100,3).commission>=0);
 assert.equal(lineCommission(index,100,4).status,'excluded');
 assert.equal(index.orders.get(100).simulatedLines,1);
 assert.equal(index.orders.get(100).excludedLines,1);
});
test('non-confirmed orders cannot acquire a line commission',()=>{
 const report={...base,orders:[{...base.orders[0],state:'cancel'}]};
 const index=buildOrderLineCommissions(report);
 assert.equal(lineCommission(index,100,3).status,'excluded');
});
test('invalid live status verification means no product commission',()=>{
 const index=buildOrderLineCommissions({...base,source_order_status_rechecked:false});
 assert.equal(index.status,'invalid_report');
 assert.equal(lineCommission(index,100,3).status,'unavailable');
});
