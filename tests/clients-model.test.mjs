import test from 'node:test';
import assert from 'node:assert/strict';
import {validClientId,normalizeClientList,normalizeClientCard,normalizeCrmDashboard} from '../assets/clients-model.mjs';
const id='fef12218-1111-4111-8111-bb011ac01ac0';
test('client list accepts the server read-only shape',()=>{
 const rows=normalizeClientList([{client_id:id,canonical_name:'CBD Shop',status:'ACTIVE',summary:'client',open_task_count:2,overdue_task_count:1,event_count:4}]);
 assert.equal(rows[0].openTasks,2);assert.equal(rows[0].name,'CBD Shop');
});
test('client list rejects invalid and duplicate identifiers',()=>{
 assert.throws(()=>normalizeClientList([{client_id:'../all',canonical_name:'A'}]));
 assert.throws(()=>normalizeClientList([{client_id:id,canonical_name:'A'},{client_id:id,canonical_name:'B'}]));
});
test('client card identity must match selected client',()=>{
 const card={profile:{id,name:'CBD Shop'},attention:{tasks:[{title:'Follow up',due_at:'2026-10-13'}]}};
 assert.equal(normalizeClientCard(card,id).attention.tasks[0].title,'Follow up');
 assert.throws(()=>normalizeClientCard(card,'ffff2218-1111-4111-8111-bb011ac01ac0'));
});
test('client content stays text and bounded, with no HTML interpretation',()=>{
 const card=normalizeClientCard({profile:{id,name:'<script>bad</script>'},memory:{summary:'X'.repeat(3000)}},id);
 assert.equal(card.profile.name,'<script>bad</script>');
 assert.equal(card.memory.length,1800);
 assert.equal(validClientId('javascript:alert(1)'),false);
});
test('nullable card arrays and counters are handled safely',()=>{
 const card=normalizeClientCard({profile:{id,name:'Example'},attention:{overdue_task_count:null}},id);
 assert.deepEqual(card.contacts,[]);
 assert.equal(card.attention.overdueTasks,0);
});

test('CRM dashboard handles empty data without inventing task amounts',()=>{
 const d=normalizeCrmDashboard({stats:{clients_total:131,open_actionable_tasks:2,overdue_actionable_tasks:0}});
 assert.equal(d.clients,131);assert.equal(d.tasks,2);
 assert.deepEqual(d.attention,[]);
});
test('CRM dashboard rejects missing stats and invalid client IDs',()=>{
 assert.throws(()=>normalizeCrmDashboard(null));
 assert.throws(()=>normalizeCrmDashboard({stats:{},attention_clients:[{client_id:'../../secret',canonical_name:'no'}]}));
});
