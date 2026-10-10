import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeOdooCandidates} from '../assets/client-candidates-model.mjs';
const id='fef12218-1111-4111-8111-bb011ac01ac0';
const payload={client_id:id,matching:'exact_partner_name_and_salesperson_orders',
 verified:false,complete:false,sampled_orders:3,
 candidates:[{partner_odoo_id:123,name:'Boutique A',examples:2,last_date:'2026-09-10'}]};
test('Exact candidate discovery is explicitly partial and never verified',()=>{
 const v=normalizeOdooCandidates(payload,id);
 assert.equal(v.partial,true);
 assert.equal(v.candidates[0].partnerId,123);
 assert.equal(v.candidates[0].exampleCount,2);
});
test('Reject conflicting, duplicated, foreign and forged candidate payloads',()=>{
 for(const invalid of [
  {...payload,client_id:'other'},
  {...payload,verified:true},
  {...payload,complete:true},
  {...payload,candidates:[payload.candidates[0],payload.candidates[0]]},
  {...payload,candidates:[{...payload.candidates[0],partner_odoo_id:'123'}]},
  {...payload,sampled_orders:999}
 ])assert.throws(()=>normalizeOdooCandidates(invalid,id),/invalid_odoo_candidates/);
});
