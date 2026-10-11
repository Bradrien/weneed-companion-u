/** Bounded seller order -> invoice links -> direct reversals. Read only, no commission allocation. */
export const ORDER_FIELDS=Object.freeze(['id','name','state','invoice_status','user_id','company_id',
 'partner_id','currency_id','amount_untaxed','invoice_ids','write_date']);
export const MOVE_FIELDS=Object.freeze(['id','name','state','move_type','payment_state','company_id',
 'partner_id','currency_id','invoice_date','amount_untaxed','amount_total','amount_residual','reversed_entry_id','write_date']);
const COMPANIES={'Global Trust Agriculture SA':'GTA','Trim Rocket s.r.o.':'TR'};
const id=x=>Array.isArray(x)&&Number.isSafeInteger(x[0])&&x[0]>0?x[0]:null;
const label=x=>Array.isArray(x)&&typeof x[1]==='string'?x[1]:'';
const number=x=>typeof x==='number'&&Number.isFinite(x)?x:null;
const text=x=>typeof x==='string'?x:'';
function assertRows(before,after,fields){
 if(!Array.isArray(before)||!Array.isArray(after)||before.length!==after.length)throw Error('odoo_source_changed');
 const map=new Map(),seen=new Set();
 for(const row of before){
  if(!row||!Number.isSafeInteger(row.id)||row.id<1||map.has(row.id))throw Error('odoo_invalid_response');
  map.set(row.id,row);
 }
 for(const row of after){
  if(!row||seen.has(row.id)||!map.has(row.id)||fields.some(k=>JSON.stringify(row[k])!==JSON.stringify(map.get(row.id)[k])))
   throw Error('odoo_source_changed');
  seen.add(row.id);
 }
}
export function parseInvoiceOrderId(url){
 const params=new URL(url).searchParams;
 if(params.size!==1||params.getAll('order_id').length!==1||
  !/^[1-9]\d{0,14}$/.test(params.get('order_id')||''))throw Error('invalid_order_id');
 const value=Number(params.get('order_id'));if(!Number.isSafeInteger(value))throw Error('invalid_order_id');
 return value;
}
export async function readInvoiceEvidence(orderId,{uid,read,now=()=>new Date()}){
 if(!Number.isSafeInteger(orderId)||orderId<1||!Number.isSafeInteger(uid)||uid<1)throw Error('invalid_order_id');
 const orderDomain=[['id','=',orderId],['user_id','=',uid]],orders=await read('sale.order',orderDomain,ORDER_FIELDS,2);
 if(!Array.isArray(orders)||orders.length===0)throw Error('order_not_accessible');
 if(orders.length!==1)throw Error('odoo_invalid_response');
 const order=orders[0],companyId=id(order.company_id),companyName=label(order.company_id),
  company=Object.hasOwn(COMPANIES,companyName)?COMPANIES[companyName]:null;
 if(order.id!==orderId||id(order.user_id)!==uid||!companyId||!company||!id(order.partner_id)||
  !['draft','sent','sale','done','cancel'].includes(order.state)||!Array.isArray(order.invoice_ids)||
  order.invoice_ids.some(x=>!Number.isSafeInteger(x)||x<1)||new Set(order.invoice_ids).size!==order.invoice_ids.length)
  throw Error('invoice_scope_mismatch');
 const linkedIds=order.invoice_ids;
 if(linkedIds.length>60)throw Error('invoice_scope_limit');
 const linkedDomain=[['id','in',linkedIds],['company_id','=',companyId]];
 const linked=linkedIds.length?await read('account.move',linkedDomain,MOVE_FIELDS,linkedIds.length+1):[];
 if(!Array.isArray(linked)||linked.length!==linkedIds.length||new Set(linked.map(x=>x.id)).size!==linked.length||
  linked.some(x=>!linkedIds.includes(x.id)||id(x.company_id)!==companyId||!['out_invoice','out_refund'].includes(x.move_type)))
  throw Error('invoices_not_accessible');
 const invoiceIds=linked.filter(x=>x.move_type==='out_invoice').map(x=>x.id);
 const reversalDomain=[['reversed_entry_id','in',invoiceIds],['company_id','=',companyId],['move_type','=','out_refund']];
 const reversals=invoiceIds.length?await read('account.move',reversalDomain,MOVE_FIELDS,61):[];
 if(!Array.isArray(reversals)||reversals.length>60||new Set(reversals.map(x=>x.id)).size!==reversals.length)
  throw Error('invoice_scope_limit');
 if(reversals.some(x=>!Number.isSafeInteger(x.id)||x.id<1||id(x.company_id)!==companyId||
  x.move_type!=='out_refund'||!invoiceIds.includes(id(x.reversed_entry_id))))throw Error('invoice_scope_mismatch');
 const all=new Map(linked.map(x=>[x.id,{row:x,origin:'order_invoice_link'}]));
 for(const row of reversals){
  if(all.has(row.id))assertRows([all.get(row.id).row],[row],MOVE_FIELDS);
  else all.set(row.id,{row,origin:'direct_reversal'});
 }
 if(all.size>60)throw Error('invoice_scope_limit');
 // Repeat the same scopes: additions, removals, payments and reversal edits invalidate this read.
 if(linkedIds.length)assertRows(linked,await read('account.move',linkedDomain,MOVE_FIELDS,linkedIds.length+1),MOVE_FIELDS);
 if(invoiceIds.length)assertRows(reversals,await read('account.move',reversalDomain,MOVE_FIELDS,61),MOVE_FIELDS);
 assertRows(orders,await read('sale.order',orderDomain,ORDER_FIELDS,2),ORDER_FIELDS);
 const documents=[...all.values()].map(({row,origin})=>{
  const issues=[],currency=label(row.currency_id),rawPayment=text(row.payment_state),payment=rawPayment||'unknown',state=text(row.state);
  if(!['draft','posted','cancel'].includes(state)||!id(row.partner_id)||!/^[A-Z]{3}$/.test(currency)||
   !/^[a-z_]{1,30}$/.test(payment))throw Error('odoo_invalid_response');
  if(!rawPayment)issues.push('missing_payment_state');
  const amountHT=number(row.amount_untaxed),total=number(row.amount_total),residual=number(row.amount_residual);
  if([amountHT,total,residual].some(x=>x===null))issues.push('missing_document_amount');
  if(payment==='paid'&&(residual===null||Math.abs(residual)>0.000001))issues.push('payment_residual_mismatch');
  if(payment==='paid'&&state!=='posted')issues.push('unposted_payment_indicator');
  const date=row.invoice_date===false||row.invoice_date===null?null:text(row.invoice_date);
  if(date!==null&&(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date+'T00:00:00Z'))||
   new Date(date+'T00:00:00Z').toISOString().slice(0,10)!==date))
   throw Error('odoo_invalid_response');
  return {id:row.id,reference:text(row.name).slice(0,120),origin,
   kind:row.move_type==='out_invoice'?'invoice':'credit_note',state,payment_state:payment,currency,date,
   amount_ht:amountHT,amount_total:total,amount_residual:residual,
   reverses_id:id(row.reversed_entry_id),issues,
   odoo_paid_indicator:row.move_type==='out_invoice'&&state==='posted'&&payment==='paid'&&!issues.length};
 }).sort((a,b)=>(a.date||'').localeCompare(b.date||'')||a.id-b.id);
 return {version:'odoo_invoice_evidence_v1',read_at:now().toISOString(),source_rechecked:true,
  scope:'seller_linked_invoices_and_direct_reversals_read_only_rechecked',
  payment_semantics:'account_move_state_payment_state_residual_not_commission_entitlement',
  document_amounts_attributed_to_order:false,commission_payable:false,
  order:{id:order.id,reference:text(order.name).slice(0,120),company,state:order.state,
   invoice_status:text(order.invoice_status),currency:label(order.currency_id),amount_ht:number(order.amount_untaxed)},
  documents,invoice_count:documents.filter(d=>d.kind==='invoice').length,
  credit_note_count:documents.filter(d=>d.kind==='credit_note').length,
  odoo_paid_invoice_count:documents.filter(d=>d.odoo_paid_indicator).length};
}
