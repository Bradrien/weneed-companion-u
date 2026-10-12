import test from 'node:test';
import assert from 'node:assert/strict';
import {parseWatch,notificationBody} from '../supabase/functions/stock-monitor/watch.mjs';
test('watch identity is an exact company and numeric product ID, never a product name or SKU guess',()=>{
 assert.deepEqual(parseWatch({company:'TR',product_id:123,watching:true}),{company:'TR',product_id:123,watching:true});
 for(const value of [null,[],{company:'TR',product_id:'123',watching:true},{company:'ALL',product_id:123,watching:true},
  {company:'TR',product_id:0,watching:true},{company:'TR',product_id:123,watching:'true'},
  {company:'TR',product_id:123,watching:true,owner_id:'other'},{company:'TR',product_id:1.5,watching:false}])assert.throws(()=>parseWatch(value),/invalid_watch/);
});
test('restock notifications identify the actual references without unbounded payloads',()=>{
 assert.equal(notificationBody([{kind:'back_in_stock',product_name:'Trim TR-500g'}]),'Retour en stock : Trim TR-500g');
 assert.match(notificationBody(Array.from({length:3},(_,i)=>({kind:'back_in_stock',product_name:'Produit '+i}))),/\+1 référence/);
 assert.equal(notificationBody([{kind:'out_of_stock'},{kind:'back_in_stock',product_name:'Test'}]),'1 rupture · 1 retour en stock');
 assert.ok(notificationBody([{kind:'back_in_stock',product_name:'a'.repeat(1000)}]).length<=250);
});
