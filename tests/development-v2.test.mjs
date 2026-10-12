import test from 'node:test';
import assert from 'node:assert/strict';
import {reactivationProfile,sortReactivation} from '../validation-v12/assets/reactivation-v2.mjs';
import {buildStrategy} from '../validation-v12/assets/strategy-model.mjs';
import {validateSampleMutation} from '../supabase/functions/companion-samples/core.mjs';
import {normalizeSamplePage,normalizeSampleReply} from '../validation-v12/assets/sample-model-v2.mjs';
const id='11111111-1111-4111-8111-111111111111',sample='22222222-2222-4222-8222-222222222222',request='33333333-3333-4333-8333-333333333333';
const now='2026-10-12T09:00:00.000Z',profile={id,name:'Synthetic',verifiedOdooLink:true,odooAvailable:true,verifiedOrderCount:4,lastOrderAt:'2026-07-01',cadence:{medianGapDays:20,observations:3},revenueHT:1000};
test('reactivation uses verified positive purchases, actual cadence and a conservative one-date fallback',()=>{
 const p=reactivationProfile(profile,{generatedAt:now,now});assert.equal(p.eligible,true);assert.equal(p.threshold,33);assert.equal(p.days,103);
 const one=reactivationProfile({...profile,verifiedOrderCount:1,cadence:{observations:0,medianGapDays:null}},{generatedAt:now,now});assert.equal(one.threshold,60);
 assert.equal(reactivationProfile({...profile,lastOrderAt:'2026-09-25'},{generatedAt:now,now}).eligible,false);
 for(const changes of [{verifiedOdooLink:false},{odooAvailable:false},{verifiedOrderCount:0},{lastOrderAt:'2026-10-13'}])assert.equal(reactivationProfile({...profile,...changes},{generatedAt:now,now}).eligible,false);
 assert.equal(reactivationProfile(profile,{generatedAt:'2026-10-12T08:00:00Z',now}).reason,'refresh');
 assert.equal(reactivationProfile(profile,{generatedAt:'2026-10-12T10:00:00Z',now}).eligible,false);
});
test('high-priority client recommendations precede secondary ones; reactivation sorts by lateness',()=>{
 const body={version:'strategy_verified_v1',checked_at:now,clients:[{id,canonical_name:'Verify'},{id:sample,canonical_name:'One purchase'}],
  verified_links:[{client_id:sample,partner_odoo_id:4}],whatsapp:[],memories:[],odoo:{available:true,orders:[{id:1,partner_id:4,company:'TR',state:'sale',currency:'EUR',amount_ht:100,date:'2026-10-01'}]}};
 const rows=buildStrategy(body,12,now).clients;assert.equal(rows[0].id,id);assert.equal(rows[0].recommendations[0].priority,1);
 const sorted=sortReactivation([{name:'A',reactivation:{lateDays:20},revenueHT:100},{name:'B',reactivation:{lateDays:50},revenueHT:1}]);assert.equal(sorted[0].name,'B');
});
test('sample writes bind an exact client and reject actor, client reassignments, malformed versions and oversized content',()=>{
 const create={request_id:request,action:'create',payload:{client_id:id,products:'Indoor · 2 × 5 g',follow_up_at:now}};
 assert.equal(validateSampleMutation(create).p_payload.client_id,id);
 for(const body of [{...create,actor:id},{...create,payload:{...create.payload,products:2}},{...create,payload:{...create.payload,client_id:'Synthetic'}},
  {...create,payload:{...create.payload,notes:'x'.repeat(5001)}},{request_id:request,action:'edit',sample_id:sample,expected_version:now,payload:{client_id:id}},
  {request_id:request,action:'move',sample_id:sample,expected_version:'yesterday',payload:{status:'SENT'}},
  {request_id:request,action:'move',sample_id:sample,expected_version:now,payload:{status:'unknown'}}])assert.throws(()=>validateSampleMutation(body));
});
const row={id:sample,client_id:id,client_name:'Synthetic',status:'PLANNED',products:'<script>literal</script>',goal:'',notes:'',tracking:'',
 follow_up_at:now,sent_at:null,received_at:null,created_at:now,updated_at:now};
const page={ok:true,data:{version:'client_samples_v1',scope:'owner_recorded_samples',offset:0,limit:50,total:1,checked_at:now,counts:{active:1,overdue:1,won:0},samples:[row]}};
test('sample reads and acknowledgements require exact scope, rows, statuses and versions',()=>{
 const scope={status:'ACTIVE',clientId:id,offset:0};assert.equal(normalizeSamplePage(page,scope).rows[0].products,row.products);
 assert.throws(()=>normalizeSamplePage(page,{...scope,clientId:request}));assert.throws(()=>normalizeSamplePage({...page,data:{...page.data,total:2}},scope));
 assert.throws(()=>normalizeSamplePage({...page,data:{...page.data,samples:[{...row,status:'WON'}]}},scope));
 assert.throws(()=>normalizeSampleReply({ok:true,sample_id:sample,updated_at:'bad'},{action:'create'}),/samples_unavailable/);
 assert.throws(()=>normalizeSampleReply({ok:true,sample_id:request,updated_at:now},{action:'edit',sample_id:sample}),/samples_unavailable/);
});
