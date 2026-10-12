import {sourceTime,sourceText,sourceCount} from './source-state-d34.mjs';
import {calculateKinoLine} from './kino-calculation-d31.mjs';
import {cents} from './commission-integrity-d24.mjs';
import {compareProductNames,compatibleListingSku,validateListingMatch} from './product-match-v1.mjs';
const sid=x=>{if(!Number.isSafeInteger(x)||x<1)throw Error('invalid_credit_evidence');return x};
const number=x=>x===null||typeof x==='number'&&Number.isFinite(x);
const day=x=>{if(typeof x!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(x)||!Number.isFinite(Date.parse(x+'T00:00:00Z'))||new Date(x+'T00:00:00Z').toISOString().slice(0,10)!==x)throw Error('invalid_credit_evidence');return x};
const reasons=new Set(['not_product_line','not_eligible','multiple_sale_lines','missing_original_invoice_link','original_invoice_scope_mismatch',
 'ambiguous_original_invoice_lines','missing_original_invoice_line','conflicting_original_invoice_reference','multiple_original_invoice_references','ambiguous_original_invoice_reference','original_invoice_reference_not_accessible','credit_amount_unverified','credit_line_total_mismatch','credit_not_posted',
 'not_eur','original_sale_not_accessible','original_sale_scope_mismatch','product_identity_mismatch','unit_identity_unverified',
 'invalid_refund_amount','return_quantity_exceeds_sale','refund_price_mismatch','missing_odoo_sku','catalog_unavailable','ambiguous_sku',
 'missing_kino_match','invalid_kino_cost_or_tier','unverified_unit_scale','invalid_calculation']);
const optionalId=x=>x===null?null:sid(x);
export function normalizeMonthlyCredits(body,month){
 const d=body?.data,ids=new Set(),lineIds=new Set(),sourceLines=new Map();
 if(body?.ok!==true||!d||d.version!=='odoo_monthly_credits_v1'||d.month!==month||!/^20\d{2}-(0[1-9]|1[0-2])$/.test(month)||
  d.scope!=='seller_attributed_credit_notes_invoice_date_read_only_rechecked'||d.source_rechecked!==true||
  d.read_consistency!=='two_read_windows_not_atomic_snapshot'||d.automatic_deduction!==false||d.spiff_enabled!==false||
  d.historical_costs_verified!==false||d.calculation_version!=='original_line_commission_prorata_return_quantity_v1'||
  !Array.isArray(d.documents)||d.documents.length>40||sourceCount(d.document_count,40)!==d.documents.length||
  !sourceTime(d.read_at)||d.catalog_snapshot_at!==null&&!sourceTime(d.catalog_snapshot_at))throw Error('invalid_credit_evidence');
 const documents=d.documents.map(doc=>{
  const docId=sid(doc.id);if(ids.has(docId)||!['GTA','TR'].includes(doc.company)||!['draft','posted','cancel'].includes(doc.state)||
   !/^[A-Z]{3}$/.test(doc.currency)||day(doc.date).slice(0,7)!==month||!number(doc.amount_ht)||!number(doc.amount_total)||
   !Array.isArray(doc.issues)||doc.issues.some(x=>!['credit_amount_unverified','credit_line_total_mismatch'].includes(x))||
   !Array.isArray(doc.lines)||doc.lines.length>400)throw Error('invalid_credit_evidence');ids.add(docId);
  if(!Array.isArray(doc.explicit_invoice_references)||doc.explicit_invoice_references.length>40||doc.explicit_invoice_references.some(x=>typeof x!=='string'||!x||x.length>120))throw Error('invalid_credit_evidence');
  if(doc.original_invoice!==null&&(!doc.original_invoice||!['native_reversal','explicit_invoice_note_reference'].includes(doc.original_invoice.link_kind)||
   typeof doc.original_invoice.reference!=='string'||!doc.original_invoice.reference||doc.original_invoice.reference.length>120))throw Error('invalid_credit_evidence');
  const originalInvoice=doc.original_invoice===null?null:{...doc.original_invoice,id:sid(doc.original_invoice.id)};
  if(originalInvoice&&originalInvoice.lines!==undefined){
   if(!Array.isArray(originalInvoice.lines)||originalInvoice.lines.length>400||!/^[A-Z]{3}$/.test(originalInvoice.currency)||!number(originalInvoice.amount_ht))throw Error('invalid_credit_evidence');
   day(originalInvoice.date);const originalIds=new Set();
   originalInvoice.lines=originalInvoice.lines.map(l=>{sid(l.id);if(originalIds.has(l.id)||![l.quantity,l.price_unit,l.discount_pct,l.subtotal_ht].every(number))throw Error('invalid_credit_evidence');
    originalIds.add(l.id);return {...l,product_id:optionalId(l.product_id),unit_id:optionalId(l.unit_id),sale_link_count:sourceCount(l.sale_link_count,400),
     product:sourceText(l.product,300,{empty:true}),sku:sourceText(l.sku,100,{empty:true}),unit:sourceText(l.unit,80,{empty:true})};
   });
  }
  if(originalInvoice&&(originalInvoice.link_kind==='native_reversal'&&originalInvoice.id!==doc.reversed_invoice_id||
   originalInvoice.link_kind==='explicit_invoice_note_reference'&&(doc.reversed_invoice_id!==null||doc.explicit_invoice_references.length!==1||doc.explicit_invoice_references[0]!==originalInvoice.reference)))throw Error('invalid_credit_evidence');
  const lines=doc.lines.map(l=>{
   const lineId=sid(l.id);if(lineIds.has(lineId)||!number(l.quantity)||!number(l.subtotal_ht)||!number(l.price_unit)||!number(l.discount_pct)||
    l.reason!==null&&!reasons.has(l.reason)||!number(l.effective_unit_cost_eur)||
    l.unit_basis!==null&&!['pack_cost_divided_by_grams','catalog_price_matches_odoo_unit'].includes(l.unit_basis)||
    l.pack_size_g!==null&&(!Number.isSafeInteger(l.pack_size_g)||l.pack_size_g<1)||l.kino_tier!==null&&!['A','B'].includes(l.kino_tier))throw Error('invalid_credit_evidence');
   lineIds.add(lineId);const productId=optionalId(l.product_id),unitId=optionalId(l.unit_id),invoiceLineId=optionalId(l.original_invoice_line_id);
   let original=null,calculation=null;
   if(l.link_kind==='unique_reversed_invoice_line'&&originalInvoice?.link_kind!=='native_reversal'||
    l.link_kind==='explicit_invoice_note_unique_line'&&originalInvoice?.link_kind!=='explicit_invoice_note_reference')throw Error('invalid_credit_evidence');
   if(l.original!==null){const o=l.original;
    if(!o||!['sale','done','draft','sent','cancel'].includes(o.state)||![o.quantity,o.subtotal_ht,o.price_unit,o.discount_pct].every(number))throw Error('invalid_credit_evidence');
    original={...o,order_id:sid(o.order_id),line_id:sid(o.line_id),reference:sourceText(o.reference,120),date:day(o.date),unit_id:optionalId(o.unit_id)};
    if(!['direct_sale_line','unique_reversed_invoice_line','explicit_invoice_note_unique_line'].includes(l.link_kind)||
     ['unique_reversed_invoice_line','explicit_invoice_note_unique_line'].includes(l.link_kind)&&invoiceLineId===null||l.link_kind==='direct_sale_line'&&invoiceLineId!==null)throw Error('invalid_credit_evidence');
    const key=original.line_id,signature=JSON.stringify(original);
    if(sourceLines.has(key)&&sourceLines.get(key)!==signature)throw Error('invalid_credit_evidence');sourceLines.set(key,signature);
   }else if(l.link_kind!==null||invoiceLineId!==null)throw Error('invalid_credit_evidence');
   const estimate=l.deduction_estimate_cents;
   const identity=l.listing_identity??null,match=l.listing_match??null;
   if(identity){
    const invoiceLine=originalInvoice?.lines?.find(x=>x.id===invoiceLineId);
    sid(identity.source_product_id);
    const sourceReference=original?.sku||original?.product?.match(/^\s*\[([A-Za-z0-9_+./ -]{2,100})\]/)?.[1]||'';
    const unique=originalInvoice?.lines?.filter(x=>x.unit_id===unitId&&x.quantity>0&&x.subtotal_ht>0&&
     compareProductNames(l.product,x.product)&&l.quantity>0&&l.subtotal_ht>0&&
     Math.abs(l.subtotal_ht/l.quantity-x.subtotal_ht/x.quantity)<=0.04);
    if(!original||!invoiceLine||identity.unique_invoice_line!==true||identity.invoice_line_id!==invoiceLineId||
     identity.source_product_id!==original.product_id||invoiceLine.product_id!==original.product_id||
     original.product_id===productId||invoiceLine.sale_link_count!==1||
     compareProductNames(l.product,identity.source_product)!==identity.method||
     identity.source_product!==original.product||identity.source_sku!==original.sku||
     !compareProductNames(invoiceLine.product,original.product)||
     invoiceLine.unit_id!==unitId||unique?.length!==1||unique[0].id!==invoiceLineId||
     l.sku&&sourceReference&&!compatibleListingSku(l.sku,sourceReference))throw Error('invalid_credit_evidence');
   }
   if(match&&!validateListingMatch(match,{company:doc.company,sku:original?original.sku:l.sku,product:original?.product||l.product}))throw Error('invalid_credit_evidence');
   if(original?.product_id!==undefined&&original.product_id!==productId&&!identity&&estimate!==null)throw Error('invalid_credit_evidence');
   if(estimate!==null){
    if(!Number.isSafeInteger(estimate)||estimate<0||l.reason!==null||doc.state!=='posted'||doc.currency!=='EUR'||doc.issues.length||
     !original||!['sale','done'].includes(original.state)||!productId||!unitId||unitId!==original.unit_id||
     !l.unit_basis||!l.kino_tier||typeof l.effective_unit_cost_eur!=='number'||l.effective_unit_cost_eur<=0||
     typeof l.quantity!=='number'||l.quantity<=0||original.quantity<=0||l.quantity>original.quantity+0.000001||
     typeof l.subtotal_ht!=='number'||l.subtotal_ht<=0||!l.original_calculation||
     l.price_unit===null||l.price_unit<=0||l.discount_pct===null||l.discount_pct<0||l.discount_pct>100||
     original.price_unit===null||original.price_unit<=0||original.discount_pct===null||original.discount_pct<0||original.discount_pct>100||
     Math.abs(l.quantity*l.price_unit*(1-l.discount_pct/100)-l.subtotal_ht)>0.04||
     Math.abs(original.quantity*original.price_unit*(1-original.discount_pct/100)-original.subtotal_ht)>0.04||
     Math.abs(l.subtotal_ht-l.quantity*original.subtotal_ht/original.quantity)>0.04)throw Error('invalid_credit_calculation');
    try{calculation=calculateKinoLine({tier:l.kino_tier,cost:l.effective_unit_cost_eur,quantity:original.quantity,subtotalHT:original.subtotal_ht})}catch{throw Error('invalid_credit_calculation')}
    if(Object.entries(calculation).some(([k,v])=>l.original_calculation[k]!==v)||
     Math.round(Math.round(calculation.commission*100)*l.quantity/original.quantity)!==estimate)throw Error('invalid_credit_calculation');
   }else if(l.reason===null||l.original_calculation!==null)throw Error('invalid_credit_calculation');
   return {...l,id:lineId,product_id:productId,unit_id:unitId,original_invoice_line_id:invoiceLineId,original,
    product:sourceText(l.product,300,{empty:true}),sku:sourceText(l.sku,100,{empty:true}),unit:sourceText(l.unit,80,{empty:true}),original_calculation:calculation};
  });
  const sums=lines.filter(l=>l.reason!=='not_product_line').map(l=>l.subtotal_ht);
  if(lines.some(l=>l.deduction_estimate_cents!==null)&&(doc.amount_ht===null||sums.some(x=>x===null)||
   Math.abs(sums.reduce((a,b)=>a+b,0)-doc.amount_ht)>0.04))throw Error('invalid_credit_calculation');
  return {...doc,id:docId,original_invoice:originalInvoice,reference:sourceText(doc.reference,120),client:sourceText(doc.client,180,{empty:true}),
   origin_reference:sourceText(doc.origin_reference,500,{empty:true}),external_reference:sourceText(doc.external_reference,500,{empty:true}),
   note:sourceText(doc.note,2000,{empty:true}),reversed_invoice_id:optionalId(doc.reversed_invoice_id),lines};
 });
 const flat=documents.flatMap(d=>d.lines),estimated=flat.filter(l=>l.deduction_estimate_cents!==null);
 if(sourceCount(d.line_count,400)!==flat.length||sourceCount(d.estimated_lines,400)!==estimated.length)throw Error('invalid_credit_evidence');
 const quantities=new Map();
 for(const doc of documents)for(const l of doc.lines){if(doc.state!=='posted'||!l.original||l.quantity===null||l.quantity<=0)continue;
  quantities.set(l.original.line_id,(quantities.get(l.original.line_id)||0)+l.quantity)}
 if(estimated.some(l=>(quantities.get(l.original.line_id)||0)>l.original.quantity+0.000001))throw Error('invalid_credit_calculation');
 return {month,readAt:d.read_at,catalogSnapshotAt:d.catalog_snapshot_at,documents,lineCount:flat.length,estimatedLines:estimated.length,sourceRechecked:true};
}
export function filterMonthlyCredits(data,{company='all',query=''}={}){
 if(!['all','GTA','TR'].includes(company))throw Error('invalid_filter');
 const q=query.trim().toLocaleLowerCase('fr-FR');
 return data.documents.filter(d=>(company==='all'||d.company===company)&&(!q||[d.reference,d.client,
  ...d.lines.map(l=>l.product+' '+l.sku+' '+(l.original?.reference||''))].join(' ').toLocaleLowerCase('fr-FR').includes(q)));
}
export function proposedBalanceWithCredits(confirmed,recorded,credits,{month,company='all',query='',sourceFresh=false,pipelineReadAt=null,catalogSnapshotAt=null,now=Date.now()}={}){
 const unavailable=reason=>({available:false,reason});
 if(!confirmed||!recorded||!credits||recorded.month!==month||credits.month!==month||!['all','GTA','TR'].includes(company))return unavailable('source_unavailable');
 const recent=t=>{const stamp=Date.parse(t);return Number.isFinite(stamp)&&stamp<=now+300000&&now-stamp<=900000};
 if(!sourceFresh||!recent(recorded.readAt)||!recent(credits.readAt)||!recent(pipelineReadAt))return unavailable('source_not_rechecked');
 if(query.trim())return unavailable('search_scope');
 if(!catalogSnapshotAt||catalogSnapshotAt!==credits.catalogSnapshotAt)return unavailable('catalog_snapshot_mismatch');
 const grossCents=confirmed.count===0?0:cents(confirmed.forecast);if(grossCents===null)return unavailable('gross_unavailable');
 const recordedRows=recorded.deductions.filter(r=>company==='all'||r.company===company);
 const registeredOrders=new Set(recordedRows.map(r=>r.company+'|'+r.reference));
 let registeredCents=0,candidateCents=0,skippedCandidates=0,unresolvedLines=0;
 for(const r of recordedRows){registeredCents+=r.commission_cents;if(!Number.isSafeInteger(registeredCents))throw Error('invalid_credit_total')}
 for(const d of credits.documents.filter(d=>company==='all'||d.company===company))for(const l of d.lines){
  if(d.state!=='posted'||l.reason==='not_product_line'||l.reason==='not_eligible')continue;
  if(l.deduction_estimate_cents===null){unresolvedLines++;continue}
  if(registeredOrders.has(d.company+'|'+l.original.reference)){skippedCandidates++;continue}
  candidateCents+=l.deduction_estimate_cents;if(!Number.isSafeInteger(candidateCents))throw Error('invalid_credit_total');
 }
 const netCents=grossCents-registeredCents-candidateCents;if(!Number.isSafeInteger(netCents))throw Error('invalid_credit_total');
 return {available:true,grossCents,registeredCents,candidateCents,netCents,skippedCandidates,unresolvedLines,
  partial:true,complete:false,basePartial:confirmed.unavailableCount>0||confirmed.partialCount>0};
}
