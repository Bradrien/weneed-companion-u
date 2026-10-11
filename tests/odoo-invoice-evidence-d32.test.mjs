import test from 'node:test';
import assert from 'node:assert/strict';
import {readInvoiceEvidence,parseInvoiceOrderId,ORDER_FIELDS,MOVE_FIELDS} from '../supabase/functions/odoo-invoice-evidence/core.mjs';
const order=()=>({id:1,name:'TEST-ORDER',state:'sale',invoice_status:'invoiced',user_id:[100,'Vendeur test'],
 company_id:[10,'Trim Rocket s.r.o.'],partner_id:[200,'Client test'],currency_id:[1,'EUR'],amount_untaxed:140,
 invoice_ids:[501],write_date:'2026-10-11 09:00:00'});
const move=(changes={})=>({id:501,name:'TEST-INV',state:'posted',move_type:'out_invoice',payment_state:'paid',
 company_id:[10,'Trim Rocket s.r.o.'],partner_id:[200,'Client test'],currency_id:[1,'EUR'],invoice_date:'2026-10-09',
 amount_untaxed:140,amount_total:140,amount_residual:0,reversed_entry_id:false,write_date:'2026-10-11 09:00:00',...changes});
function source({initialOrder=order(),linked=[move()],reversals=[],onRead}={}){
 const calls=[];
 const read=async(model,domain,fields,limit)=>{
  calls.push({model,domain,fields,limit});
  const stage=model==='sale.order'?'order':domain[0][0]==='id'?'linked':'reversals';
  const original=stage==='order'?[initialOrder]:stage==='linked'?linked:reversals;
  const rows=structuredClone(original);return onRead?.({stage,calls,rows})??rows;
 };
 return {calls,read,uid:100,now:()=>new Date('2026-10-11T12:00:00Z')};
}
test('query accepts only one positive safe order identity',()=>{
 assert.equal(parseInvoiceOrderId('https://test.invalid/?order_id=123'),123);
 for(const q of ['','order_id=0','order_id=-1','order_id=01','order_id=1&order_id=2',
  'order_id=1&fields=payment_state','order_id=9007199254740992','order_id=1.5'])
  assert.throws(()=>parseInvoiceOrderId('https://test.invalid/?'+q),/invalid_order_id/);
});
test('paid accounting indicator is rechecked but never establishes commission entitlement',async()=>{
 const s=source(),r=await readInvoiceEvidence(1,s);
 assert.equal(r.odoo_paid_invoice_count,1);assert.equal(r.documents[0].odoo_paid_indicator,true);
 assert.equal(r.source_rechecked,true);assert.equal(r.commission_payable,false);
 assert.equal(r.document_amounts_attributed_to_order,false);assert.equal(r.order.company,'TR');
 assert.equal(r.invoice_count,1);assert.equal(r.credit_note_count,0);
 assert.equal(s.calls.length,6);
 for(const call of s.calls){
  assert.ok(call.limit>0&&call.limit<=61);
  if(call.model==='sale.order'){
   assert.deepEqual(call.domain,[['id','=',1],['user_id','=',100]]);assert.deepEqual(call.fields,ORDER_FIELDS);
  }else{assert.ok(call.domain.some(x=>x[0]==='company_id'&&x[2]===10));assert.deepEqual(call.fields,MOVE_FIELDS);}
 }
});
test('only directly reversed invoices in the same source company are included',async()=>{
 const credit=move({id:502,name:'TEST-CREDIT',move_type:'out_refund',reversed_entry_id:[501,'TEST-INV']});
 const r=await readInvoiceEvidence(1,source({reversals:[credit]}));
 assert.equal(r.credit_note_count,1);assert.equal(r.odoo_paid_invoice_count,1);
 assert.equal(r.documents[1].origin,'direct_reversal');assert.equal(r.documents[1].odoo_paid_indicator,false);
 assert.equal(r.documents[1].reverses_id,501);
 for(const change of [{company_id:[11,'Other']},{reversed_entry_id:[999,'OTHER']},{move_type:'in_refund'}])
  await assert.rejects(()=>readInvoiceEvidence(1,source({reversals:[{...credit,...change}]})),/invoice_scope_mismatch/);
});
test('a credit note already linked to the order is not counted twice',async()=>{
 const o=order();o.invoice_ids.push(502);
 const credit=move({id:502,move_type:'out_refund',reversed_entry_id:[501,'TEST-INV']});
 const r=await readInvoiceEvidence(1,source({initialOrder:o,linked:[move(),credit],reversals:[credit]}));
 assert.equal(r.documents.length,2);assert.equal(r.credit_note_count,1);
 assert.equal(r.documents[1].origin,'order_invoice_link');
});
test('no linked invoice is a rechecked source fact, with no invoice search or assumed payment',async()=>{
 const o=order();o.invoice_ids=[];o.state='draft';const s=source({initialOrder:o}),r=await readInvoiceEvidence(1,s);
 assert.equal(r.documents.length,0);assert.equal(r.odoo_paid_invoice_count,0);
 assert.equal(r.source_rechecked,true);assert.deepEqual(s.calls.map(x=>x.model),['sale.order','sale.order']);
});
test('another salesperson, unsupported company or mismatched order is refused before invoice reads',async()=>{
 for(const change of [{user_id:[101,'Other']},{company_id:[11,'Unsupported']},{id:2},
  {company_id:[11,'__proto__']},{invoice_ids:[501,501]}]){
  const s=source({initialOrder:{...order(),...change}});
  await assert.rejects(()=>readInvoiceEvidence(1,s),/invoice_scope_mismatch/);assert.equal(s.calls.length,1);
 }
 const s=source({onRead:()=>[]});await assert.rejects(()=>readInvoiceEvidence(1,s),/order_not_accessible/);
});
test('missing, duplicate, foreign or vendor invoices cannot produce incomplete trusted evidence',async()=>{
 for(const linked of [[],[move(),move()],[move({company_id:[11,'Other']})],[move({move_type:'in_invoice'})]])
  await assert.rejects(()=>readInvoiceEvidence(1,source({linked})),/invoices_not_accessible/);
});
test('scope size is bounded for linked documents and reversal results',async()=>{
 const o=order();o.invoice_ids=Array.from({length:61},(_,i)=>i+1);
 await assert.rejects(()=>readInvoiceEvidence(1,source({initialOrder:o})),/invoice_scope_limit/);
 const refunds=Array.from({length:61},(_,i)=>move({id:600+i,move_type:'out_refund',reversed_entry_id:[501,'TEST-INV']}));
 await assert.rejects(()=>readInvoiceEvidence(1,source({reversals:refunds})),/invoice_scope_limit/);
});
test('changed payment, source amounts, added credit notes or reordered invoice links invalidate the read',async()=>{
 for(const change of [{payment_state:'partial',amount_residual:10},{amount_total:141},{state:'cancel'}]){
  const s=source({onRead:({stage,calls,rows})=>stage==='linked'&&calls.filter(c=>c.model==='account.move'&&c.domain[0][0]==='id').length>1?
   [{...rows[0],...change}]:rows});
  await assert.rejects(()=>readInvoiceEvidence(1,s),/odoo_source_changed/);
 }
 const credit=move({id:502,move_type:'out_refund',reversed_entry_id:[501,'TEST-INV']});
 const s=source({onRead:({stage,calls,rows})=>stage==='reversals'&&calls.filter(c=>c.model==='account.move'&&c.domain[0][0]==='reversed_entry_id').length>1?
  [credit]:rows});
 await assert.rejects(()=>readInvoiceEvidence(1,s),/odoo_source_changed/);
 const changed=source({onRead:({stage,calls,rows})=>stage==='order'&&calls.length>1?[{...rows[0],invoice_ids:[]}]:rows});
 await assert.rejects(()=>readInvoiceEvidence(1,changed),/odoo_source_changed/);
});
test('zero residual alone, draft paid status or contradictory paid/residual values do not count as paid',async()=>{
 for(const change of [{payment_state:'not_paid'},{payment_state:'in_payment'},
  {payment_state:'partial',amount_residual:25},{state:'draft'},{amount_residual:.01}]){
  const r=await readInvoiceEvidence(1,source({linked:[move(change)]}));
  assert.equal(r.odoo_paid_invoice_count,0);assert.equal(r.documents[0].odoo_paid_indicator,false);
 }
});
test('unknown payment metadata and missing numeric values stay visible without an assumed paid flag',async()=>{
 const r=await readInvoiceEvidence(1,source({linked:[move({payment_state:false,amount_residual:null})]}));
 assert.equal(r.documents[0].payment_state,'unknown');assert.equal(r.documents[0].amount_residual,null);
 assert.equal(r.documents[0].odoo_paid_indicator,false);assert.ok(r.documents[0].issues.includes('missing_payment_state'));
});
test('mixed currencies and combined invoices are retained individually and never allocated or added to commissions',async()=>{
 const o=order();o.invoice_ids.push(502);
 const r=await readInvoiceEvidence(1,source({initialOrder:o,linked:[move({amount_total:1000}),
  move({id:502,currency_id:[2,'CHF']})]}));
 assert.equal(r.documents.length,2);assert.equal(r.documents[0].amount_total,1000);
 assert.equal(r.documents[1].currency,'CHF');assert.equal(r.document_amounts_attributed_to_order,false);
 assert.equal(r.commission_payable,false);assert.equal('commission' in r,false);
});
