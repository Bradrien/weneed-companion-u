import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Optional isolated SQL check: PGlite 0.5.8, never a production connection.
const { PGlite } = await import(process.env.CONNECTOR_TEST_PGLITE_URL || '@electric-sql/pglite');
const db = new PGlite();
await db.exec(`
create role anon; create role authenticated; create role service_role bypassrls;
create table public.connector_state (
 source text primary key,cursor jsonb not null default '{}',last_started_at timestamptz,
 last_success_at timestamptz,last_error text,updated_at timestamptz not null default now());
create table public.connector_runs (
 id uuid primary key,source text not null,status text not null,started_at timestamptz not null,
 finished_at timestamptz,fetched_count integer not null default 0,processed_count integer not null default 0,
 failed_count integer not null default 0,error text,metadata jsonb not null default '{}');
alter table public.connector_state enable row level security;
alter table public.connector_runs enable row level security;
grant usage on schema public to service_role;
grant select,insert,update on public.connector_state,public.connector_runs to service_role;
`);
await db.exec(await readFile(new URL('../migrations/20261011063823_google_connector_checkpoints.sql', import.meta.url), 'utf8'));
await db.exec(await readFile(new URL('../migrations/20261011065715_connector_status_coverage.sql', import.meta.url), 'utf8'));
const owner1 = '00000000-0000-4000-8000-000000000001', owner2 = '00000000-0000-4000-8000-000000000002';
const watermark = '2026-10-11T06:00:00Z';
const cursor = { sync_version: 2, scope: 'test', watermark_at: watermark,
 window: { since: '2026-10-11T05:50:00Z',until: '2026-10-11T06:10:00Z',page_token:'page-two',pending:['remaining'],next_page_token:null } };
const result = async (sql,args=[]) => (await db.query(sql,args)).rows[0].result;
async function fixture() {
  await db.exec('begin');
  await db.query('insert into public.connector_state(source,last_success_at) values ($1,$2)', ['gmail',watermark]);
  await db.exec('set local role service_role');
}
test('atomic lease blocks a competing run and rejects stale-owner checkpoint/finish', async () => {
  await fixture();
  try {
    assert.ok(await result('select public.claim_connector_sync($1,$2) result',['gmail',owner1]));
    assert.equal(await result('select public.claim_connector_sync($1,$2) result',['gmail',owner2]),null);
    assert.equal(await result('select public.checkpoint_connector_sync($1,$2,$3) result',['gmail',owner2,cursor]),false);
    assert.equal(await result('select public.finish_connector_sync($1,$2,null,$3,null,null,$4) result',['gmail',owner2,'failed',{}]),false);
    assert.equal(await result('select public.checkpoint_connector_sync($1,$2,$3) result',['gmail',owner1,cursor]),true);
  } finally { await db.exec('rollback'); }
});
test('partial finish preserves watermark and exact pending queue for the next cron', async () => {
  await fixture();
  try {
    await result('select public.claim_connector_sync($1,$2) result',['gmail',owner1]);
    await result('select public.checkpoint_connector_sync($1,$2,$3) result',['gmail',owner1,cursor]);
    assert.equal(await result('select public.finish_connector_sync($1,$2,$3,$4,null,null,$5) result',
      ['gmail',owner1,cursor,'partial',{fetched:25,processed:10,inserted:8,duplicates:2,failed:0,pages:1}]),true);
    const resumed = await result('select public.claim_connector_sync($1,$2) result',['gmail',owner2]);
    assert.deepEqual(resumed.cursor.window.pending,['remaining']);
    assert.equal(new Date(resumed.last_success_at).toISOString(),new Date(watermark).toISOString());
    const complete = {...cursor,watermark_at:'2026-10-11T06:10:00Z',window:null};
    assert.equal(await result('select public.finish_connector_sync($1,$2,$3,$4,null,$5,$6) result',
      ['gmail',owner2,complete,'success',complete.watermark_at,{fetched:1,processed:1,inserted:1,failed:0,pages:0}]),true);
    const current = (await db.query('select last_success_at,lease_owner,cursor from public.connector_state where source=$1',['gmail'])).rows[0];
    assert.equal(current.lease_owner,null);
    assert.equal(current.cursor.window,null);
    assert.equal(new Date(current.last_success_at).toISOString(),'2026-10-11T06:10:00.000Z');
  } finally { await db.exec('rollback'); }
});
test('expired lease marks interrupted run failed and permits durable resume', async () => {
  await fixture();
  try {
    await result('select public.claim_connector_sync($1,$2) result',['gmail',owner1]);
    await result('select public.checkpoint_connector_sync($1,$2,$3) result',['gmail',owner1,cursor]);
    await db.query("update public.connector_state set lease_expires_at=clock_timestamp()-interval '1 second' where source=$1",['gmail']);
    const resumed = await result('select public.claim_connector_sync($1,$2) result',['gmail',owner2]);
    assert.deepEqual(resumed.cursor.window.pending,['remaining']);
    const stale = (await db.query('select status,error from public.connector_runs where id=$1',[owner1])).rows[0];
    assert.deepEqual(stale,{status:'failed',error:'connector_lease_expired'});
    assert.equal(await result('select public.checkpoint_connector_sync($1,$2,$3) result',['gmail',owner1,cursor]),false);
  } finally { await db.exec('rollback'); }
});
test('success rejects an unfinished/missing window instead of advancing freshness', async () => {
  await fixture();
  try {
    await result('select public.claim_connector_sync($1,$2) result',['gmail',owner1]);
    await db.exec('savepoint invalid_finish');
    await assert.rejects(result('select public.finish_connector_sync($1,$2,$3,$4,null,$5,$6) result',
      ['gmail',owner1,cursor,'success',cursor.window.until,{}]), /unfinished_connector_window/);
    await db.exec('rollback to savepoint invalid_finish');
    await assert.rejects(result('select public.finish_connector_sync($1,$2,$3,$4,null,$5,$6) result',
      ['gmail',owner1,{},'success',cursor.window.until,{}]), /unfinished_connector_window/);
  } finally { await db.exec('rollback'); }
});
test('owner-status RPC emits bounded metadata without IDs, tokens or raw provider errors', async () => {
  await fixture();
  try {
    await result('select public.claim_connector_sync($1,$2) result',['gmail',owner1]);
    await result('select public.checkpoint_connector_sync($1,$2,$3) result',['gmail',owner1,cursor]);
    await db.query('update public.connector_state set last_error=$1 where source=$2',['private-customer@example.test token=secret','gmail']);
    const status = await result('select public.api_owner_connector_status() result');
    const encoded = JSON.stringify(status);
    assert.equal(status[0].continuation_pending,true);
    assert.equal(status[0].sync_in_progress,true);
    assert.equal(status[0].last_error,'connector_sync_failed');
    assert.ok(!encoded.includes('remaining') && !encoded.includes('page-two') && !encoded.includes('secret') && !encoded.includes(owner1));
  } finally { await db.exec('rollback'); }
});
test('anon/authenticated cannot execute any checkpoint or status RPC', async () => {
  for (const role of ['anon','authenticated']) {
    for (const signature of ['public.claim_connector_sync(text,uuid)','public.checkpoint_connector_sync(text,uuid,jsonb)',
      'public.finish_connector_sync(text,uuid,jsonb,text,text,timestamptz,jsonb)','public.api_owner_connector_status()']) {
      assert.equal(await result('select has_function_privilege($1,$2,$3) result',[role,signature,'EXECUTE']),false);
    }
    await db.exec('begin');
    try {
      await db.exec('set local role ' + role);
      await assert.rejects(db.query('select public.api_owner_connector_status()'), /permission denied/);
    } finally { await db.exec('rollback'); }
  }
});

test('first v2 replay status hides legacy success and preserves explicit text limitations', async () => {
  await fixture();
  try {
    await result('select public.claim_connector_sync($1,$2) result',['gmail',owner1]);
    const initial={...cursor,watermark_at:null};
    await result('select public.checkpoint_connector_sync($1,$2,$3) result',['gmail',owner1,initial]);
    await db.query("update public.connector_runs set metadata=$1 where id=$2",[{limited:3},owner1]);
    await db.query("update public.connector_state set last_error='drive_profile_missing' where source='gmail'");
    const status=await result('select public.api_owner_connector_status() result');
    assert.equal(status[0].last_success_at,null);
    assert.equal(status[0].continuation_pending,true);
    assert.equal(status[0].limited_count,3);
    assert.equal(status[0].last_error,'drive_profile_missing');
    await result('select public.checkpoint_connector_sync($1,$2,$3) result',['gmail',owner1,cursor]);
    const validated=await result('select public.api_owner_connector_status() result');
    assert.equal(validated[0].last_success_at,watermark);
  } finally { await db.exec('rollback'); }
});
test.after(async () => db.close());
