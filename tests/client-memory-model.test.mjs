import test from 'node:test';
import assert from 'node:assert/strict';
import {buildCommercialMemory} from '../assets/client-memory-model.mjs';
const card={profile:{name:'Boutique Demo'},odooPartnerLink:{partnerId:777},
 attention:{tasks:[{title:'Rappeler le gérant',description:'Relance commerciale',dueAt:'2026-10-15'}]},
 activity:[{source:'gmail',type:'email.sent',when:'2026-09-30',body:'Facture envoyée et indiquée comme payée'}]};
const history={partnerOdooId:777,from:'2023-10-01',to:'2026-10-10',
 checkedAt:'2026-10-10T15:00:00Z',totals:{GTA:1200,TR:0},orders:[
  {state:'sale',reference:'S01',date:'2026-09-22',company:'GTA',amount:1200,currency:'EUR'},
  {state:'cancel',reference:'S00',date:'2026-08-17',company:'GTA',amount:9000,currency:'EUR'}
 ]};
test('CRM memory separates validated Odoo sales, cancelled orders and unverified emails',()=>{
 const m=buildCommercialMemory(card,{facts:[],businessObjects:[],conversations:[]},history);
 assert.equal(m.odooBacked,true);
 assert.deepEqual([m.orders.confirmed,m.orders.cancelled],[1,1]);
 assert.equal(m.orders.confirmedTotal.GTA,1200);
 assert.equal(m.orders.lastConfirmed,'2026-09-22');
 assert.equal(m.tasks[0].source,'CRM tâche');
 assert.equal(m.timeline.find(x=>x.source==='gmail').status,'exchange_unverified');
 assert.match(m.certainty,/ne prouvent/);
});
test('Never mix an unlinked or cross-partner Odoo history into commercial memory',()=>{
 for(const c of [{...card,odooPartnerLink:null},
  {...card,odooPartnerLink:{partnerId:999}}]){
  const m=buildCommercialMemory(c,{},history);
  assert.equal(m.odooBacked,false);
  assert.equal(m.orders.confirmed,0);
  assert.equal(m.orders.confirmedTotal,null);
  assert.equal(m.timeline.some(x=>x.source==='odoo'),false);
 }
});
test('Unverified extracted facts and document statuses remain labelled as CRM claims',()=>{
 const m=buildCommercialMemory(card,{facts:[{type:'payment',text:'Paid according to email'}],
  businessObjects:[{type:'invoice',reference:'INV-X',status:'paid',amount:100,currency:'EUR'}],
  openLoops:[{title:'À confirmer',description:'Ancienne piste'}]},null);
 assert.equal(m.business[0].source,'CRM document, non rapproché de la comptabilité');
 assert.equal(m.facts[0].status,'unverified');
 assert.equal(m.openLoops[0].status,'unverified');
});
