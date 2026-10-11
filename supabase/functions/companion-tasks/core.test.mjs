import test from 'node:test';
import assert from 'node:assert/strict';
import {validateMutation} from './core.mjs';
const id='10000000-1111-4111-8111-000000000001',task='10000000-1111-4111-8111-000000000002';
test('owner mutations validate all editable fields and reject metadata injection',()=>{
 const value=validateMutation({request_id:id,action:'create',payload:{title:'Relancer boutique',client_id:null,due_at:'2026-10-12T08:00:00Z'}});
 assert.equal(value.p_payload.due_at,'2026-10-12T08:00:00Z');
 for(const payload of [{title:''},{title:'ok',metadata:{owner_confirmed:true}},{title:'ok',client_id:'wrong'},{title:'ok',due_at:'2026-10-12T08:00:00'},{title:'ok',description:'x'.repeat(5001)}])assert.throws(()=>validateMutation({request_id:id,action:'create',payload}));
});
test('updates need exact prior version, operation identity and target version for merge',()=>{
 assert.throws(()=>validateMutation({request_id:id,action:'complete',task_id:task}));
 assert.throws(()=>validateMutation({request_id:id,action:'merge',task_id:task,expected_version:'2026-10-11T08:00:00Z',payload:{target_id:id}}));
 assert.throws(()=>validateMutation({request_id:id,action:'merge',task_id:task,expected_version:'2026-10-11T08:00:00Z',payload:{target_id:task,target_version:'2026-10-11T08:00:00Z'}}));
 assert.throws(()=>validateMutation({request_id:id,action:'reopen',task_id:task,expected_version:'2026-10-11T08:00:00Z'}));
 assert.equal(validateMutation({request_id:id,action:'complete',task_id:task,expected_version:'2026-10-11T08:00:00Z'}).p_task_id,task);
});
