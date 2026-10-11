import test from 'node:test';
import assert from 'node:assert/strict';
import {assertUnchangedRows,calculateOdooOrder} from '../supabase/functions/odoo-commission-pipeline/core.mjs';
import {normalizeOdooPipeline} from '../validation-v12/assets/odoo-commission-model-d24.mjs';

const line=(overrides={})=>({id:10,order_id:[1,'TEST-1'],product_id:[100,'Produit synthétique'],
 product_uom_qty:4,price_unit:140,price_subtotal:560,discount:0,display_type:false,
 product_uom:[1,'g'],name:'Produit synthétique',write_date:'2026-10-11 08:00:00',...overrides});
const order=(overrides={})=>({id:1,name:'TEST-1',date_order:'2026-10-09 09:00:00',state:'sale',
 invoice_status:'to invoice',partner_id:[200,'Client synthétique'],user_id:[300,'Vendeur synthétique'],
 company_id:[400,'Global Trust Agriculture SA'],amount_untaxed:560,currency_id:[1,'EUR'],
 write_date:'2026-10-11 08:00:00',...overrides});
const options=(tier='A')=>({company:'GTA',products:new Map([[100,{id:100,default_code:'TEST',name:'Produit synthétique'}]]),
 catalog:new Map([['GTA|TEST',{tier,cost_eur:100,list_price_eur:140}]]),duplicates:new Set(),catalogAvailable:true});
const envelope=orders=>({version:'odoo_commission_pipeline_v1',read_at:'2026-10-11T08:00:00Z',
 closed_window_from:'2025-10-11',pending_scope:'all_pending_seller_orders',
 invoicing_semantics:'sale.order.invoice_status_not_payment_status',
 formula:'kino_browser_formula_provisional_without_spiff_units_unverified',
 scope:'owner_odoo_salesperson_read_only_states_and_invoice_status_rechecked',
 source_lines_rechecked:true,source_amounts_rechecked:true,orders});

test('server calculation rounds per line and preserves provisional barriers',()=>{
 const out=calculateOdooOrder(order(),[line()],options());
 assert.equal(out.forecast,13.93);
 assert.equal(out.lines[0].price_unit,140);
 assert.equal(out.lines[0].discount_pct,0);
 assert.deepEqual(out.issues,[]);
 assert.equal(out.uncertainties.payable,false);
 assert.equal(out.uncertainties.units_verified,false);
 assert.equal(out.uncertainties.historical_costs_verified,false);
 assert.equal(out.uncertainties.spiff_enabled,false);
 const normalized=normalizeOdooPipeline(envelope([out]));
 assert.equal(normalized.orders[0].forecast,13.93);
 assert.equal(normalized.sourceInputsRechecked,true);
});
test('category belongs to the catalogue product, not the company code',()=>{
 const out=calculateOdooOrder(order(),[line()],options('B'));
 const expected=100*(0.22254+0.25*(0.3-0.22254));
 assert.equal(out.forecast,Math.round(expected*100)/100);
 assert.equal(out.company,'GTA');
});
test('signed adjustment preserves amounts and suspends a whole order',()=>{
 const out=calculateOdooOrder(order({amount_untaxed:550}),[line(),line({id:11,
  product_uom_qty:-1,price_unit:10,price_subtotal:-10})],options());
 assert.equal(out.forecast,null);
 assert.equal(out.lines[1].subtotal_ht,-10);
 assert.ok(out.issues.includes('signed_adjustment'));
 assert.equal(normalizeOdooPipeline(envelope([out])).orders[0].forecast,null);
});
test('reject compensating negative price and excessive discount even when subtotal matches',()=>{
 const out=calculateOdooOrder(order({amount_untaxed:400}),[line({price_unit:-100,discount:200,
  price_subtotal:400})],options());
 assert.equal(out.forecast,null);
 assert.equal(out.unmatched_lines,1);
 assert.equal(out.lines[0].reason,'invalid_amount');
 assert.ok(out.issues.includes('invalid_line_inputs'));
 assert.ok(normalizeOdooPipeline(envelope([out])).orders[0].issues.includes('invalid_line_inputs'));
});
test('net price after discount is checked against the actual line subtotal',()=>{
 const valid=calculateOdooOrder(order({amount_untaxed:504}),[line({discount:10,price_subtotal:504})],options());
 assert.equal(valid.forecast,0.81);
 const bad=calculateOdooOrder(order(),[line({discount:10})],options());
 assert.equal(bad.forecast,null);
 assert.equal(bad.lines[0].reason,'line_price_mismatch');
});
test('nonfinite and coerced numeric inputs cannot yield a simulation',()=>{
 for(const changes of [{price_unit:'140'},{discount:null},{product_uom_qty:false},{price_subtotal:Infinity}]){
  const out=calculateOdooOrder(order(),[line(changes)],options());
  assert.equal(out.forecast,null);
  assert.equal(out.lines[0].commission_estimate,null);
 }
});
test('order source amount must reconcile and cannot be missing',()=>{
 for(const amount_untaxed of [600,null]){
  const out=calculateOdooOrder(order({amount_untaxed}),[line()],options());
  assert.equal(out.forecast,null);
  assert.ok(out.issues.includes(amount_untaxed===null?'incomplete_source_amount':'lines_total_mismatch'));
 }
});
test('missing or ambiguous catalogue cannot turn into an assumed zero commission',()=>{
 for(const changes of [{catalogAvailable:false},{duplicates:new Set(['GTA|TEST'])},{catalog:new Map()}]){
  const out=calculateOdooOrder(order(),[line()],{...options(),...changes});
  assert.equal(out.forecast,null);
  assert.equal(out.lines[0].commission_estimate,null);
  assert.equal(out.unmatched_lines,1);
 }
});
test('keyword exclusion remains a visible scope filter with uncertain business policy',()=>{
 const out=calculateOdooOrder(order(),[line({name:'Livraison synthétique'})],options());
 assert.equal(out.forecast,null);
 assert.equal(out.excluded_lines,1);
 assert.equal(out.lines[0].reason,'not_eligible');
 assert.equal(out.uncertainties.exclusions_contract_verified,false);
});
test('foreign source currency cannot use costs in EUR as a payable figure',()=>{
 const out=calculateOdooOrder(order({currency_id:[2,'CHF']}),[line()],options());
 assert.equal(out.currency,'CHF');
 assert.equal(out.forecast,null);
 assert.ok(out.issues.includes('not_eur'));
});
test('repeat read accepts reordered rows, but detects changed financial fields and identities',()=>{
 const fields=['id','product_uom_qty','price_unit','discount','price_subtotal','product_id','product_uom','order_id','write_date'];
 assert.doesNotThrow(()=>assertUnchangedRows([line(),line({id:11})],[line({id:11}),line()],fields));
 for(const change of [{product_uom_qty:5},{price_unit:139},{discount:1},{price_subtotal:559},
  {product_id:[101,'Other']},{product_uom:[2,'Unit']},{order_id:[2,'TEST-2']},{write_date:'2026-10-11 09:00:00'}]){
  assert.throws(()=>assertUnchangedRows([line()],[line(change)],fields),/odoo_source_changed/);
 }
 assert.throws(()=>assertUnchangedRows([line()],[line({id:11})],fields),/odoo_source_changed/);
 assert.throws(()=>assertUnchangedRows([line()],[],fields),/odoo_source_changed/);
 assert.throws(()=>assertUnchangedRows([line(),line()],[line(),line()],fields),/odoo_source_changed/);
});
test('repeat order read detects currency, total, customer, seller and state changes',()=>{
 const fields=['id','amount_untaxed','currency_id','partner_id','user_id','company_id','state','invoice_status','date_order'];
 for(const change of [{amount_untaxed:559},{currency_id:[2,'CHF']},{partner_id:[201,'Other']},
  {user_id:[301,'Other']},{company_id:[401,'Other']},{state:'cancel'},{invoice_status:'invoiced'},
  {date_order:'2026-10-08 09:00:00'}]){
  assert.throws(()=>assertUnchangedRows([order()],[order(change)],fields),/odoo_source_changed/);
 }
});
