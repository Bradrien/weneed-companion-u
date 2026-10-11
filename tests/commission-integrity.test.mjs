import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeOdooPipeline,odooPipelineTotals} from '../validation-v12/assets/odoo-commission-model-d24.mjs';
import {simulateOdooReport} from '../validation-v12/assets/commission-scenario-d24.mjs';
import {simulateKinoLine,kinoCommissionRate} from '../validation-v12/assets/kino-simulator-d24.mjs';
import {sourceAmountIssues} from '../validation-v12/assets/commission-integrity-d24.mjs';

// Synthetic monetary values only: no customer data, real SKU or credentials.
const line=(overrides={})=>({line_id:10,sku:'TEST',product:'Produit synthétique',quantity:1000,
 unit:'g',subtotal_ht:1000,commission_estimate:75,reason:'estimated_units_unverified',...overrides});
const order=(overrides={})=>({id:1,reference:'TEST-1',client:'Client synthétique',company:'GTA',
 date:'2026-10-09 09:00:00',state:'sale',invoice_status:'to invoice',stage:'confirme',
 currency:'EUR',amount_ht:1000,forecast:75,matched_lines:1,unmatched_lines:0,lines:[line()],...overrides});
const pipeline=(orders=[order()])=>({version:'odoo_commission_pipeline_v1',
 read_at:'2026-10-11T08:00:00Z',closed_window_from:'2025-10-11',
 pending_scope:'all_pending_seller_orders',invoicing_semantics:'sale.order.invoice_status_not_payment_status',
 formula:'kino_browser_formula_provisional_without_spiff_units_unverified',
 scope:'owner_odoo_salesperson_read_only_states_and_invoice_status_rechecked',orders});
const scenario=()=>({verified_commissions_eur:null,commissions_are_calculated:false,persisted:false,
 source_order_status_rechecked:true,source_order_status_checked_at:'2026-10-11T08:00:00Z',
 catalog_matching:{matched:1},orders:[{id:1,reference:'TEST-1',company:'GTA',client:'Client synthétique',
 currency:'EUR',state:'sale',amount_ht:560,commission_eur:null,issues:[],
 lines:[{id:10,sku:'TEST',product_name:'Produit synthétique',kind:'candidate',quantity:4,
 unit_price:140,discount_pct:0,line_ht:560,commission_eur:null,
 catalog_match:{status:'matched',tier:'A',cost_eur:100,list_price_eur:140}}]}]});

test('valid source keeps provisional estimate and unverified business barriers',()=>{
 const data=normalizeOdooPipeline(pipeline());
 assert.equal(data.orders[0].forecast,75);
 assert.deepEqual(data.orders[0].issues,[]);
 assert.equal(data.rules.payable,false);
 assert.equal(data.rules.unitsVerified,false);
 assert.equal(data.rules.historicalCostsVerified,false);
 assert.equal(data.rules.spiffEnabled,false);
 assert.equal(data.rules.creditNotesVerified,false);
 assert.equal(data.rules.paymentVerified,false);
});
test('negative Odoo quantities and amounts remain facts and suspend estimate',()=>{
 const adjustment=line({line_id:11,quantity:-200,subtotal_ht:-200,commission_estimate:null,reason:'not_eligible'});
 const x=normalizeOdooPipeline(pipeline([order({amount_ht:800,lines:[line(),adjustment]})])).orders[0];
 assert.equal(x.lines[1].quantity,-200);
 assert.equal(x.lines[1].subtotalHT,-200);
 assert.equal(x.amountHT,800);
 assert.equal(x.forecast,null);
 assert.ok(x.issues.includes('signed_adjustment'));
});
test('negative order total is preserved in source revenue',()=>{
 const x=normalizeOdooPipeline(pipeline([order({amount_ht:-25,forecast:null,matched_lines:0,
  lines:[line({subtotal_ht:-25,quantity:-1,commission_estimate:null,reason:'not_eligible'})]})]));
 assert.equal(x.orders[0].amountHT,-25);
 assert.equal(odooPipelineTotals(x.orders).amountHT,-25);
});
test('HT mismatch suspends estimation without losing the source order',()=>{
 const x=normalizeOdooPipeline(pipeline([order({amount_ht:999})])).orders[0];
 assert.equal(x.amountHT,999);
 assert.equal(x.forecast,null);
 assert.deepEqual(x.issues,['lines_total_mismatch']);
});
test('declared forecast must reconcile to the sum of rounded line estimates',()=>{
 const x=normalizeOdooPipeline(pipeline([order({forecast:75.01})])).orders[0];
 assert.equal(x.forecast,null);
 assert.deepEqual(x.issues,['forecast_total_mismatch']);
});
test('missing source amount is not converted to zero',()=>{
 const x=normalizeOdooPipeline(pipeline([order({amount_ht:null})])).orders[0];
 assert.equal(x.amountHT,null);
 assert.equal(x.forecast,null);
 assert.ok(x.issues.includes('incomplete_source_amount'));
});
test('paid excluded line makes a scenario partial even without an unmatched SKU',()=>{
 const excluded=line({line_id:11,subtotal_ht:10,commission_estimate:null,reason:'not_eligible'});
 const data=normalizeOdooPipeline(pipeline([order({amount_ht:1010,lines:[line(),excluded]})]));
 assert.equal(data.orders[0].unmatchedLines,0);
 assert.equal(data.orders[0].excludedMonetaryLines,1);
 assert.equal(data.orders[0].partial,true);
 assert.equal(odooPipelineTotals(data.orders).forecastPartial,1);
});
test('display line with zero amount is counted without marking paid coverage missing',()=>{
 const excluded=line({line_id:11,quantity:0,subtotal_ht:0,commission_estimate:null,reason:'not_eligible'});
 const x=normalizeOdooPipeline(pipeline([order({lines:[line(),excluded]})])).orders[0];
 assert.equal(x.excludedLines,1);
 assert.equal(x.partial,false);
});
test('unmatched coverage is checked against actual line reasons',()=>{
 assert.throws(()=>normalizeOdooPipeline(pipeline([order({unmatched_lines:1})])),/invalid_line_coverage/);
 assert.throws(()=>normalizeOdooPipeline(pipeline([order({matched_lines:0})])),/invalid_line_coverage/);
});
test('duplicate line identities across orders are rejected',()=>{
 assert.throws(()=>normalizeOdooPipeline(pipeline([order(),order({id:2})])),/invalid_odoo_line/);
});
test('negative or nonfinite estimates are rejected rather than silently discarded',()=>{
 for(const value of [-1,Infinity,NaN]){
  assert.throws(()=>normalizeOdooPipeline(pipeline([order({lines:[line({commission_estimate:value})]})])),/invalid_odoo_line/);
 }
});
test('mixed source currencies are retained without adding them into a EUR total',()=>{
 const data=normalizeOdooPipeline(pipeline([order(),order({id:2,currency:'CHF',forecast:null,
  lines:[line({line_id:20})]})]));
 assert.equal(data.orders[1].currency,'CHF');
 assert.equal(data.orders[1].forecast,null);
 assert.ok(data.orders[1].issues.includes('not_eur'));
 const total=odooPipelineTotals(data.orders);
 assert.equal(total.amountHT,null);
 assert.equal(total.mixedCurrencies,true);
 assert.equal(total.forecast,75);
});
test('invoiced stage remains distinct from payment proof',()=>{
 const x=normalizeOdooPipeline(pipeline([order({invoice_status:'invoiced',stage:'facture'})]));
 assert.equal(x.orders[0].stage,'facture');
 assert.equal(x.rules.paymentVerified,false);
 assert.throws(()=>normalizeOdooPipeline(pipeline([order({stage:'facture'})])),/odoo_stage_mismatch/);
});
test('source totals allow the gateway rounding tolerance, not material discrepancies',()=>{
 assert.deepEqual(sourceAmountIssues(10.04,[{quantity:1,subtotalHT:10}]),[]);
 assert.deepEqual(sourceAmountIssues(10.05,[{quantity:1,subtotalHT:10}]),['lines_total_mismatch']);
});
test('monthly scenario verifies its own source totals and remains nonpayable',()=>{
 const r=simulateOdooReport(scenario());
 assert.equal(r.simulatedLines,1);
 assert.ok(Math.abs(r.total-13.926)<1e-8);
 assert.equal(r.payable,false);
 assert.equal(r.spiff,false);
 const input=scenario();input.orders[0].amount_ht=600;
 const invalid=simulateOdooReport(input);
 assert.equal(invalid.simulatedLines,0);
 assert.equal(invalid.reasons.invalid_order_totals,1);
});
test('monthly scenario blocks an entire order containing a negative adjustment',()=>{
 const input=scenario();input.orders[0].amount_ht=550;
 input.orders[0].lines.push({id:11,quantity:-1,line_ht:-10,kind:'anomaly',commission_eur:null});
 const r=simulateOdooReport(input);
 assert.equal(r.simulatedLines,0);
 assert.equal(r.reasons.signed_adjustment,2);
});
test('monthly scenario rejects duplicated source identity',()=>{
 const input=scenario();input.orders.push({...input.orders[0]});
 assert.throws(()=>simulateOdooReport(input),/invalid_simulation_order/);
 const input2=scenario();input2.orders[0].lines.push({...input2.orders[0].lines[0]});
 assert.throws(()=>simulateOdooReport(input2),/invalid_simulation_line/);
});
test('confirmed base rates and overhead at tier boundaries use synthetic inputs',()=>{
 assert.equal(kinoCommissionRate('A',0.15),0.2321);
 assert.equal(kinoCommissionRate('A',0.8),0.3);
 assert.equal(kinoCommissionRate('B',0),0.22254);
 assert.equal(kinoCommissionRate('B',1),0.3);
 const a=simulateKinoLine({tier:'A',cost:100},{price:140,quantity:4,spiff:false});
 const b=simulateKinoLine({tier:'B',cost:100},{price:125,quantity:2,spiff:false});
 assert.equal(a.correctedCost,125);
 assert.ok(Math.abs(b.correctedCost-115)<1e-8);
 assert.ok(Math.abs(b.rate-(0.22254+0.1*(0.3-0.22254)))<1e-8);
 assert.equal(a.spiffAmount,0);
});
test('zero or negative corrected margin earns zero in this provisional base scenario',()=>{
 for(const price of [0,100,125]){
  const x=simulateKinoLine({tier:'A',cost:100},{price,quantity:2,spiff:false});
  assert.equal(x.commission,0);
 }
 assert.throws(()=>simulateKinoLine({tier:'A',cost:100},{price:-1,quantity:2}),/invalid numeric input/);
});
