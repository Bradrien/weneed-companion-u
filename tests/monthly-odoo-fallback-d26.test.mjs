import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeMonthlyOdooSource} from '../validation-v12/assets/monthly-odoo-fallback-d26.mjs';
import {summarizeCommissionMonth} from '../validation-v12/assets/monthly-commission-d25.mjs';
const raw=(state,id,reference,company='GTA')=>({
 id,reference,date:'2026-10-08 11:00:00',company,client:'Client essai',
 state,currency:'EUR',amount_ht:400,lines:[{id:id*10,sku:'X1',product_name:'Test référence'}]});
const source=()=>({source:'odoo_live_read_only',persisted:false,
 commissions_are_calculated:false,verified_commissions_eur:null,
 source_order_status_rechecked:true,source_order_status_checked_at:'2026-10-11T10:30:00Z',
 period_from:'2026-10-01',period_to:'2026-10-31',orders_count:4,
 orders:[raw('sent',1,'T02163','TR'),raw('draft',2,'S03687'),
 raw('sale',3,'CONFIRMED'),raw('cancel',4,'CANCELED')]});
test('live read-only Odoo report recovers pending invoices as documentary facts with no forecast',()=>{
 const docs=normalizeMonthlyOdooSource(source(),'2026-10');
 assert.equal(docs.excludedCount,1);
 assert.equal(docs.orders.length,3);
 const month=summarizeCommissionMonth(docs,{month:'2026-10'});
 assert.equal(month.pending.count,2);
 assert.equal(month.confirmed.count,1);
 assert.equal(month.pending.forecast,null);
 assert.equal(month.confirmed.forecast,null);
 assert.equal(month.validated.amount,null);
 assert.deepEqual(month.pending.orders.map(o=>o.reference),['T02163','S03687']);
 assert.equal(summarizeCommissionMonth(docs,{month:'2026-10',company:'TR'}).pending.count,1);
 assert.equal(summarizeCommissionMonth(docs,{month:'2026-10',query:'S03687'}).pending.count,1);
});
test('reject reports without verified status, mismatched period or forged commission claims',()=>{
 const r=source();
 for(const change of [
  {source_order_status_rechecked:false},{period_from:'2026-09-01'},
  {persisted:true},{commissions_are_calculated:true},
  {verified_commissions_eur:9},{orders_count:3}
 ]){
  assert.throws(()=>normalizeMonthlyOdooSource({...r,...change},'2026-10'),/invalid_monthly_source/);
 }
 const changed=source();changed.orders[0].date='2026-09-29 10:00:00';
 assert.throws(()=>normalizeMonthlyOdooSource(changed,'2026-10'),/invalid_monthly_source/);
});
