import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const {PGlite}=await import(process.env.CONNECTOR_TEST_PGLITE_URL||'@electric-sql/pglite');const db=new PGlite();
const actor='11111111-1111-4111-8111-111111111111',client='22222222-2222-4222-8222-222222222222',other='33333333-3333-4333-8333-333333333333';
await db.exec(`create schema private;create schema auth;create role anon;create role authenticated;create role service_role bypassrls;
 create table auth.users(id uuid primary key);insert into auth.users values('${actor}');
 create table public.clients(id uuid primary key,canonical_name text);insert into public.clients values('${client}','Synthetic A'),('${other}','Synthetic B');
 create table public.app_access_users(email text,role text,is_active boolean);insert into public.app_access_users values('owner@example.test','owner',true);
 create table private.owner_task_actors(actor uuid,email text);insert into private.owner_task_actors values('${actor}','owner@example.test');
 grant usage on schema public,private to service_role;grant select on public.clients,public.app_access_users,private.owner_task_actors to service_role;`);
await db.exec(await readFile(new URL('../migrations/20261012094954_client_sample_follow_up.sql',import.meta.url),'utf8'));
const mutate=async(action,id=null,version=null,payload={},rid=crypto.randomUUID(),user=actor)=>{
 await db.exec('begin;set local role service_role');try{const r=(await db.query('select public.api_owner_sample_mutate($1,$2,$3,$4,$5,$6) result',[rid,user,action,id,version,payload])).rows[0].result;await db.exec('commit');return r}catch(e){await db.exec('rollback');throw e}
};
const list=async(status='ALL',cid=null,query='',offset=0,user=actor)=>{
 await db.exec('begin;set local role service_role');try{return (await db.query('select public.api_owner_samples_list($1,$2,$3,$4,$5) result',[user,status,cid,query,offset])).rows[0].result}finally{await db.exec('rollback')}
};
let created;
test('create and lost-response replay persist one sample, with no status or client inferred from a name',async()=>{
 const rid=crypto.randomUUID(),payload={client_id:client,products:'Synthetic flower · 2 × 5 g',follow_up_at:'2026-01-01T10:00:00Z'};
 created=await mutate('create',null,null,payload,rid);assert.equal(created.ok,true);
 assert.deepEqual(await mutate('create',null,null,payload,rid),created);
 assert.equal((await mutate('create',null,null,{...payload,products:'Other'},rid)).error,'idempotency_conflict');
 const page=await list('ACTIVE',client);assert.equal(page.total,1);assert.equal(page.samples[0].status,'PLANNED');assert.equal(page.counts.overdue,1);
 assert.equal((await list('ALL',other)).total,0);assert.equal((await list('ALL',client,'nonexistent')).total,0);
});
test('status transitions are explicit, optimistic conflicts do not overwrite, and sent/received dates are recorded',async()=>{
 assert.equal((await mutate('move',created.sample_id,created.updated_at,{status:'WON'})).error,'invalid_transition');
 const sent=await mutate('move',created.sample_id,created.updated_at,{status:'SENT'});assert.equal(sent.ok,true);
 assert.equal((await mutate('edit',created.sample_id,created.updated_at,{notes:'Stale'})).error,'sample_conflict');
 const received=await mutate('move',created.sample_id,sent.updated_at,{status:'RECEIVED'});assert.equal(received.ok,true);
 const r=(await list('RECEIVED',client)).samples[0];assert.ok(r.sent_at&&r.received_at);assert.equal(r.notes,'');
 const won=await mutate('move',r.id,r.updated_at,{status:'WON'});assert.equal(won.ok,true);
 assert.equal((await list('ACTIVE',client)).total,0);assert.equal((await list('ALL',client)).counts.won,1);
 assert.equal((await mutate('move',r.id,won.updated_at,{status:'SENT'})).error,'invalid_transition');
});
test('client reassignment, invalid fields, missing clients and revoked owner access are refused',async()=>{
 assert.equal((await mutate('edit',created.sample_id,created.updated_at,{client_id:other})).error,'invalid_payload');
 assert.equal((await mutate('create',null,null,{client_id:crypto.randomUUID(),products:'Test'})).error,'client_not_found');
 assert.equal((await mutate('create',null,null,{client_id:client,products:'',notes:'Test'})).error,'invalid_products');
 assert.equal((await mutate('create',null,null,{client_id:client,products:'Test',follow_up_at:'not a date'})).error,'invalid_follow_up');
 assert.equal((await list('ALL',null,'',0,other)).error,'owner_only');
 await db.exec("update public.app_access_users set is_active=false");assert.equal((await list()).error,'owner_only');
 assert.equal((await mutate('create',null,null,{client_id:client,products:'Test'})).error,'owner_only');await db.exec("update public.app_access_users set is_active=true");
});
test('anonymous and direct authenticated SQL calls and tables stay private',async()=>{
 for(const role of ['anon','authenticated'])for(const sql of ['select * from private.client_samples',`select public.api_owner_samples_list('${actor}')`,
  `select public.api_owner_sample_mutate(gen_random_uuid(),'${actor}','create')`]){
  await db.exec('begin;set local role '+role);try{await assert.rejects(db.query(sql),/permission denied/)}finally{await db.exec('rollback')}
 }
});
test.after(()=>db.close());
