import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeClient360,proposePeriodOdooOrders,assessOdooPartnerCandidates} from '../assets/client-360-model.mjs';
const id='fef12218-1111-4111-8111-bb011ac01ac0';
const detail={profile:{id},business_objects:[{id:'obj-1',type:'invoice',key:'INV-1',status:'sent',amount:120,currency:'EUR'}],
  conversations:[{id:'c-1',source:'gmail',title:'Test conversation',last_event_at:'2026-09-25'}],
  key_facts:[{type:'payment',status:'inferred',value:{text:'Confirmation déclarée dans un e-mail'}}],
  stale_tasks:[{title:'Recontacter',description:'Ancienne action'}]};
test('normalize rich 360 with bounded financial sources',()=>{
 const a=normalizeClient360(detail,id);
 assert.equal(a.businessObjects[0].reference,'INV-1');
 assert.equal(a.conversations[0].source,'gmail');
 assert.equal(a.facts[0].status,'inferred');
 assert.equal(a.staleTasks.length,1);
});
test('require the selected CRM UUID to match server profile',()=>{
 assert.throws(()=>normalizeClient360(detail,'ffff2218-1111-4111-8111-bb011ac01ac0'));
});
const orders={orders:[
 {id:1,reference:'SO-1',client:'Green Purple',company:'GTA',state:'sale',amount_ht:250,currency:'EUR'},
 {id:2,reference:'SO-2',client:'green  purple',company:'TR',state:'cancel',amount_ht:0,currency:'EUR'},
 {id:3,reference:'SO-3',client:'Green Purple Shop',company:'GTA',state:'sale',amount_ht:300,currency:'EUR'}
]};
test('propose only exact normalized Odoo names, never child shops',()=>{
 const found=proposePeriodOdooOrders('Green Purple',orders);
 assert.deepEqual(found.map(o=>o.reference),['SO-1','SO-2']);
 assert.equal(found[1].state,'cancel');
 assert.deepEqual(proposePeriodOdooOrders('Other Shop',orders),[]);
});
test('missing monthly report does not imply historical absence',()=>{
 assert.deepEqual(proposePeriodOdooOrders('Green Purple',null),[]);
});

test('partner id is read only evidence, not an automatic verified CRM link',()=>{
 const orders={orders:[
  {id:11,reference:'S111',company:'GTA',client:'Green Purple',state:'sale',partner_odoo_id:350},
  {id:12,reference:'T222',company:'TR',client:'Green Purple',state:'cancel',partner_odoo_id:350},
  {id:13,reference:'S333',company:'GTA',client:'Green Purple',state:'sale',partner_odoo_id:920}
 ]};
 const rows=proposePeriodOdooOrders('Green Purple',orders);
 assert.equal(rows[0].partnerOdooId,350);
 assert.equal(rows[1].partnerOdooId,350);
 assert.equal(rows[1].state,'cancel');
 const a=assessOdooPartnerCandidates(rows);
 assert.equal(a.verified,false);
 assert.equal(a.conflicting,true);
 assert.deepEqual(a.distinctPartnerIds,[350,920]);
});
test('absent Odoo partner id never establishes a verified CRM link',()=>{
 const rows=proposePeriodOdooOrders('Green Purple',{orders:[{
  id:7,reference:'SO7',company:'GTA',client:'Green Purple',state:'sale',partner_odoo_id:null
 }]});
 assert.equal(rows[0].partnerOdooId,null);
 assert.equal(assessOdooPartnerCandidates(rows).missingPartnerIds,1);
 assert.equal(assessOdooPartnerCandidates(rows).verified,false);
});
