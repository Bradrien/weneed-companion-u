import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeTaskPage,normalizeTaskMutationReply} from '../validation-v12/assets/task-model-d36.mjs';
const id=n=>'10000000-1111-4111-8111-'+String(n).padStart(12,'0'),time='2026-10-11T14:00:00Z';
const task=(n=1)=>({id:id(n),client_id:id(300),client_name:'Client de test',title:'Action '+n,description:'Texte original',
 status:'OPEN',is_suggested:false,updated_at:time,due_at:null,reminder_sync_status:'SYNCED',reminder_action:'UPSERT',reminder_synced_at:time,
 reminder_reason:'eligible'});
const page=(tasks=[task()],total=tasks.length)=>({ok:true,data:{tasks,total,limit:200,checked_at:time}});
const scope={status:'OPEN',clientId:null,offset:0};
test('task page preserves source versions, literal descriptions and dated reminder evidence',()=>{
 const r=normalizeTaskPage(page(),scope);assert.equal(r.rows[0].updated_at,time);assert.equal(r.rows[0].reminder_synced_at,time);
 assert.equal(r.rows[0].description,'Texte original');assert.equal(r.rows[0].client_id,id(300));assert.equal(r.total,1);
 assert.equal(normalizeTaskPage(page(),{...scope,clientId:id(300)}).rows.length,1);
});
test('status and exact client identity cannot change behind a selected filter',()=>{
 for(const change of [{status:'DONE'},{client_id:id(301)}])assert.throws(()=>normalizeTaskPage(page([{...task(),...change}]),{...scope,clientId:id(300)}));
 assert.equal(normalizeTaskPage(page([{...task(),status:'DONE'}]),{...scope,status:'ALL'}).rows.length,1);
 assert.throws(()=>normalizeTaskPage(page([{...task(),status:'SUPERSEDED'}]),{...scope,status:'ALL'}));
});
test('task pagination respects the two-hundred-row limit and the exact page count',()=>{
 const rows=Array.from({length:200},(_,i)=>task(i+1));assert.equal(normalizeTaskPage(page(rows,201),scope).rows.length,200);
 assert.equal(normalizeTaskPage(page([task(201)],201),{...scope,offset:200}).rows.length,1);
 assert.throws(()=>normalizeTaskPage(page(rows,199),scope));
 assert.throws(()=>normalizeTaskPage(page(rows.concat(task(201)),201),scope));
 assert.throws(()=>normalizeTaskPage(page([task(),task()]),scope));
});
test('missing versions, impossible dates, coerced flags and unknown reminder states are not accepted',()=>{
 for(const change of [{updated_at:null},{updated_at:'2026-02-30T00:00:00Z'},{due_at:0},{is_suggested:'false'},
  {reminder_sync_status:'promised'},{id:'named-person'},{client_id:'client-name'}])assert.throws(()=>normalizeTaskPage(page([{...task(),...change}]),scope));
 assert.throws(()=>normalizeTaskPage({...page(),ok:false},scope));
 assert.throws(()=>normalizeTaskPage(page([],1),scope));
});
test('a mutation acknowledgement is bound to the exact target and a valid returned identity',()=>{
 const request={action:'complete',task_id:id(1),payload:{}};
 assert.equal(normalizeTaskMutationReply({ok:true,task_id:id(1),updated_at:time},request).task_id,id(1));
 for(const change of [{task_id:id(2)},{task_id:'guess'},{ok:false},{duplicate:true},{existing_suggestion_approved:true},{updated_at:0}])
  assert.throws(()=>normalizeTaskMutationReply({ok:true,task_id:id(1),...change},request));
});
test('explicit create deduplication and the chosen merge target remain supported',()=>{
 const create=normalizeTaskMutationReply({ok:true,task_id:id(2),duplicate:true},{action:'create',payload:{}});
 assert.equal(create.duplicate,true);assert.equal(create.updated_at,null);
 const approve=normalizeTaskMutationReply({ok:true,task_id:id(2),existing_suggestion_approved:true},{action:'create',payload:{}});
 assert.equal(approve.existing_suggestion_approved,true);
 assert.equal(normalizeTaskMutationReply({ok:true,task_id:id(2)},{action:'merge',task_id:id(1),payload:{target_id:id(2)}}).task_id,id(2));
 assert.throws(()=>normalizeTaskMutationReply({ok:true,task_id:id(3)},{action:'merge',task_id:id(1),payload:{target_id:id(2)}}));
});
