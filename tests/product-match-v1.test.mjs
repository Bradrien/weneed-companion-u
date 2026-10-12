import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {compareProductNames,resolveCatalogProduct,validateListingMatch,compatibleListingSku} from '../validation-v12/assets/product-match-v1.mjs';
import {calculateOdooOrder} from '../supabase/functions/odoo-commission-pipeline/core.mjs';
import {normalizeOdooPipeline} from '../validation-v12/assets/odoo-commission-model-d30.mjs';
const row={sku:'PEB/G/TR/250',product_name:'Peanut Butter 250-TR',tier:'B',cost_eur:190,list_price_eur:450};
const catalog=new Map([['TR|'+row.sku,row]]);
const resolve=(name,sku='',changes={})=>resolveCatalogProduct({company:'TR',sku,product:name,catalog,duplicates:new Set(),...changes});
test('browser and service use identical tolerance rules',async()=>{
 assert.equal(await readFile(new URL('../validation-v12/assets/product-match-v1.mjs',import.meta.url),'utf8'),
  await readFile(new URL('../supabase/functions/odoo-commission-pipeline/product-match.mjs',import.meta.url),'utf8'));
});
test('unique names accept case accents spacing punctuation and first-line provenance',()=>{
 for(const name of ['Peanut Butter 250-TR','PÉANUT   BUTTER 250 g / TR','[PEB/G/TR/250] Peanut Butter 250-TR\nBatch: 1234']){
  const out=resolve(name);assert.equal(out.row,row);assert.ok(validateListingMatch(out.match,{company:'TR',sku:'',product:name}));
 }
 assert.equal(resolve('[PEB/G/TR/250] Peanut Butter 250-TR').match.method,'label_sku');
});
test('one letter may differ in one long name word, never two words or a numeric token',()=>{
 assert.equal(resolve('Peanutt Butter 250-TR').match.method,'minor_name_typo');
 for(const name of ['Peanutt Butterr 250-TR','Peanut Butter 25-TR','Peanut Butter + 250-TR','Peanut Butter 250-GTA','Peanut Batter 250-TR plus'])assert.equal(resolve(name).row,null);
});
test('SKU structure protects sizes categories plus markers and short cultivar codes',()=>{
 assert.ok(compatibleListingSku('PEBB/G/TR/250',row.sku));
 for(const sku of ['PEB/G/TR/50','PEB/+/G/TR/250','PEB/H/TR/250','PEB/G/GTA/250','ABC/G/TR/250'])assert.ok(!compatibleListingSku(sku,row.sku));
 assert.equal(resolve('Peanut Butter 250-TR','PEBB/G/TR/250').match.method,'minor_sku_typo');
 assert.equal(resolve('Peanutt Butter 250-TR','PEBB/G/TR/250').row,null);
 assert.equal(resolve('Peanut Butter 250-TR','OTHER/G/TR/250').row,null);
});
test('ambiguous names and duplicate catalogue rows cannot pick an arbitrary cost',()=>{
 const ambiguous=new Map([...catalog,['TR|OTHER/TR/250',{...row,sku:'OTHER/TR/250'}]]);
 assert.equal(resolve('Peanut Butter 250-TR','',{catalog:ambiguous}).reason,'ambiguous_sku');
 assert.equal(resolve('Peanut Butter 250-TR','',{duplicates:new Set(['TR|'+row.sku])}).row,null);
 assert.equal(resolve('Peanut Butter 250-TR','',{company:'GTA'}).row,null);
 assert.equal(resolve('Peanut Butter 250-TR','',{catalogAvailable:false}).row,null);
});
test('source SKU wins; labels and empty or malformed names do not override a conflicting code',()=>{
 assert.equal(resolve('A listing typo',row.sku).row,row);
 for(const name of ['', '[OTHER/G/TR/250] Peanut Butter 250-TR','Peanut', 'Peanut Butter 250-TR +'])assert.equal(resolve(name).row,null);
 assert.ok(!validateListingMatch({...resolve('Peanut Butter 250-TR').match,unique:false},{company:'TR',sku:'',product:row.product_name}));
});
test('a listing match estimates a source line while keeping its original empty SKU and replayable arithmetic',()=>{
 const order=calculateOdooOrder({id:1,name:'TEST',date_order:'2026-10-10 12:00:00',state:'sale',invoice_status:'to invoice',
  partner_id:[1,'Synthetic'],currency_id:[1,'EUR'],amount_untaxed:550},[{id:10,product_id:[1,row.product_name],name:row.product_name,
  product_uom_qty:1,price_unit:550,discount:0,price_subtotal:550,display_type:false}],{company:'TR',
   products:new Map([[1,{name:'[PEB/G/TR/250] Peanut Butter 250-TR\nBatch: X',default_code:''}]]),catalog,duplicates:new Set(),catalogAvailable:true});
 assert.equal(order.lines[0].sku,'');assert.ok(order.lines[0].commission_estimate>0);assert.equal(order.lines[0].listing_match.catalog_sku,row.sku);
 const envelope={version:'odoo_commission_pipeline_v1',read_at:new Date().toISOString(),scope:'owner_odoo_salesperson_read_only_states_and_invoice_status_rechecked',
  invoicing_semantics:'sale.order.invoice_status_not_payment_status',formula:'kino_browser_formula_provisional_without_spiff_units_unverified',
  calculation_version:'kino_browser_arithmetic_v1_cent_per_line',catalog_available:true,catalog_products_total:1,orders:[order]};
 const normalized=normalizeOdooPipeline(envelope);assert.equal(normalized.orders[0].lines[0].listingMatch.method,'label_sku');
 const bad=structuredClone(envelope);bad.orders[0].lines[0].listing_match.catalog_name='Peanut Butter + 250-TR';
 assert.throws(()=>normalizeOdooPipeline(bad),/invalid_catalog_evidence/);
});
