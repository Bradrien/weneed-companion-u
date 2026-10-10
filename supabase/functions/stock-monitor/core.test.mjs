import test from 'node:test';
import assert from 'node:assert/strict';
import {readStock,stockTransition} from './core.mjs';
const env={ODOO_URL:'https://odoo.example.com',ODOO_DB:'fixture',ODOO_USERNAME:'fixture',ODOO_API_KEY:'fixture',ODOO_UID_PIN:'7'};
const previous={available_quantity:4,quantity_basis:'free_qty',unit:'g'};
test('baseline is quiet',()=>assert.equal(stockTransition(null,previous),null));
test('rupture includes negative available quantities',()=>assert.equal(stockTransition(previous,{...previous,available_quantity:-1}),'out_of_stock'));
test('return requires positive stock',()=>assert.equal(stockTransition({...previous,available_quantity:0},previous),'back_in_stock'));
test('unchanged rupture does not repeat',()=>assert.equal(stockTransition({...previous,available_quantity:-1},{...previous,available_quantity:0}),null));
test('regular variations are quiet by default',()=>assert.equal(stockTransition(previous,{...previous,available_quantity:3}),null));
test('all-change preference preserves variations',()=>assert.equal(stockTransition(previous,{...previous,available_quantity:3},'all_changes'),'quantity_changed'));
test('unit changes establish new baseline',()=>assert.equal(stockTransition(previous,{...previous,unit:'kg',available_quantity:0}),null));
test('quantity basis changes establish new baseline',()=>assert.equal(stockTransition(previous,{...previous,quantity_basis:'qty_available',available_quantity:0}),null));
const companies=[{id:1,name:'Global Trust Agriculture SA'},{id:2,name:'Trim Rocket s.r.o.'}];
const product={id:20,name:'Fixture',default_code:'FIXTURE',uom_id:[1,'g'],company_id:false,free_qty:2,qty_available:3,virtual_available:4};
function fixture(options={}){
 const calls=[];
 return {calls,fetch:async(url,request)=>{
  const {service,args}=JSON.parse(request.body).params;
  let result;
  if(service==='common')result=options.uid??7;
  else{
   const [db,uid,key,model,method,domain,kwargs]=args;
   calls.push({model,method,domain,kwargs});
   if(model==='res.company')result=options.companies??companies;
   else if(method==='fields_get')result={...options.metadata,...Object.fromEntries(['id','name','default_code','uom_id','company_id','sale_ok','active','type','qty_available','free_qty','virtual_available'].filter(k=>options.omit!==k).map(k=>[k,{type:'field'}]))};
   else result=options.products??[{...product,...options.product}];
  }
  return new Response(JSON.stringify({result}),{headers:{'content-type':'application/json'}});
 }};
}
test('both companies use their own allowed_company_ids context',async()=>{
 const f=fixture();const result=await readStock(env,f.fetch);
 assert.deepEqual(result.rows.map(r=>[r.company,r.available_quantity]),[['GTA',2],['TR',2]]);
 assert.deepEqual(f.calls.filter(c=>c.method==='search_read'&&c.model==='product.product').map(c=>c.kwargs.context.allowed_company_ids),[[1],[2]]);
 assert.ok(f.calls.every(c=>['search_read','fields_get'].includes(c.method)));
});
test('unverified company scope rejects entire snapshot',async()=>{const f=fixture({companies:[companies[0]]});await assert.rejects(readStock(env,f.fetch),/stock_company_scope_unverified/)});
test('pinned Odoo identity mismatch rejects read',async()=>{const f=fixture({uid:8});await assert.rejects(readStock(env,f.fetch),/odoo_credentials_rejected/)});
test('missing available quantity is never inferred as zero',async()=>{const f=fixture({product:{free_qty:false}});await assert.rejects(readStock(env,f.fetch),/invalid_stock_response/)});
test('empty company cannot overwrite baseline',async()=>{const f=fixture({products:[]});await assert.rejects(readStock(env,f.fetch),/stock_empty_company/)});
test('company-owned product from another company fails closed',async()=>{const f=fixture({product:{company_id:[2,'TR']}});await assert.rejects(readStock(env,f.fetch),/stock_company_scope_unverified/)});
test('physical-stock fallback is explicitly labelled',async()=>{const f=fixture({omit:'free_qty'});const r=await readStock(env,f.fetch);assert.equal(r.metadata.quantity_basis,'qty_available');assert.equal(r.rows[0].available_quantity,3)});

test('tracked inventory excludes consumables and services',async()=>{const f=fixture({metadata:{is_storable:{type:'boolean'}},product:{is_storable:true}});const r=await readStock(env,f.fetch);assert.equal(r.metadata.product_scope,'tracked_inventory');assert.ok(f.calls.filter(c=>c.model==='product.product'&&c.method==='search_read').every(c=>c.domain[0].some(d=>d[0]==='is_storable'&&d[2]===true)))});
test('an untracked product cannot enter tracked snapshot',async()=>{const f=fixture({metadata:{is_storable:{type:'boolean'}},product:{is_storable:false}});await assert.rejects(readStock(env,f.fetch),/invalid_stock_response/)});
