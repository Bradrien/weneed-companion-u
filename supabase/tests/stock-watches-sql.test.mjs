import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
const db=new PGlite(),owner='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222',scan='33333333-3333-4333-8333-333333333333';
await db.exec(`create schema private;create schema auth;create schema vault;create schema extensions;
 create role anon;create role authenticated;create role service_role bypassrls;
 grant usage on schema public,private to service_role;
 create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
 insert into auth.users values('${owner}','owner@example.test',now()),('${other}','other@example.test',now());
 create table public.app_access_users(email text,role text,is_active boolean);
 insert into public.app_access_users values('owner@example.test','owner',true);
 create table vault.secrets(id uuid default gen_random_uuid(),name text,secret text);
 create view vault.decrypted_secrets as select name,secret as decrypted_secret from vault.secrets;
 create function vault.create_secret(value text,key text) returns uuid language sql as $$insert into vault.secrets(name,secret) values(key,value) returning id$$;
 create function extensions.gen_random_bytes(n integer) returns bytea language sql as $$select decode(repeat('ab',n),'hex')$$;
 create function extensions.digest(value text,kind text) returns bytea language sql as $$select decode(md5(value),'hex')$$;`);
for(const name of ['202610101912_stock_monitor.sql','202610101917_stock_push.sql'])await db.exec(await readFile(new URL('../migrations/'+name,import.meta.url),'utf8'));
await db.exec(`insert into private.stock_scans(id,status) values('${scan}','success');
 update private.stock_monitor_state set last_success_scan='${scan}',last_success_at=now();
 insert into private.stock_products(company,company_id,product_id,sku,product_name,unit,quantity_basis,available_quantity,on_hand_quantity,last_scan)
 values('TR',1,7,'TR/7','Synthetic Trim','Units','free_qty',0,0,'${scan}'),('TR',1,8,'TR/8','Synthetic Other','g','free_qty',0,0,'${scan}'),('GTA',2,7,'GTA/7','Synthetic Trim','g','free_qty',0,0,'${scan}');
 select public.stock_push_register('${owner}','https://web.push.apple.com/legacy',jsonb_build_object('p256dh',repeat('a',87),'auth',repeat('b',22)));`);
await db.exec(await readFile(new URL('../migrations/20261012151121_stock_product_watches.sql',import.meta.url),'utf8'));
const rpc=async(sql,params=[])=>{await db.exec('begin;set local role service_role');try{const r=await db.query(sql,params);await db.exec('commit');return r.rows[0]?.result}catch(e){await db.exec('rollback');throw e}};
const watch=(company='TR',id=7,enabled=true,actor=owner)=>rpc('select public.stock_watch_set($1,$2,$3,$4) result',[actor,company,id,enabled]);
const device=(all=false)=>rpc(`select public.stock_push_register_scoped($1,'https://web.push.apple.com/selected',jsonb_build_object('p256dh',repeat('a',87),'auth',repeat('b',22)),$2) result`,[owner,all]);
const alert=async(company='TR',id=7,kind='back_in_stock',at='clock_timestamp()')=>{const a=crypto.randomUUID(),run=crypto.randomUUID();await db.exec(`insert into private.stock_scans(id,status) values('${run}','success');insert into private.stock_alerts(id,scan_id,company,product_id,sku,product_name,unit,kind,previous_quantity,current_quantity,created_at)
 values('${a}','${run}','${company}',${id},'SYNTHETIC','Synthetic ${company} ${id}','g','${kind}',0,10,${at})`);return a};
test('legacy subscriptions keep global notifications; targeted subscriptions explicitly select references',async()=>{
 const result=await rpc(`select public.stock_push_status($1,'https://web.push.apple.com/legacy') result`,[owner]);assert.deepEqual(result,{active:true,notify_all:true});
 await db.exec("update private.stock_push_devices set active=false where endpoint='https://web.push.apple.com/legacy'");
 await device();assert.deepEqual(await rpc(`select public.stock_push_status($1,'https://web.push.apple.com/selected') result`,[owner]),{active:true,notify_all:false});
});
test('watch persists across reads and search, with exact company and ID, and is idempotent',async()=>{
 await watch();const started=(await db.query('select started_at from private.stock_product_watches')).rows[0].started_at;
 await watch();assert.deepEqual((await db.query('select started_at from private.stock_product_watches')).rows[0].started_at,started);
 const tr=await rpc("select public.stock_read_owner_dashboard($1,'TR','Trim',0) result",[owner]);assert.equal(tr.items.length,1);assert.equal(tr.items[0].watching,true);
 const gta=await rpc("select public.stock_read_owner_dashboard($1,'GTA','Trim',0) result",[owner]);assert.equal(gta.items[0].watching,false);
 const empty=await rpc("select public.stock_read_owner_dashboard($1,'TR','Missing',0) result",[owner]);assert.deepEqual(empty.items,[]);
});
test('only future restocks of the selected identity are claimed, not another company, product, rupture or historical restock',async()=>{
 const expected=await alert();await alert('GTA');await alert('TR',8);await alert('TR',7,'out_of_stock');
 await alert('TR',7,'back_in_stock',"clock_timestamp()-interval '1 hour'");
 const claimed=await rpc('select public.stock_push_claim() result');assert.equal(claimed.length,1);assert.equal(claimed[0].alert_id,expected);
 await rpc('select public.stock_push_finish($1,$2,$3,$4)',[claimed[0].lease,claimed[0].device_id,[expected],'send_failed']);
 await watch('TR',7,false);await db.exec("update private.stock_push_delivery set next_attempt=now()-interval '1 second'");
 assert.deepEqual(await rpc('select public.stock_push_claim() result'),[]);
 await watch();assert.deepEqual(await rpc('select public.stock_push_claim() result'),[]);
});
test('global mode still notifies unselected products, and revoked owner access stops all delivery',async()=>{
 await device(true);const claimed=await rpc('select public.stock_push_claim() result');assert.ok(claimed.some(x=>x.company==='GTA'));
 await db.exec("update public.app_access_users set is_active=false");
 assert.deepEqual(await rpc('select public.stock_push_claim() result'),[]);
 await assert.rejects(watch(),/owner_only/);await db.exec("update public.app_access_users set is_active=true");
});
test('invalid identities, missing products, other users and direct client roles cannot read or mutate watches',async()=>{
 await assert.rejects(watch('ALL'),/invalid_watch/);await assert.rejects(watch('TR',999),/stock_product_not_found/);await assert.rejects(watch('TR',7,true,other),/owner_only/);
 for(const role of ['anon','authenticated'])for(const sql of ['select * from private.stock_product_watches',`select public.stock_watch_set('${owner}','TR',7,true)`,
  `select public.stock_read_owner_dashboard('${owner}')`,`select public.stock_push_status('${owner}','https://web.push.apple.com/selected')`]){
  await db.exec('begin;set local role '+role);try{await assert.rejects(db.query(sql),/permission denied/)}finally{await db.exec('rollback')}
 }
});
test.after(()=>db.close());
