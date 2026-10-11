import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeArchiveSummary,normalizeArchiveConversations,normalizeArchiveMessages} from '../validation-v12/assets/archive-model-d35.mjs';
const id=n=>'10000000-1111-4111-8111-'+String(n).padStart(12,'0'),time='2026-10-11T13:00:00Z';
const summary=()=>({ok:true,version:'whatsapp_archive_summary_v2',scope:'approved_archives_only_exclusions_applied',read_at:time,
 conversations:2,linked_conversations:1,needs_review:1,messages:200,audio:20,audio_available:20,transcribed:2,
 first_message_at:'2025-09-01T12:00:00Z',last_message_at:time,
 pilots:[{authorized_at:time,hard_limit_usd:1,reserve_limit_usd:.6,reserved_usd:.05,jobs:2,pending:0,processing:0,done:2,errors:0}]});
const conversation=n=>({batch_id:id(1),chat_pk:n,client_id:null,display_name:'Conversation de test '+n,phone_e164:null,
 link_state:'needs_review',message_count:2,audio_count:1,first_message_at:time,last_message_at:time});
const page=(offset=0,total=101)=>({ok:true,version:'whatsapp_archive_conversations_v2',scope:'approved_archives_only_exclusions_applied',
 conversations:Array.from({length:Math.min(100,Math.max(0,total-offset))},(_,i)=>conversation(offset+i+1)),
 clients:[{id:id(2),canonical_name:'Client de test'}],total,offset,limit:100,next_offset:offset+100<total?offset+100:null});
const message=(pk=2)=>({id:id(pk+10),batch_id:id(1),chat_pk:1,local_message_pk:pk,occurred_at:time,client_id:id(2),
 is_outbound:false,display_name:'Conversation de test',text_body:'Texte original <script>literal</script>',
 audio_id:id(50+pk),archive_status:'verified',transcription_status:'done',transcript_text:'Transcription à vérifier',duration_seconds:1.5});
const response=(messages=[message()])=>({ok:true,messages,next_cursor:null});
const chatScope={batch_id:id(1),chat_pk:1};
test('archive coverage and pilot progress are evidence, reserved costs stay distinct from effective charges',()=>{
 const r=normalizeArchiveSummary(summary());assert.equal(r.transcribed,2);assert.equal(r.audio_available-r.transcribed,18);
 assert.equal(r.pilots[0].jobs,2);assert.equal(r.pilots[0].reserved_usd,.05);assert.equal(r.pilots[0].hard_limit_usd,1);
 assert.ok(!Object.hasOwn(r,'charged_usd'));assert.ok(!Object.hasOwn(r,'tasks_created'));
});
test('summary totals, approvals, date range and budget ceilings must agree',()=>{
 for(const change of [{scope:'all_data'},{needs_review:0},{audio_available:21},{transcribed:21},{audio:201},
  {read_at:'2026-02-30T00:00:00Z'},{first_message_at:'2026-10-12T00:00:00Z'}])assert.throws(()=>normalizeArchiveSummary({...summary(),...change}));
 for(const change of [{reserved_usd:.61},{reserve_limit_usd:1.1},{hard_limit_usd:'1'},{done:3}]){
  const r=summary();Object.assign(r.pilots[0],change);assert.throws(()=>normalizeArchiveSummary(r));
 }
});
test('conversation pages preserve missing links and expose an exact remaining page',()=>{
 const first=normalizeArchiveConversations(page());assert.equal(first.conversations.length,100);assert.equal(first.nextOffset,100);
 assert.equal(first.conversations[0].client_id,null);assert.equal(first.conversations[0].phone_e164,null);
 const last=normalizeArchiveConversations(page(100),100);assert.equal(last.conversations.length,1);assert.equal(last.nextOffset,null);
 assert.equal(normalizeArchiveConversations(page(0,0)).conversations.length,0);
});
test('wrong offsets, loops, duplicate conversations and forged verified links are refused',()=>{
 assert.throws(()=>normalizeArchiveConversations(page(100),0));
 for(const change of [{next_offset:0},{total:50},{scope:'all_data'}])assert.throws(()=>normalizeArchiveConversations({...page(),...change}));
 const dup=page();dup.conversations[1]=dup.conversations[0];assert.throws(()=>normalizeArchiveConversations(dup));
 const forged=page();forged.conversations[0].link_state='verified';assert.throws(()=>normalizeArchiveConversations(forged));
});
test('original text, fractional audio duration and provenance stay unchanged without generating current tasks',()=>{
 const r=normalizeArchiveMessages(response(),chatScope).messages[0];
 assert.equal(r.text_body,'Texte original <script>literal</script>');assert.equal(r.duration_seconds,1.5);assert.equal(r.local_message_pk,2);
 assert.equal(r.transcript_text,'Transcription à vérifier');assert.ok(!Object.hasOwn(r,'task'));
 assert.equal(normalizeArchiveMessages(response(),{client_id:id(2)}).messages.length,1);
});
test('message scope cannot change to another client, conversation or batch',()=>{
 for(const change of [{chat_pk:3},{batch_id:id(3)},{is_outbound:'false'},{local_message_pk:0},{occurred_at:0}])
  assert.throws(()=>normalizeArchiveMessages(response([{...message(),...change}]),chatScope));
 assert.throws(()=>normalizeArchiveMessages(response(),{client_id:id(3)}));
});
test('only verified completed transcriptions are exposed; unfinished text stays hidden',()=>{
 const m={...message(),transcription_status:'processing',transcript_text:'Partiel'};
 assert.equal(normalizeArchiveMessages(response([m]),chatScope).messages[0].transcript_text,null);
 for(const change of [{archive_status:'pending'},{transcript_text:''},{duration_seconds:'1.5'},{transcription_status:'payable'}])
  assert.throws(()=>normalizeArchiveMessages(response([{...message(),...change}]),chatScope));
});
test('message order and continuation must agree with the last original message',()=>{
 const r=response([message(3),message(2)]);r.next_cursor=JSON.stringify({at:time,pk:2});
 assert.equal(JSON.parse(normalizeArchiveMessages(r,chatScope).next_cursor).pk,2);
 assert.throws(()=>normalizeArchiveMessages(response([message(2),message(3)]),chatScope));
 assert.throws(()=>normalizeArchiveMessages(response([message(),message()]),chatScope));
 for(const next_cursor of ['{}','null','not-json',JSON.stringify({at:time,pk:3})])
  assert.throws(()=>normalizeArchiveMessages({...r,next_cursor},chatScope));
});
