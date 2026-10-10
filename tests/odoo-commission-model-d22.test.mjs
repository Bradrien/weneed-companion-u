import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeOdooPipeline,filterOdooPipeline,odooPipelineTotals} from '../validation-v12/assets/odoo-commission-model-d22.mjs';
const o=(id,state,inv)=>({id,reference:'SO'+id,client:'Test Shop',company:'GTA',
 date:'2026-10-10 12:00:00',state,invoice_status:inv,
 stage:state==='draft'||state==='sent'?'en_cours':inv==='invoiced'?'facture':'confirme',
 currency:'EUR',amount_ht:1000,forecast:90,matched_lines:1,unmatched_lines:0,
 lines:[{line_id:id*10,product:'A',sku:'A/G',quantity:100,unit:'g',
 subtotal_ht:1000,commission_estimate:90,reason:'estimated_units_unverified'}]});
const input={version:'odoo_commission_pipeline_v1',
 scope:'owner_odoo_salesperson_read_only_states_and_invoice_status_rechecked',
 invoicing_semantics:'sale.order.invoice_status_not_payment_status',
 formula:'kino_browser_formula_provisional_without_spiff_units_unverified',
 read_at:'2026-10-11T10:00:00Z',closed_window_from:'2025-10-11',
 pending_scope:'all_pending_seller_orders',orders:[o(1,'draft','no'),o(2,'sent','no'),
 o(3,'sale','to invoice'),o(4,'done','invoiced')]};
test('a draft and sent quotation are always pending, invoiced requires Odoo invoice status',()=>{
 const data=normalizeOdooPipeline(input);
 assert.equal(filterOdooPipeline(data,{stage:'en_cours'}).length,2);
 assert.equal(filterOdooPipeline(data,{stage:'confirme'}).length,1);
 assert.equal(filterOdooPipeline(data,{stage:'facture'}).length,1);
 assert.equal(odooPipelineTotals(data.orders).en_cours,2);
});
test('malicious or mismatched invoice state cannot be confused with invoicing',()=>{
 assert.throws(()=>normalizeOdooPipeline({...input,orders:[{...o(4,'sale','to invoice'),stage:'facture'}]}));
});
test('status and company filters do not alter commission figures',()=>{
 const data=normalizeOdooPipeline(input);
 assert.equal(filterOdooPipeline(data,{stage:'en_cours'}).reduce((v,x)=>v+x.forecast,0),180);
 assert.equal(filterOdooPipeline(data,{company:'TR'}).length,0);
});
test('missing Kino estimate is unknown not a zero payable commission',()=>{
 const a=o(1,'draft','no');a.forecast=null;a.matched_lines=0;
 a.unmatched_lines=1;a.lines[0].commission_estimate=null;
 const data=normalizeOdooPipeline({...input,orders:[a]});
 assert.equal(odooPipelineTotals(data.orders).forecastCount,0);
});
