import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const {PGlite}=await import(process.env.CONNECTOR_TEST_PGLITE_URL||'@electric-sql/pglite');
const db=new PGlite();
await db.exec('create schema private; create role anon; create role authenticated; create role service_role bypassrls; grant usage on schema private,public to service_role;');
await db.exec(await readFile(new URL('../migrations/20261011213500_commission_return_deductions.sql',import.meta.url),'utf8'));
const insert=async(month,company,reference,amount,cell='X4')=>db.query(`insert into private.commission_return_deductions
 (month,company,reference,commission_cents,source_fingerprint,source_file,source_sheet,amount_cell,net_formula_cell,net_formula)
 values ($1,$2,$3,$4,$5,'Synthetic source.xlsx',$6,$7,'W6','W1-X4')`,[month,company,reference,amount,'a'.repeat(64),month,cell]);
await insert('2026-06-01','TR','OLDER-ORDER',12345);await insert('2026-06-01','GTA','SECOND-ORDER',500,'X5');await insert('2026-05-01','TR','OTHER-MONTH',100);
const read=async(month)=>{
 await db.exec('begin;set local role service_role');
 try{return (await db.query('select public.api_owner_commission_returns($1) result',[month])).rows[0].result}
 finally{await db.exec('rollback')}
};
test('monthly source contains only explicit deductions in the requested month, across both companies',async()=>{
 const r=await read('2026-06');assert.equal(r.month,'2026-06');assert.equal(r.total,2);assert.equal(r.scope,'recorded_deductions_only');
 assert.deepEqual(r.deductions.map(x=>x.company),['GTA','TR']);assert.equal(r.deductions.find(x=>x.company==='TR').commission_cents,12345);
 assert.ok(r.deductions.every(x=>x.month==='2026-06'));assert.equal((await read('2026-07')).total,0);
});
test('anonymous and directly authenticated access to the table and RPC is denied',async()=>{
 for(const role of ['anon','authenticated']){
  await db.exec('begin;set local role '+role);
  try{await assert.rejects(db.query("select public.api_owner_commission_returns('2026-06')"),/permission denied/)}finally{await db.exec('rollback')}
  await db.exec('begin;set local role '+role);
  try{await assert.rejects(db.query('select * from private.commission_return_deductions'),/permission denied/)}finally{await db.exec('rollback')}
 }
});
test('wrong months, negative deductions and duplicate source cells are not accepted',async()=>{
 await assert.rejects(read('2026-13'),/invalid_month/);await assert.rejects(read("2026-06' or true"),/invalid_month/);
 await assert.rejects(insert('2026-07-01','TR','BAD',-10),/check constraint/);
 await assert.rejects(insert('2026-06-01','TR','DUPLICATE',12345),/unique constraint/);
});
test.after(()=>db.close());
