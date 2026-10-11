import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeMonthlyCredits,filterMonthlyCredits,proposedBalanceWithCredits} from '../validation-v12/assets/monthly-credit-model-d38.mjs';
import {creditFixture} from './fixtures/monthly-credit-d38.mjs';
const clone=x=>JSON.parse(JSON.stringify(x));

test('browser replays the original commission and returned-quantity prorata in integer cents',()=>{
 const data=normalizeMonthlyCredits(creditFixture(),'2026-10');assert.equal(data.estimatedLines,1);
 assert.equal(data.documents[0].lines[0].deduction_estimate_cents,1050);assert.equal(data.documents[0].lines[0].original_calculation.commission,52.5);
 assert.equal(filterMonthlyCredits(data,{company:'GTA'}).length,0);assert.equal(filterMonthlyCredits(data,{query:'test-older'}).length,1);
 assert.equal(filterMonthlyCredits(data,{query:'test/sku'}).length,1);
});
test('an invoice amount, changed original cost, changed quantities or unit mismatch cannot replace the deduction',()=>{
 for(const modify of [l=>l.deduction_estimate_cents=6000,l=>l.effective_unit_cost_eur=1.1,l=>l.quantity=30,l=>l.original.quantity=10,
  l=>l.unit_id=99,l=>l.subtotal_ht=50,l=>l.original_calculation.commission=99,l=>l.original.discount_pct=10]){
  const b=creditFixture();modify(b.data.documents[0].lines[0]);assert.throws(()=>normalizeMonthlyCredits(b,'2026-10'),/invalid_credit_calculation/);
 }
});
test('an unavailable source remains a diagnostic with no manufactured zero commission',()=>{
 const b=creditFixture(),l=b.data.documents[0].lines[0];l.deduction_estimate_cents=null;l.original_calculation=null;l.reason='missing_odoo_sku';
 l.effective_unit_cost_eur=null;l.kino_tier=null;l.unit_basis=null;b.data.estimated_lines=0;
 assert.equal(normalizeMonthlyCredits(b,'2026-10').documents[0].lines[0].deduction_estimate_cents,null);
 const wrong=clone(b);wrong.data.documents[0].lines[0].reason=null;assert.throws(()=>normalizeMonthlyCredits(wrong,'2026-10'));
});
test('a new period, incomplete counts, duplicate lines and source auto-application flags are rejected',()=>{
 for(const modify of [b=>b.data.month='2026-09',b=>b.data.line_count=2,b=>b.data.automatic_deduction=true,b=>b.data.source_rechecked=false,
  b=>b.data.documents[0].date='2026-02-30',b=>b.data.documents[0].lines.push(clone(b.data.documents[0].lines[0]))]){
  const b=creditFixture();modify(b);assert.throws(()=>normalizeMonthlyCredits(b,'2026-10'));
 }
});
test('explicit invoice notes remain distinct from a native reversal and cannot hide multiple origin lines',()=>{
 const b=creditFixture(),d=b.data.documents[0],l=d.lines[0];d.explicit_invoice_references=['TEST-INVOICE'];
 d.reversed_invoice_id=null;d.original_invoice.link_kind='explicit_invoice_note_reference';l.link_kind='explicit_invoice_note_unique_line';l.original_invoice_line_id=1001;
 assert.equal(normalizeMonthlyCredits(b,'2026-10').documents[0].original_invoice.link_kind,'explicit_invoice_note_reference');
 l.original_invoice_line_id=null;assert.throws(()=>normalizeMonthlyCredits(b,'2026-10'));
});
test('a consistent provisional balance subtracts the commission estimate, not the invoice HT, and preserves an earlier-order negative balance',()=>{
 const data=normalizeMonthlyCredits(creditFixture(),'2026-10'),recorded={month:'2026-10',readAt:data.readAt,deductions:[]};
 const opts={month:'2026-10',sourceFresh:true,pipelineReadAt:data.readAt,catalogSnapshotAt:data.catalogSnapshotAt};
 const r=proposedBalanceWithCredits({count:1,forecast:100},recorded,data,opts);assert.equal(r.netCents,8950);assert.equal(r.candidateCents,1050);assert.equal(r.complete,false);
 assert.equal(proposedBalanceWithCredits({count:0,forecast:null},recorded,data,opts).netCents,-1050);
});
test('an already recorded order deduction prevents a second candidate withdrawal and remains explicitly unresolved',()=>{
 const data=normalizeMonthlyCredits(creditFixture(),'2026-10'),recorded={month:'2026-10',readAt:data.readAt,
  deductions:[{month:'2026-10',company:'TR',reference:'TEST-OLDER',commission_cents:700}]};
 const r=proposedBalanceWithCredits({count:1,forecast:100},recorded,data,{month:'2026-10',sourceFresh:true,pipelineReadAt:data.readAt,catalogSnapshotAt:data.catalogSnapshotAt});
 assert.equal(r.netCents,9300);assert.equal(r.candidateCents,0);assert.equal(r.skippedCandidates,1);assert.equal(r.complete,false);
});
test('different cost captures, missing source, stale reads or a searched subset suspend the balance',()=>{
 const data=normalizeMonthlyCredits(creditFixture(),'2026-10'),recorded={month:'2026-10',readAt:data.readAt,deductions:[]};
 const opts={month:'2026-10',sourceFresh:true,pipelineReadAt:data.readAt,catalogSnapshotAt:data.catalogSnapshotAt};
 for(const changes of [{catalogSnapshotAt:'2026-09-01T00:00:00Z'},{sourceFresh:false},{query:'TEST'},
  {pipelineReadAt:'2026-01-01T00:00:00Z'},{month:'2026-09'}])assert.equal(proposedBalanceWithCredits({count:1,forecast:100},recorded,data,{...opts,...changes}).available,false);
 assert.equal(proposedBalanceWithCredits({count:1,forecast:100},null,data,opts).available,false);
});
