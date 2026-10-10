import test from 'node:test';
import assert from 'node:assert/strict';
import {buildStrategy,marginScenario} from '../assets/strategy-model.mjs';
const id1='d4522538-54d8-497f-a80d-15a1cf214189';
const id2='1ba23913-c5d8-4235-b638-86468013ef64';
const payload={version:'strategy_verified_v1',checked_at:'2026-10-11T10:00:00Z',
 clients:[{id:id1,canonical_name:'Green Purple'},{id:id2,canonical_name:'Other'}],
 verified_links:[{client_id:id1,partner_odoo_id:3277}],whatsapp:[{client_id:id2,text_count:50,last_at:'2026-10-07'}],
 memories:[],odoo:{available:true,error:null,orders:[
  {partner_id:3277,date:'2026-09-01',state:'sale',company:'GTA',amount_ht:1000,currency:'EUR',reference:'G1'},
  {partner_id:3277,date:'2026-10-01',state:'done',company:'TR',amount_ht:500,currency:'EUR',reference:'T1'},
  {partner_id:3277,date:'2026-09-07',state:'cancel',company:'TR',amount_ht:9000,currency:'EUR'},
  {partner_id:888,date:'2026-10-04',state:'sale',company:'GTA',amount_ht:2000,currency:'EUR',partner_name:'Other'},
  {partner_id:3277,date:'2026-09-10',state:'sale',company:'GTA',amount_ht:90,currency:'USD'}
 ]}};
test('verified links only, no sales for same-name unlinked client',()=>{
 const r=buildStrategy(payload,12,'2026-10-11');
 const x=r.clients.find(x=>x.id===id1),y=r.clients.find(x=>x.id===id2);
 assert.equal(x.revenueHT,1500);assert.equal(x.avgBasketHT,750);
 assert.equal(x.gtaHT,1000);assert.equal(x.trHT,500);
 assert.equal(y.revenueHT,null);assert.equal(y.verifiedOrderCount,0);
 assert.equal(r.meta.unmatchedRevenueHT,2000);
 assert.equal(r.meta.positiveOrderCount,2);
 assert.equal(x.cadence.medianGapDays,30);
});
test('Odoo unavailability is unknown not zero revenue',()=>{
 const r=buildStrategy({...payload,odoo:{available:false,error:'odoo_unreachable',orders:[]}},12,'2026-10-11');
 assert.equal(r.meta.revenueHT,null);
 assert.equal(r.clients.find(c=>c.id===id1).revenueHT,null);
});
test('break-even unit contribution respects margin and requested quantity',()=>{
 const r=marginScenario({price:2.5,cost:1.5,newPrice:2.3,quantity:1000,expectedQuantity:1300});
 assert.equal(r.ok,true);assert.equal(r.baselineGrossMargin,1000);
 assert.equal(r.scenarioGrossMargin,1040);
 assert.equal(r.requiredUpliftPct,25);
 assert.equal(marginScenario({price:2,cost:1.8,newPrice:1.7,quantity:1000,expectedQuantity:3000}).ok,false);
 assert.equal(marginScenario({price:2,cost:1,newPrice:2,quantity:1000,expectedQuantity:2000}).ok,false);
});
test('period restricts sales without inferring zero purchases when not linked',()=>{
 const r=buildStrategy(payload,3,'2026-10-11');
 assert.equal(r.meta.windowFrom,'2026-07-11');
 assert.equal(r.clients.find(c=>c.id===id2).revenueHT,null);
});
