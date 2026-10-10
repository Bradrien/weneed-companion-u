import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizePartnerHistory} from '../assets/client-history-model.mjs';
const candidate={
 source:'odoo_partner_history_read_only',identity_verified:false,partner_odoo_id:3277,
 period_from:'2023-10-01',period_to:'2026-10-10',checked_at:'2026-10-10T16:30:00Z',
 orders:[
  {id:101,partner_odoo_id:3277,reference:'S03515',date:'2026-09-16 10:00:00',state:'sale',
   company:'GTA',amount_ht:10546,currency:'EUR'},
  {id:102,partner_odoo_id:3277,reference:'S03591',date:'2026-09-22 10:00:00',state:'cancel',
   company:'GTA',amount_ht:7500,currency:'EUR'},
  {id:103,partner_odoo_id:3277,reference:'T01981',date:'2026-09-29 10:00:00',state:'sale',
   company:'TR',amount_ht:0,currency:'EUR'}
 ]};
test('Partner Odoo 3277 history sorts three source orders, includes cancellation but excludes amount from confirmed total',()=>{
 const r=normalizePartnerHistory(candidate,3277);
 assert.deepEqual(r.orders.map(x=>x.reference),['T01981','S03591','S03515']);
 assert.deepEqual(r.statuses,{confirmed:2,cancelled:1,other:0});
 assert.equal(r.totals.GTA,10546);assert.equal(r.totals.TR,0);
 assert.equal(r.identityVerified,false);
});
test('Reject cross-CRM or cross-partner payload, duplicate Odoo IDs, verified payloads',()=>{
 for(const payload of [
  {...candidate,partner_odoo_id:3278},
  {...candidate,identity_verified:true},
  {...candidate,orders:[candidate.orders[0],candidate.orders[0]]},
  {...candidate,orders:[{...candidate.orders[0],partner_odoo_id:99}]},
  {...candidate,checked_at:'unknown'},
  {...candidate,source:'odoo_mock'}])
   assert.throws(()=>normalizePartnerHistory(payload,3277),/invalid_partner_history/);
});
test('Mixed or missing EUR source amounts disable all provisional revenue totals',()=>{
 const result=normalizePartnerHistory({...candidate,orders:[
  {...candidate.orders[0],currency:'USD'},candidate.orders[1]
 ]},3277);
 assert.equal(result.totals,null);
});
test('History rejects malformed identity or over 250 rows',()=>{
 assert.throws(()=>normalizePartnerHistory(candidate,0));
 assert.throws(()=>normalizePartnerHistory({...candidate,orders:Array.from({length:251},(_,i)=>({
  ...candidate.orders[0],id:i+1
 }))},3277),/invalid_partner_history/);
});
