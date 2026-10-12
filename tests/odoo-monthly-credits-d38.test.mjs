import test from 'node:test';
import assert from 'node:assert/strict';
import {readMonthlyCredits,parseCreditMonth,explicitInvoiceReference} from '../supabase/functions/odoo-monthly-credits/core.mjs';
import {normalizeMonthlyCredits} from '../validation-v12/assets/monthly-credit-model-d38.mjs';
const rel=(id,name)=>[id,name],clone=x=>JSON.parse(JSON.stringify(x)),period=parseCreditMonth('https://source.invalid/?month=2026-10');
function setup(){
 const f={companies:[{id:10,name:'Trim Rocket s.r.o.'}],
  documents:[{id:1,name:'TEST-CREDIT',move_type:'out_refund',state:'posted',invoice_date:'2026-10-05',invoice_user_id:rel(7,'Test seller'),
   company_id:rel(10,'Trim Rocket s.r.o.'),partner_id:rel(20,'Test client'),currency_id:rel(1,'EUR'),amount_untaxed:60,amount_total:72,
   reversed_entry_id:rel(2,'TEST-INV'),invoice_line_ids:[101],write_date:'2026-10-11 12:00:00'}],
  originals:[{id:2,name:'TEST-INV',move_type:'out_invoice',state:'posted',invoice_date:'2026-09-10',invoice_user_id:rel(7,'Test seller'),
   company_id:rel(10,'Trim Rocket s.r.o.'),partner_id:rel(20,'Test client'),currency_id:rel(1,'EUR'),amount_untaxed:300,amount_total:360,
   reversed_entry_id:false,invoice_line_ids:[102],write_date:'2026-09-11 12:00:00'}],
  lines:[{id:101,move_id:rel(1,'TEST-CREDIT'),product_id:rel(30,'Test product'),name:'Test product',quantity:20,
   price_unit:3,discount:0,price_subtotal:60,display_type:'product',sale_line_ids:[201],product_uom_id:rel(40,'g'),write_date:'2026-10-11 12:00:00'}],
  originalLines:[{id:102,move_id:rel(2,'TEST-INV'),product_id:rel(30,'Test product'),name:'Test product',quantity:100,
   price_unit:3,discount:0,price_subtotal:300,display_type:'product',sale_line_ids:[201],product_uom_id:rel(40,'g'),write_date:'2026-09-11 12:00:00'}],
  saleLines:[{id:201,order_id:rel(301,'TEST-ORDER'),product_id:rel(30,'Test product'),name:'Test product',product_uom_qty:100,
   price_unit:3,discount:0,price_subtotal:300,display_type:false,product_uom_id:rel(40,'g'),write_date:'2026-09-11 12:00:00'}],
  orders:[{id:301,name:'TEST-ORDER',state:'sale',date_order:'2026-09-10 12:00:00',user_id:rel(7,'Test seller'),
   company_id:rel(10,'Trim Rocket s.r.o.'),partner_id:rel(20,'Test client'),partner_invoice_id:rel(20,'Test client'),currency_id:rel(1,'EUR'),write_date:'2026-09-11 12:00:00'}],
  products:[{id:30,name:'Test product',default_code:'TEST/SKU'}]};
 const calls=[],counter=new Map();let change=null;
 const read=async(model,domain,fields,limit)=>{
  assert.ok(limit<=401);calls.push({model,domain,fields,limit});const nth=(counter.get(model)||0)+1;counter.set(model,nth);
  let rows=model==='res.company'?f.companies:model==='account.move'?(domain.some(x=>x[0]==='invoice_date')?f.documents:f.originals):
   model==='account.move.line'?(domain.some(x=>x[0]==='id'&&x[2].includes(101))?f.lines:f.originalLines):
   model==='sale.order.line'?f.saleLines:model==='sale.order'?f.orders:model==='product.product'?f.products:null;
  assert.ok(rows,'unexpected model');rows=clone(rows);
  if(model==='sale.order.line')assert.ok(domain.some(x=>x[0]==='order_id.user_id'&&x[2]===7));
  if(model==='sale.order')assert.ok(domain.some(x=>x[0]==='user_id'&&x[2]===7));
  if(model==='account.move')assert.ok(domain.some(x=>x[0]==='invoice_user_id'&&x[2]===7));
  return change?change(model,nth,rows,domain):rows;
 };
 const catalog=new Map([['TR|TEST/SKU',{product_name:'Test product',tier:'A',cost_eur:1,list_price_eur:3}]]);
 const run=()=>readMonthlyCredits(period,{uid:7,read,catalog,catalogAvailable:true,duplicates:new Set(),
  catalogSnapshotAt:'2026-10-11T12:00:00Z',invoiceUnitField:'product_uom_id',saleUnitField:'product_uom_id',now:()=>new Date('2026-10-11T13:00:00Z')});
 return {f,calls,run,catalog,change:fn=>{change=fn}};
}
test('monthly query accepts only one complete month and rejects extra or duplicated selectors',()=>{
 assert.deepEqual(period,{month:'2026-10',from:'2026-10-01',to:'2026-10-31'});
 assert.equal(parseCreditMonth('https://s.invalid/?month=2024-02').to,'2024-02-29');
 for(const q of ['month=2026-13','month=2026-10&month=2026-09','month=2026-10&seller=8','month=2026-10&company=ANY'])
  assert.throws(()=>parseCreditMonth('https://s.invalid/?'+q),/invalid_month/);
});
test('a direct sale-line link estimates the prorata commission on an older confirmed order, without adding the credit HT',async()=>{
 const s=setup(),r=await s.run(),l=r.documents[0].lines[0];
 assert.equal(r.source_rechecked,true);assert.equal(r.month,'2026-10');assert.equal(r.automatic_deduction,false);
 assert.equal(l.original.date,'2026-09-10');assert.equal(l.link_kind,'direct_sale_line');
 assert.equal(l.original_calculation.commission,52.5);assert.equal(l.deduction_estimate_cents,1050);
 assert.equal(r.documents[0].amount_ht,60);assert.equal(r.estimated_lines,1);assert.equal(l.reason,null);
 assert.ok(s.calls.filter(c=>c.model==='account.move'&&c.domain.some(x=>x[0]==='invoice_date')).length===2);
});
test('an unambiguous exact invoice reversal can recover a missing direct line link',async()=>{
 const s=setup();s.f.lines[0].sale_line_ids=[];const l=(await s.run()).documents[0].lines[0];
 assert.equal(l.link_kind,'unique_reversed_invoice_line');assert.equal(l.original_invoice_line_id,102);assert.equal(l.deduction_estimate_cents,1050);
});
test('an explicitly labelled invoice note resolves by exact invoice name and retains its weaker provenance',async()=>{
 const s=setup();s.f.documents[0].reversed_entry_id=false;s.f.lines[0].sale_line_ids=[];
 s.f.documents[0].invoice_line_ids.push(103);s.f.lines.push({id:103,move_id:rel(1,'TEST-CREDIT'),product_id:false,name:'Ref. invoice TEST-INV',
  quantity:0,price_unit:0,discount:0,price_subtotal:0,display_type:'line_note',sale_line_ids:[],product_uom_id:false,write_date:'2026-10-11 12:00:00'});
 const r=await s.run(),l=r.documents[0].lines[0];
 assert.equal(r.documents[0].original_invoice.link_kind,'explicit_invoice_note_reference');assert.equal(r.documents[0].original_invoice.id,2);
 assert.equal(l.link_kind,'explicit_invoice_note_unique_line');assert.equal(l.deduction_estimate_cents,1050);
 assert.ok(s.calls.some(c=>c.model==='account.move'&&c.domain.some(x=>Array.isArray(x)&&x[0]==='name'&&x[2][0]==='TEST-INV')));
 assert.equal(explicitInvoiceReference('Ref. invoice FATT/2026/00001'),'FATT/2026/00001');
 for(const x of ['FATT/2026/00001','Client TEST-INV','Ref. invoice TEST-INV and TEST-OTHER','Ref. invoice https://other.invalid'])assert.equal(explicitInvoiceReference(x),null);
});
test('a note contradicting the native reversal does not silently select another invoice',async()=>{
 const s=setup();s.f.documents[0].ref='Ref. invoice OTHER';
 const l=(await s.run()).documents[0].lines[0];assert.equal(l.reason,'conflicting_original_invoice_reference');assert.equal(l.original,null);assert.equal(l.deduction_estimate_cents,null);
});
test('a single original product line remains inspectable when a partial price credit prevents its commission calculation',async()=>{
 const s=setup();s.f.lines[0].sale_line_ids=[];s.f.lines[0].price_unit=2;s.f.lines[0].price_subtotal=40;s.f.documents[0].amount_untaxed=40;
 const d=(await s.run()).documents[0],l=d.lines[0];assert.equal(l.reason,'refund_price_mismatch');assert.equal(l.original.order_id,301);
 assert.equal(l.deduction_estimate_cents,null);assert.equal(d.original_invoice.lines[0].subtotal_ht,300);assert.equal(d.original_invoice.lines[0].sale_link_count,1);
});
test('multiple sale links, missing links and ambiguous original invoice products never receive a deduction estimate',async()=>{
 for(const mode of ['multiple','missing','ambiguous']){
  const s=setup();s.f.lines[0].sale_line_ids=mode==='multiple'?[201,202]:[];
  if(mode==='missing'){s.f.documents[0].reversed_entry_id=false;s.f.originals=[];s.f.originalLines=[]}
  if(mode==='ambiguous'){s.f.originals[0].invoice_line_ids.push(103);s.f.originalLines.push({...s.f.originalLines[0],id:103})}
  const l=(await s.run()).documents[0].lines[0];assert.equal(l.deduction_estimate_cents,null);assert.equal(l.original,null);assert.ok(l.reason);
 }
});
test('drafts, changed price, invalid or excessive quantities, mismatched units and missing cost remain source diagnostics',async()=>{
 const scenarios=[
  ['credit_not_posted',s=>s.f.documents[0].state='draft'],
  ['refund_price_mismatch',s=>{s.f.lines[0].price_unit=2;s.f.lines[0].price_subtotal=40;s.f.documents[0].amount_untaxed=40}],
  ['return_quantity_exceeds_sale',s=>{s.f.lines[0].quantity=101;s.f.lines[0].price_subtotal=303;s.f.documents[0].amount_untaxed=303}],
  ['unit_identity_unverified',s=>s.f.lines[0].product_uom_id=rel(99,'pack')],
  ['invalid_kino_cost_or_tier',s=>s.catalog.get('TR|TEST/SKU').cost_eur=0],
  ['credit_line_total_mismatch',s=>s.f.documents[0].amount_untaxed=100],
  ['not_eligible',s=>s.f.products[0].name='Shipping'],
 ];
 for(const [reason,fn] of scenarios){const s=setup();fn(s);const l=(await s.run()).documents[0].lines[0];assert.equal(l.reason,reason);assert.equal(l.deduction_estimate_cents,null)}
});
test('a missing official SKU may use one compatible catalogue name and retains explicit provenance',async()=>{
 const s=setup();s.f.products[0].default_code=false;
 const result=await s.run(),line=result.documents[0].lines[0];
 assert.equal(line.sku,'');assert.equal(line.reason,null);assert.equal(line.listing_match.method,'normalized_name');
 assert.equal(line.deduction_estimate_cents,1050);
 normalizeMonthlyCredits({ok:true,data:result},period.month);
});
test('a unique original invoice product may tolerate a duplicated listing while preserving invoice identity and price controls',async()=>{
 const s=setup();s.f.lines[0].sale_line_ids=[];s.f.lines[0].product_id=rel(31,'Test product');
 s.f.products.push({id:31,name:'TEST  product',default_code:''});
 const result=await s.run(),line=result.documents[0].lines[0];
 assert.equal(line.reason,null);assert.equal(line.product_id,31);assert.equal(line.original.product_id,30);
 assert.equal(line.listing_identity.method,'normalized_name');assert.equal(line.deduction_estimate_cents,1050);
 normalizeMonthlyCredits({ok:true,data:result},period.month);
 const tampered=clone(result);tampered.documents[0].lines[0].listing_identity.source_product_id=32;
 assert.throws(()=>normalizeMonthlyCredits({ok:true,data:tampered},period.month),/invalid_credit_evidence/);
 s.f.products[1].name='Test product +';
 assert.equal((await s.run()).documents[0].lines[0].deduction_estimate_cents,null);
});
test('duplicate named original invoice lines never choose an arbitrary sales line',async()=>{
 const s=setup();s.f.lines[0].sale_line_ids=[];s.f.lines[0].product_id=rel(31,'Test product');
 s.f.products.push({id:31,name:'Test product',default_code:''});
 s.f.originalLines.push({...s.f.originalLines[0],id:103});s.f.originals[0].invoice_line_ids.push(103);
 assert.equal((await s.run()).documents[0].lines[0].reason,'ambiguous_original_invoice_lines');
});
test('several returns in the same month cannot exceed the original sold quantity',async()=>{
 const s=setup();s.f.lines[0].quantity=60;s.f.lines[0].price_subtotal=180;s.f.lines.push({...s.f.lines[0],id:103});
 s.f.documents[0].invoice_line_ids.push(103);s.f.documents[0].amount_untaxed=360;
 const r=await s.run();assert.equal(r.estimated_lines,0);assert.ok(r.documents[0].lines.every(l=>l.reason==='return_quantity_exceeds_sale'));
});
test('a seller mismatch or concurrent source edit invalidates the response without a partial snapshot',async()=>{
 const s=setup();s.f.documents[0].invoice_user_id=rel(8,'Other seller');await assert.rejects(s.run(),/credit_scope_mismatch/);
 const changed=setup();changed.change((model,nth,rows)=>{
  if(model==='sale.order.line'&&nth===2)rows[0].price_unit=4;return rows;
 });await assert.rejects(changed.run(),/odoo_source_changed/);
 const product=setup();product.change((model,nth,rows)=>{if(model==='product.product'&&nth===2)rows[0].default_code='OTHER';return rows;});
 await assert.rejects(product.run(),/odoo_source_changed/);
});
test('monthly additions, oversized scopes and removed owned lines are handled without exposing a foreign sale',async()=>{
 const changed=setup();let creditReads=0;changed.change((model,nth,rows,domain)=>{
  if(model==='account.move'&&domain.some(x=>x[0]==='invoice_date')&&++creditReads===2)rows.push({...rows[0],id:99});return rows;
 });await assert.rejects(changed.run(),/odoo_source_changed/);
 const large=setup();large.f.documents=Array.from({length:41},(_,i)=>({...large.f.documents[0],id:i+1}));await assert.rejects(large.run(),/credit_scope_limit/);
 const missing=setup();missing.f.saleLines=[];missing.f.orders=[];const l=(await missing.run()).documents[0].lines[0];
 assert.equal(l.original,null);assert.equal(l.reason,'original_sale_not_accessible');assert.equal(l.deduction_estimate_cents,null);
});
