import test from 'node:test';
import assert from 'node:assert/strict';
import {calculateOdooOrder} from '../supabase/functions/odoo-commission-pipeline/core.mjs';
import {normalizeOdooPipeline,pipelineReconciliationGroups,filterOdooPipeline} from '../validation-v12/assets/odoo-commission-model-d30.mjs';

// Synthetic product identities and prices only.
const envelope=orders=>({version:'odoo_commission_pipeline_v1',read_at:'2026-10-11T08:00:00Z',
 invoicing_semantics:'sale.order.invoice_status_not_payment_status',
 formula:'kino_browser_formula_provisional_without_spiff_units_unverified',
 scope:'owner_odoo_salesperson_read_only_states_and_invoice_status_rechecked',orders});
function fixture({company='TR',sku='',product='[TEST/TR/50] Produit test 50g',cost=25,id=1,state='sale'}={}){
 const catalog=new Map([['TR|TEST/TR/50',{product_name:'Produit catalogue test 50g',tier:'B',
  cost_eur:cost,list_price_eur:90}]]);
 const source={id,name:'TEST-'+id,date_order:'2026-10-09 12:00:00',state,
  invoice_status:'to invoice',partner_id:[1,'Client synthétique'],currency_id:[1,'EUR'],amount_untaxed:80};
 const line={id:id*10,product_id:[1,product],product_uom_qty:1,price_unit:80,
  price_subtotal:80,discount:0,display_type:false,name:'Description libre [OTHER]'};
 const options={company,products:new Map([[1,{name:product,default_code:sku}]]),
  catalog,duplicates:new Set(),catalogAvailable:true};
 return {source,line,options};
}
const calculate=f=>calculateOdooOrder(f.source,[f.line],f.options);
test('an exact bracketed candidate is evidenced but never promotes the missing Odoo SKU',()=>{
 const output=calculate(fixture());
 assert.equal(output.lines[0].sku,'');
 assert.equal(output.lines[0].reason,'missing_odoo_sku');
 assert.equal(output.lines[0].commission_estimate,null);
 assert.equal(output.forecast,null);
 assert.equal(output.matched_lines,0);assert.equal(output.unmatched_lines,1);
 assert.deepEqual(output.lines[0].catalog_evidence,{source:'product_label_prefix',company:'TR',
  sku:'TEST/TR/50',status:'found',catalog_name:'Produit catalogue test 50g',tier:'B',cost_eur:25,list_price_eur:90});
 const normalized=normalizeOdooPipeline(envelope([output]));
 assert.equal(normalized.orders[0].lines[0].sku,'');
 assert.equal(normalized.orders[0].forecast,null);
 assert.equal(normalized.orders[0].lines[0].catalogEvidence.costEur,25);
 assert.equal(filterOdooPipeline(normalized,{query:'catalogue test'}).length,1);
});
test('candidate matches are strictly scoped to the source company',()=>{
 const out=calculate(fixture({company:'GTA'}));
 assert.equal(out.lines[0].catalog_evidence.status,'not_found');
 assert.equal(out.lines[0].catalog_evidence.company,'GTA');
 assert.equal(out.lines[0].catalog_evidence.cost_eur,null);
});
test('duplicate or unavailable candidates reveal no arbitrary catalogue row',()=>{
 for(const changes of [{duplicates:new Set(['TR|TEST/TR/50'])},{catalogAvailable:false}]){
  const f=fixture();Object.assign(f.options,changes);
  const e=calculate(f).lines[0].catalog_evidence;
  assert.equal(e.status,changes.catalogAvailable===false?'unavailable':'ambiguous');
  assert.equal(e.catalog_name,null);assert.equal(e.cost_eur,null);
 }
});
test('free text, invoice notes and malformed brackets do not create candidates',()=>{
 for(const product of ['Produit TEST/TR/50','Produit [TEST/TR/50]','[TEST TR] Produit','[X] Produit']){
  assert.equal(calculate(fixture({product})).lines[0].catalog_evidence,null);
 }
 const f=fixture({product:'Produit test'});f.line.name='[TEST/TR/50] Invoice note';
 assert.equal(calculate(f).lines[0].catalog_evidence,null);
});
test('an official SKU takes precedence over a different bracketed label',()=>{
 const f=fixture({sku:'OTHER',product:'[TEST/TR/50] Produit test'});
 const out=calculate(f),e=out.lines[0].catalog_evidence;
 assert.equal(out.lines[0].reason,'missing_kino_match');
 assert.equal(e.source,'odoo_sku');assert.equal(e.sku,'OTHER');assert.equal(e.status,'not_found');
});
test('zero catalogue cost is preserved as evidence and cannot yield a zero commission',()=>{
 const out=calculate(fixture({sku:'TEST/TR/50',cost:0}));
 assert.equal(out.lines[0].reason,'missing_kino_cost');
 assert.equal(out.lines[0].catalog_evidence.cost_eur,0);
 const normalized=normalizeOdooPipeline(envelope([out]));
 assert.equal(normalized.orders[0].lines[0].catalogEvidence.costEur,0);
 assert.equal(normalized.orders[0].forecast,null);
});
test('client rejects promoted candidates, mismatched company/SKU, and forged evidence values',()=>{
 const output=calculate(fixture()),good=output.lines[0].catalog_evidence;
 for(const changes of [{company:'GTA'},{sku:'OTHER'},{source:'odoo_sku'},
  {cost_eur:'25'},{cost_eur:Infinity},{status:'not_found'},{source:'inferred'}]){
  const copy=structuredClone(output);copy.lines[0].catalog_evidence={...good,...changes};
  assert.throws(()=>normalizeOdooPipeline(envelope([copy])),/invalid_catalog_evidence/);
 }
 const estimated=calculate(fixture({sku:'TEST/TR/50'}));
 estimated.lines[0].catalog_evidence={...good,source:'odoo_sku'};
 assert.throws(()=>normalizeOdooPipeline(envelope([estimated])),/invalid_catalog_evidence/);
 const promoted=structuredClone(output);promoted.lines[0].sku='TEST/TR/50';
 assert.throws(()=>normalizeOdooPipeline(envelope([promoted])),/invalid_catalog_evidence/);
});
test('grouping retains source lines and separates companies and quote stages without changing totals',()=>{
 const outputs=[calculate(fixture()),calculate(fixture({id:2,state:'draft'})),
  calculate(fixture({id:3,company:'GTA'}))];
 const data=normalizeOdooPipeline(envelope(outputs));
 const before=JSON.stringify(data);
 const groups=pipelineReconciliationGroups(data.orders);
 assert.equal(groups.length,2);
 assert.equal(groups[0].amountHT,160);assert.equal(groups[0].currency,'EUR');
 assert.equal(groups[0].pendingLines,1);assert.equal(groups[0].confirmedLines,1);
 assert.deepEqual(groups[0].lines.map(l=>[l.reference,l.lineId]),[['TEST-1',10],['TEST-2',20]]);
 assert.equal(groups[1].company,'GTA');assert.equal(groups[1].catalogEvidence.status,'not_found');
 assert.equal(JSON.stringify(data),before);
});
test('mixed-currency diagnostics do not add unrelated HT amounts',()=>{
 const a=calculate(fixture()),f=fixture({id:2});f.source.currency_id=[2,'CHF'];
 const groups=pipelineReconciliationGroups(normalizeOdooPipeline(envelope([a,calculate(f)])).orders);
 assert.equal(groups.length,1);assert.equal(groups[0].currency,null);assert.equal(groups[0].amountHT,null);
});
test('old responses and eligible/excluded lines do not create misleading evidence',()=>{
 const old=calculate(fixture());delete old.lines[0].catalog_evidence;
 assert.equal(normalizeOdooPipeline(envelope([old])).orders[0].lines[0].catalogEvidence,null);
 for(const changes of [{sku:'TEST/TR/50'},{product:'[TEST/TR/50] Shipping'}]){
  const out=calculate(fixture(changes));
  assert.equal(out.lines[0].catalog_evidence,null);
  assert.equal(pipelineReconciliationGroups(normalizeOdooPipeline(envelope([out])).orders).length,0);
 }
});
