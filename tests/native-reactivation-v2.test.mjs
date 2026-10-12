import test from 'node:test';
import assert from 'node:assert/strict';
import {buildStrategy} from '../validation-v12/assets/strategy-model.mjs';
const now='2026-10-12T09:00:00Z',id='11111111-1111-4111-8111-111111111111';
const order=(n,at,amount=100)=>({odoo_id:n,reference:'Synthetic '+n,partner_id:77,partner_name:'Same name',company:'TR',state:'sale',currency:'EUR',amount_ht:amount,date:at});
const body={version:'strategy_verified_v1',checked_at:now,clients:[{id,canonical_name:'Same name'}],verified_links:[],whatsapp:[],memories:[],odoo:{available:true,orders:[order(1,'2026-05-01'),order(2,'2026-06-01'),order(3,'2026-10-10',0)]}};
test('native recovery uses source partner IDs without attributing same-name sales to CRM; zero orders do not imply a recent purchase',()=>{
 const result=buildStrategy(body,12,now);assert.equal(result.clients[0].revenueHT,null);assert.equal(result.clients[0].reactivation.eligible,false);
 assert.equal(result.unmatched.length,1);const p=result.unmatched[0];assert.equal(p.partnerId,77);assert.equal(p.orderCount,2);assert.equal(p.lastOrderId,2);
 assert.equal(p.lastAt,'2026-06-01');assert.equal(p.reactivation.eligible,true);assert.equal(p.cadence.medianGapDays,31);
});
test('stale, unavailable, cancelled and non-EUR native sources do not recommend recovery',()=>{
 assert.equal(buildStrategy({...body,checked_at:'2026-10-11T09:00:00Z'},12,now).unmatched[0].reactivation.eligible,false);
 assert.equal(buildStrategy({...body,odoo:{...body.odoo,available:false}},12,now).unmatched.length,0);
 const invalid=body.odoo.orders.map(o=>({...o,state:'cancel'}));assert.equal(buildStrategy({...body,odoo:{available:true,orders:invalid}},12,now).unmatched.length,0);
 const foreign=body.odoo.orders.map(o=>({...o,currency:'USD'}));assert.equal(buildStrategy({...body,odoo:{available:true,orders:foreign}},12,now).unmatched.length,0);
});
