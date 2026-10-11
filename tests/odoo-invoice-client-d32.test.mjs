import test from 'node:test';
import assert from 'node:assert/strict';
import {readInvoiceEvidence} from '../supabase/functions/odoo-invoice-evidence/core.mjs';
import {normalizeInvoiceEvidence} from '../validation-v12/assets/odoo-invoice-evidence-d32.mjs';
const sourceOrder={id:1,name:'TEST-ORDER',state:'sale',invoice_status:'invoiced',user_id:[100,'Vendeur test'],
 company_id:[10,'Trim Rocket s.r.o.'],partner_id:[200,'Client test'],currency_id:[1,'EUR'],
 amount_untaxed:140,invoice_ids:[501],write_date:'2026-10-11 09:00:00'};
const sourceMove={id:501,name:'TEST-INV',state:'posted',move_type:'out_invoice',payment_state:'paid',
 company_id:[10,'Trim Rocket s.r.o.'],partner_id:[200,'Client test'],currency_id:[1,'EUR'],
 invoice_date:'2026-10-09',amount_untaxed:140,amount_total:140,amount_residual:0,
 reversed_entry_id:false,write_date:'2026-10-11 09:00:00'};
async function response({move={},refund=false,empty=false}={}){
 return readInvoiceEvidence(1,{uid:100,now:()=>new Date('2026-10-11T12:00:00Z'),read:async(model,domain)=>
  structuredClone(model==='sale.order'?[{...sourceOrder,invoice_ids:empty?[]:[501]}]:
   domain[0][0]==='id'?[{...sourceMove,...move}]:refund?[{...sourceMove,id:502,name:'TEST-CREDIT',
    move_type:'out_refund',reversed_entry_id:[501,'TEST-INV']}]:[])});
}
const normalize=r=>normalizeInvoiceEvidence(r,{orderId:1,company:'TR'});
test('client accepts the real server shape and keeps accounting indicators outside commissions',async()=>{
 const r=normalize(await response({refund:true}));
 assert.equal(r.invoiceCount,1);assert.equal(r.creditNoteCount,1);assert.equal(r.paidInvoiceCount,1);
 assert.equal(r.documents[0].paymentLabel,'Indiqué payé dans Odoo');
 assert.equal(r.documents[1].odooPaidIndicator,false);assert.equal(r.documents[1].reversesId,501);
 assert.equal(r.commissionPayable,false);assert.equal(r.amountsAttributedToOrder,false);
});
test('unrechecked, foreign, allocated or payable responses are rejected',async()=>{
 const raw=await response();
 for(const change of [{version:'legacy'},{source_rechecked:false},{scope:'all_invoices'},
  {payment_semantics:'commission_paid'},{document_amounts_attributed_to_order:true},
  {commission_payable:true},{read_at:'invalid'},{order:{...raw.order,id:2}},
  {order:{...raw.order,company:'GTA'}}])assert.throws(()=>normalize({...raw,...change}),/invalid_invoice_evidence/);
});
test('counts and direct reversals must agree with the actual returned documents',async()=>{
 const raw=await response({refund:true});
 for(const key of ['invoice_count','credit_note_count','odoo_paid_invoice_count'])
  assert.throws(()=>normalize({...raw,[key]:raw[key]+1}),/invalid_invoice_evidence/);
 for(const change of [{reverses_id:999},{kind:'invoice'},{origin:'all_company_documents'}]){
  const r=structuredClone(raw);Object.assign(r.documents[1],change);
  assert.throws(()=>normalize(r),/invalid_invoice_evidence/);
 }
 const dup=structuredClone(raw);dup.documents[1].id=501;
 assert.throws(()=>normalize(dup),/invalid_invoice_evidence/);
});
test('a zero balance cannot forge paid and contradictory accounting states retain their diagnostics',async()=>{
 for(const move of [{payment_state:'not_paid'},{payment_state:'in_payment'},
  {payment_state:'partial',amount_residual:20},{amount_residual:.01},{state:'draft'}]){
  const raw=await response({move}),r=normalize(raw);assert.equal(r.paidInvoiceCount,0);
  assert.equal(r.documents[0].odooPaidIndicator,false);
  const forged=structuredClone(raw);forged.documents[0].odoo_paid_indicator=true;forged.odoo_paid_invoice_count=1;
  assert.throws(()=>normalize(forged),/invalid_invoice_evidence/);
 }
 const raw=await response({move:{amount_residual:1}});raw.documents[0].issues=[];
 assert.throws(()=>normalize(raw),/invalid_invoice_evidence/);
});
test('unknown payments, missing amounts, full document values and signed amounts remain distinct',async()=>{
 const missing=normalize(await response({move:{payment_state:false,amount_residual:null}}));
 assert.equal(missing.documents[0].residual,null);assert.equal(missing.paidInvoiceCount,0);
 assert.ok(missing.documents[0].issues.includes('missing_payment_state'));
 const r=normalize(await response({move:{amount_total:-1000,amount_untaxed:-900,currency_id:[2,'CHF']}}));
 assert.equal(r.documents[0].amountTotal,-1000);assert.equal(r.documents[0].currency,'CHF');
 assert.equal(r.order.amountHT,140);assert.equal(r.amountsAttributedToOrder,false);
 assert.equal(normalize(await response({empty:true})).documents.length,0);
});
test('coerced amounts, impossible dates and oversized evidence are not accepted',async()=>{
 const raw=await response();
 for(const change of [{amount_residual:'0'},{amount_total:Infinity},{date:'2026-02-30'},
  {date:0},{issues:['constructor']},{payment_state:'constructor',odoo_paid_indicator:true}]){
  const r=structuredClone(raw);Object.assign(r.documents[0],change);
  assert.throws(()=>normalize(r),/invalid_invoice_evidence/);
 }
 assert.throws(()=>normalize({...raw,documents:Array(61).fill(raw.documents[0])}),/invalid_invoice_evidence/);
});
