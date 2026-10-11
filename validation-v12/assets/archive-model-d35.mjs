import {sourceTime,sourceCount,sourceText} from './source-state-d34.mjs';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const scope='approved_archives_only_exclusions_applied';
const uuid=x=>{if(typeof x!=='string'||!UUID.test(x))throw Error('invalid_archive_id');return x};
const positive=x=>{sourceCount(x,Number.MAX_SAFE_INTEGER);if(!x)throw Error('invalid_archive_id');return x};
const text=(x,max,empty=false)=>sourceText(x,max,{empty});
const optionalText=(x,max)=>x==null?null:text(x,max,true);
const requiredTime=x=>{const t=sourceTime(x);if(!t)throw Error('invalid_archive_time');return t};
const object=x=>{if(!x||typeof x!=='object'||Array.isArray(x))throw Error('invalid_archive_response');return x};
export function normalizeArchiveSummary(raw){
 object(raw);
 if(raw.ok!==true||raw.version!=='whatsapp_archive_summary_v2'||raw.scope!==scope||!Array.isArray(raw.pilots)||raw.pilots.length>50)throw Error('invalid_archive_summary');
 const result={read_at:requiredTime(raw.read_at)};
 for(const k of ['conversations','linked_conversations','needs_review','messages','audio','audio_available','transcribed'])result[k]=sourceCount(raw[k],10_000_000);
 if(result.linked_conversations+result.needs_review!==result.conversations||result.audio_available>result.audio||result.transcribed>result.audio_available||result.audio>result.messages)throw Error('invalid_archive_summary');
 result.first_message_at=sourceTime(raw.first_message_at);result.last_message_at=sourceTime(raw.last_message_at);
 if(result.messages&&(!result.first_message_at||!result.last_message_at)||result.first_message_at&&result.last_message_at&&Date.parse(result.first_message_at)>Date.parse(result.last_message_at))throw Error('invalid_archive_summary');
 result.pilots=raw.pilots.map(p=>{
  object(p);const out={authorized_at:requiredTime(p.authorized_at)};
  for(const key of ['hard_limit_usd','reserve_limit_usd','reserved_usd']){
   if(typeof p[key]!=='number'||!Number.isFinite(p[key])||p[key]<0||p[key]>1)throw Error('invalid_archive_budget');out[key]=p[key];
  }
  if(!out.hard_limit_usd||!out.reserve_limit_usd||out.reserved_usd>out.reserve_limit_usd||out.reserve_limit_usd>out.hard_limit_usd)throw Error('invalid_archive_budget');
  for(const k of ['jobs','pending','processing','done','errors'])out[k]=sourceCount(p[k]);
  if(out.jobs!==out.pending+out.processing+out.done+out.errors)throw Error('invalid_archive_summary');return out;
 });
 return result;
}
export function normalizeArchiveConversations(raw,expectedOffset=0){
 object(raw);
 if(raw.ok!==true||raw.version!=='whatsapp_archive_conversations_v2'||raw.scope!==scope||!Array.isArray(raw.conversations)||
  !Array.isArray(raw.clients)||raw.clients.length>1000||raw.conversations.length>100||raw.offset!==expectedOffset||raw.limit!==100)throw Error('invalid_archive_conversations');
 const total=sourceCount(raw.total),offset=sourceCount(raw.offset,50000),nextOffset=raw.next_offset===null?null:sourceCount(raw.next_offset,50000);
 if(raw.conversations.length!==Math.min(100,Math.max(0,total-offset))||nextOffset!==(offset+100<total?offset+100:null))throw Error('invalid_archive_conversations');
 const seen=new Set(),conversations=raw.conversations.map(c=>{
  object(c);const batch=uuid(c.batch_id),chat=positive(c.chat_pk),key=batch+':'+chat;
  if(seen.has(key)||!['needs_review','verified','manual'].includes(c.link_state))throw Error('invalid_archive_conversations');seen.add(key);
  const client=c.client_id===null?null:uuid(c.client_id),messages=sourceCount(c.message_count),audio=sourceCount(c.audio_count),
   first=requiredTime(c.first_message_at),last=requiredTime(c.last_message_at);
  if(audio>messages||Date.parse(first)>Date.parse(last)||!client&&c.link_state!=='needs_review')throw Error('invalid_archive_conversations');
  return {batch_id:batch,chat_pk:chat,client_id:client,display_name:text(c.display_name,1000),phone_e164:optionalText(c.phone_e164,60),
   link_state:c.link_state,message_count:messages,audio_count:audio,first_message_at:first,last_message_at:last};
 });
 const clientIds=new Set(),clients=raw.clients.map(c=>{
  object(c);const id=uuid(c.id);if(clientIds.has(id))throw Error('invalid_archive_conversations');clientIds.add(id);
  return {id,canonical_name:text(c.canonical_name,1000)};
 });
 return {conversations,clients,total,offset,nextOffset};
}
export function normalizeArchiveMessages(raw,expectedScope){
 object(raw);
 if(raw.ok!==true||!Array.isArray(raw.messages)||raw.messages.length>60)throw Error('invalid_archive_messages');
 const client=expectedScope.client_id?uuid(expectedScope.client_id):null;
 const batch=client?null:uuid(expectedScope.batch_id),chat=client?null:positive(expectedScope.chat_pk);
 const ids=new Set(),messages=raw.messages.map(m=>{
  object(m);const id=uuid(m.id),b=uuid(m.batch_id),c=positive(m.chat_pk),pk=positive(m.local_message_pk),at=requiredTime(m.occurred_at),clientId=m.client_id===null?null:uuid(m.client_id);
  if(ids.has(id)||typeof m.is_outbound!=='boolean'||client&&clientId!==client||!client&&(b!==batch||c!==chat))throw Error('invalid_archive_messages');ids.add(id);
  const audio=m.audio_id==null?null:uuid(m.audio_id),transcript=optionalText(m.transcript_text,100000),duration=m.duration_seconds;
  if(audio&&(!['pending','uploaded','verified','unavailable','error'].includes(m.archive_status)||
   !['pending','processing','done','error','skipped'].includes(m.transcription_status)||
   duration!==null&&(typeof duration!=='number'||!Number.isFinite(duration)||duration<0||duration>86400)||
   m.transcription_status==='done'&&(m.archive_status!=='verified'||!transcript?.trim())))throw Error('invalid_archive_messages');
  return {id,batch_id:b,chat_pk:c,local_message_pk:pk,occurred_at:at,client_id:clientId,is_outbound:m.is_outbound,
   display_name:text(m.display_name,1000),text_body:optionalText(m.text_body,100000),audio_id:audio,
   archive_status:audio?m.archive_status:null,transcription_status:audio?m.transcription_status:null,
   transcript_text:audio&&m.transcription_status==='done'?transcript:null,duration_seconds:audio?duration:null};
 });
 for(let i=1;i<messages.length;i++){
  const a=messages[i-1],b=messages[i];
  if(Date.parse(b.occurred_at)>Date.parse(a.occurred_at)||Date.parse(b.occurred_at)===Date.parse(a.occurred_at)&&b.local_message_pk>a.local_message_pk)throw Error('invalid_archive_messages');
 }
 let next=raw.next_cursor;
 if(next!==null){
  if(typeof next!=='string'||next.length>300||!messages.length)throw Error('invalid_archive_cursor');
  let parsed;try{parsed=JSON.parse(next)}catch{throw Error('invalid_archive_cursor')}
  object(parsed);const at=requiredTime(parsed.at),pk=positive(parsed.pk),last=messages.at(-1);
  if(Date.parse(at)!==Date.parse(last.occurred_at)||pk!==last.local_message_pk)throw Error('invalid_archive_cursor');next=JSON.stringify({at,pk});
 }
 return {messages,next_cursor:next};
}
