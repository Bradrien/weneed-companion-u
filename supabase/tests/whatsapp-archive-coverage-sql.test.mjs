import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const {PGlite}=await import(process.env.CONNECTOR_TEST_PGLITE_URL||'@electric-sql/pglite');
const db=new PGlite();
await db.exec(`
create role anon;create role authenticated;create role service_role bypassrls;
create table public.whatsapp_import_batches(id uuid primary key,source_key text);
create table public.whatsapp_import_exclusions(source_key text,chat_pk bigint);
create table public.whatsapp_archive_conversations(batch_id uuid,chat_pk bigint,client_id uuid,display_name text,phone_e164 text,
 link_state text,message_count integer,audio_count integer,first_message_at timestamptz,last_message_at timestamptz,primary key(batch_id,chat_pk));
create table public.whatsapp_import_staging(id uuid primary key,batch_id uuid,chat_pk bigint);
create table public.whatsapp_import_audio_assets(id uuid primary key,staged_message_id uuid,archive_status text,transcription_status text);
create table public.whatsapp_archive_pilots(id uuid primary key,batch_id uuid,authorized_at timestamptz,hard_limit_usd numeric,
 reserve_limit_usd numeric,reserved_usd numeric);
create table public.whatsapp_archive_transcription_jobs(audio_id uuid primary key,pilot_id uuid,status text);
alter table public.whatsapp_import_batches enable row level security;
alter table public.whatsapp_import_exclusions enable row level security;
alter table public.whatsapp_archive_conversations enable row level security;
alter table public.whatsapp_import_staging enable row level security;
alter table public.whatsapp_import_audio_assets enable row level security;
alter table public.whatsapp_archive_pilots enable row level security;
alter table public.whatsapp_archive_transcription_jobs enable row level security;
grant usage on schema public to service_role;
grant select on all tables in schema public to service_role;
`);
await db.exec(await readFile(new URL('../migrations/20261011140000_whatsapp_archive_read_coverage.sql',import.meta.url),'utf8'));
const id=n=>'10000000-1111-4111-8111-'+String(n).padStart(12,'0'),source='whatsapp_business_ios_2026_10_08';
await db.query('insert into public.whatsapp_import_batches values ($1,$2),($3,$4)',[id(1),source,id(2),'unapproved_other_source']);
for(let i=1;i<=102;i++){
 await db.query('insert into public.whatsapp_archive_conversations values($1,$2,$3,$4,null,$5,3,1,$6,$6)',
  [id(1),i,i%2===0?id(3):null,'Conversation de test '+i,i%2===0?'verified':'needs_review','2026-10-08T12:00:00Z']);
 await db.query('insert into public.whatsapp_import_staging values($1,$2,$3)',[id(1000+i),id(1),i]);
 await db.query('insert into public.whatsapp_import_audio_assets values($1,$2,$3,$4)',[id(2000+i),id(1000+i),'verified',i<=2?'done':'skipped']);
}
await db.query('insert into public.whatsapp_archive_conversations values($1,500,null,$2,null,$3,9999,5,$4,$4)',
 [id(2),'Conversation autre source','needs_review','2026-10-08T12:00:00Z']);
await db.query('insert into public.whatsapp_import_exclusions values($1,2)',[source]);
await db.query('insert into public.whatsapp_import_staging values($1,$2,999)',[id(999),id(1)]);
await db.query('insert into public.whatsapp_import_audio_assets values($1,$2,$3,$4)',[id(2999),id(999),'verified','done']);
await db.query('insert into public.whatsapp_archive_pilots values($1,$2,$3,1,.6,.045)',[id(10),id(1),'2026-10-10T20:00:00Z']);
for(const [n,status] of [[1,'done'],[2,'done'],[3,'error'],[4,'pending'],[6,'processing']])
 await db.query('insert into public.whatsapp_archive_transcription_jobs values($1,$2,$3)',[id(2000+n),id(10),status]);
const read=async(sql,args=[])=>{
 await db.exec('begin;set local role service_role');
 try{return (await db.query(sql,args)).rows[0].result}finally{await db.exec('rollback')}
};
test('summary applies current exclusions, approved source and approved conversation scope to every count',async()=>{
 const r=await read('select public.whatsapp_archive_summary_v2() result');
 assert.equal(r.version,'whatsapp_archive_summary_v2');assert.equal(r.scope,'approved_archives_only_exclusions_applied');
 assert.equal(r.conversations,101);assert.equal(r.linked_conversations,50);assert.equal(r.needs_review,51);
 assert.equal(r.messages,303);assert.equal(r.audio,101);assert.equal(r.audio_available,101);assert.equal(r.transcribed,1);
 assert.equal(r.pilots[0].jobs,4);assert.equal(r.pilots[0].done,1);assert.equal(r.pilots[0].pending,1);
 assert.equal(r.pilots[0].processing,1);assert.equal(r.pilots[0].errors,1);assert.equal(r.pilots[0].reserved_usd,.045);
 assert.ok(!JSON.stringify(r).includes('Conversation'));assert.ok(!Object.hasOwn(r.pilots[0],'id'));
});
test('bounded stable pages list every approved conversation once and never list excluded or foreign records',async()=>{
 const a=await read('select public.whatsapp_archive_conversations_page(null,0) result');
 const b=await read('select public.whatsapp_archive_conversations_page(null,100) result');
 assert.equal(a.total,101);assert.equal(a.conversations.length,100);assert.equal(a.next_offset,100);
 assert.equal(b.conversations.length,1);assert.equal(b.next_offset,null);assert.equal(b.conversations[0].chat_pk,102);
 const chats=a.conversations.concat(b.conversations).map(c=>c.chat_pk);
 assert.equal(new Set(chats).size,101);assert.ok(!chats.includes(2)&&!chats.includes(500)&&!chats.includes(999));
});
test('client-scoped page uses only explicit links and oversized or negative offsets are rejected',async()=>{
 const r=await read('select public.whatsapp_archive_conversations_page($1,0) result',[id(3)]);
 assert.equal(r.total,50);assert.ok(r.conversations.every(c=>c.client_id===id(3)&&c.chat_pk%2===0));
 await assert.rejects(read('select public.whatsapp_archive_conversations_page(null,-1) result'),/invalid_archive_offset/);
 await assert.rejects(read('select public.whatsapp_archive_conversations_page(null,50001) result'),/invalid_archive_offset/);
 await assert.rejects(read('select public.whatsapp_archive_conversations_page(null,0,501) result'),/invalid_archive_limit/);
 const compatible=await read('select public.whatsapp_archive_conversations_page(null,0,500) result');
 assert.equal(compatible.conversations.length,101);assert.equal(compatible.next_offset,null);
});
test('neither an anonymous nor a directly authenticated client can call the archive RPCs',async()=>{
 for(const role of ['anon','authenticated']){
  await db.exec('begin;set local role '+role);
  try{await assert.rejects(db.query('select public.whatsapp_archive_summary_v2()'),/permission denied/)}finally{await db.exec('rollback')}
  await db.exec('begin;set local role '+role);
  try{await assert.rejects(db.query('select public.whatsapp_archive_conversations_page(null,0)'),/permission denied/)}finally{await db.exec('rollback')}
 }
});
test.after(()=>db.close());
