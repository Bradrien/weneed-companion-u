import {assertUnchangedRows} from '../odoo-commission-pipeline/core.mjs';
import {reconcileKinoUnit} from '../odoo-commission-pipeline/unit-basis.mjs';
import {calculateKinoLine} from '../odoo-commission-pipeline/calculation.mjs';
import {compareProductNames,compatibleListingSku,resolveCatalogProduct} from '../odoo-commission-pipeline/product-match.mjs';
export const CREDIT_LIMITS=Object.freeze({documents:40,invoiceLines:400,saleLines:400,orders:200,products:400});
export const CREDIT_FIELDS=Object.freeze(['id','name','move_type','state','invoice_date','invoice_user_id','company_id','partner_id',
 'currency_id','amount_untaxed','amount_total','reversed_entry_id','invoice_line_ids','invoice_origin','ref','narration','write_date']);
export const CREDIT_LINE_FIELDS=Object.freeze(['id','move_id','product_id','name','quantity','price_unit','discount','price_subtotal','display_type','sale_line_ids','write_date']);
export const SALE_LINE_FIELDS=Object.freeze(['id','order_id','product_id','name','product_uom_qty','price_unit','discount','price_subtotal','display_type','write_date']);
export const SALE_FIELDS=Object.freeze(['id','name','state','date_order','user_id','company_id','partner_id','partner_invoice_id','currency_id','write_date']);
const COMPANY={'Global Trust Agriculture SA':'GTA','Trim Rocket s.r.o.':'TR'};
const text=x=>typeof x==='string'?x:'';
const num=x=>typeof x==='number'&&Number.isFinite(x)?x:null;
const id=x=>Array.isArray(x)&&Number.isSafeInteger(x[0])&&x[0]>0?x[0]:null;
const name=x=>Array.isArray(x)&&typeof x[1]==='string'?x[1]:'';
const positive=x=>num(x)!==null&&x>0;
const ids=value=>{
 if(!Array.isArray(value)||value.some(x=>!Number.isSafeInteger(x)||x<1)||new Set(value).size!==value.length)
  throw Error('odoo_invalid_response');
 return value;
};
const date=value=>{
 const d=text(value);if(!/^\d{4}-\d{2}-\d{2}$/.test(d)||!Number.isFinite(Date.parse(d+'T00:00:00Z'))||
  new Date(d+'T00:00:00Z').toISOString().slice(0,10)!==d)throw Error('odoo_invalid_response');return d;
};
const productLine=row=>!row.display_type||row.display_type==='product';
const close=(a,b)=>num(a)!==null&&num(b)!==null&&Math.abs(a-b)<=0.04;
export function explicitInvoiceReference(value){
 const match=text(value).trim().match(/^Ref\.?\s+invoice\s+([A-Za-z0-9][A-Za-z0-9/_-]{1,119})$/i);
 return match?match[1]:null;
}
function bounded(rows,max){
 if(!Array.isArray(rows)||rows.length>max)throw Error('credit_scope_limit');
 assertUnchangedRows(rows,rows,['id'],'odoo_invalid_response');return rows;
}
export function parseCreditMonth(url){
 const p=new URL(url).searchParams,month=p.get('month');
 if(p.size!==1||p.getAll('month').length!==1||!/^20\d{2}-(0[1-9]|1[0-2])$/.test(month||''))throw Error('invalid_month');
 const [y,m]=month.split('-').map(Number);return {month,from:month+'-01',to:new Date(Date.UTC(y,m,0)).toISOString().slice(0,10)};
}
export async function readMonthlyCredits(period,{uid,read,catalog,catalogSnapshotAt,catalogAvailable,duplicates,
 invoiceUnitField=null,saleUnitField=null,now=()=>new Date()}){
 if(!Number.isSafeInteger(uid)||uid<1||!period||!/^20\d{2}-(0[1-9]|1[0-2])$/.test(period.month))throw Error('invalid_month');
 const expected=parseCreditMonth('https://source.invalid/?month='+period.month);
 if(period.from!==expected.from||period.to!==expected.to)throw Error('invalid_month');
 for(const field of [invoiceUnitField,saleUnitField])if(field!==null&&!['product_uom','product_uom_id'].includes(field))throw Error('odoo_schema_unavailable');
 const companyRows=bounded(await read('res.company',[['name','in',Object.keys(COMPANY)]],['id','name'],3),2);
 const companies=new Map(companyRows.map(r=>[r.id,COMPANY[r.name]]));
 if(!companies.size||companyRows.some(r=>!companies.get(r.id))||new Set(companies.values()).size!==companyRows.length)
  throw Error('credit_scope_mismatch');
 const companyIds=[...companies.keys()];
 const creditDomain=[['move_type','=','out_refund'],['invoice_user_id','=',uid],['company_id','in',companyIds],
  ['invoice_date','>=',period.from],['invoice_date','<=',period.to]];
 const documents=bounded(await read('account.move',creditDomain,CREDIT_FIELDS,41),40);
 for(const d of documents){
  if(d.move_type!=='out_refund'||id(d.invoice_user_id)!==uid||!companies.has(id(d.company_id))||
   !['draft','posted','cancel'].includes(d.state)||date(d.invoice_date).slice(0,7)!==period.month||
   !id(d.partner_id)||!/^[A-Z]{3}$/.test(name(d.currency_id)))throw Error('credit_scope_mismatch');
  ids(d.invoice_line_ids);
 }
 const documentIds=documents.map(d=>d.id),lineIds=[...new Set(documents.flatMap(d=>d.invoice_line_ids))];
 if(lineIds.length>400)throw Error('credit_scope_limit');
 const lf=[...CREDIT_LINE_FIELDS,...(invoiceUnitField?[invoiceUnitField]:[])];
 const lineDomain=[['id','in',lineIds],['move_id','in',documentIds]];
 const lines=lineIds.length?bounded(await read('account.move.line',lineDomain,lf,401),400):[];
 if(lines.length!==lineIds.length||lines.some(l=>!lineIds.includes(l.id)||!documentIds.includes(id(l.move_id))||
  !documents.find(d=>d.id===id(l.move_id)).invoice_line_ids.includes(l.id)))throw Error('credit_scope_mismatch');
 for(const l of lines)ids(l.sale_line_ids);
 const reversalIds=[...new Set(documents.map(d=>id(d.reversed_entry_id)).filter(Boolean))];
 const noteRefs=new Map(documents.map(d=>[d.id,[...new Set([
  ...lines.filter(l=>id(l.move_id)===d.id&&!productLine(l)).map(l=>explicitInvoiceReference(l.name)),
  explicitInvoiceReference(d.ref),explicitInvoiceReference(d.invoice_origin),
  explicitInvoiceReference(text(d.narration).replace(/<[^>]*>/g,' '))].filter(Boolean))]]));
 const invoiceRefs=[...new Set([...noteRefs.values()].filter(a=>a.length===1).flat())];
 const invoiceDomain=[...(invoiceRefs.length?['|',['id','in',reversalIds],['name','in',invoiceRefs]]:[['id','in',reversalIds]]),
  ['move_type','=','out_invoice'],['invoice_user_id','=',uid],['company_id','in',companyIds]];
 const originals=reversalIds.length||invoiceRefs.length?bounded(await read('account.move',invoiceDomain,CREDIT_FIELDS,41),40):[];
 if(originals.some(d=>(!reversalIds.includes(d.id)&&!invoiceRefs.includes(d.name))||d.move_type!=='out_invoice'||id(d.invoice_user_id)!==uid||
  !companies.has(id(d.company_id))))throw Error('credit_scope_mismatch');
 const parents=new Map(documents.map(d=>{
  const native=originals.find(p=>p.id===id(d.reversed_entry_id)),refs=noteRefs.get(d.id);
  if(native)return [d.id,refs.length&&refs.some(r=>r!==native.name)?{reason:'conflicting_original_invoice_reference'}:
   {parent:native,kind:'native_reversal'}];
  if(id(d.reversed_entry_id))return [d.id,{reason:'original_invoice_reference_not_accessible'}];
  if(refs.length>1)return [d.id,{reason:'multiple_original_invoice_references'}];
  const candidates=refs.length===1?originals.filter(p=>p.name===refs[0]&&id(p.company_id)===id(d.company_id)&&
   id(p.partner_id)===id(d.partner_id)&&name(p.currency_id)===name(d.currency_id)):[];
  if(candidates.length===1)return [d.id,{parent:candidates[0],kind:'explicit_invoice_note_reference'}];
  return [d.id,{reason:candidates.length?'ambiguous_original_invoice_reference':
   refs.length?'original_invoice_reference_not_accessible':'missing_original_invoice_link'}];
 }));
 const originalLineIds=[...new Set(originals.flatMap(d=>ids(d.invoice_line_ids)))];
 if(originalLineIds.length>400)throw Error('credit_scope_limit');
 const originalLineDomain=[['id','in',originalLineIds],['move_id','in',originals.map(d=>d.id)]];
 const originalLines=originalLineIds.length?bounded(await read('account.move.line',originalLineDomain,lf,401),400):[];
 if(originalLines.length!==originalLineIds.length||originalLines.some(l=>!originalLineIds.includes(l.id)||
  !originals.find(d=>d.id===id(l.move_id))?.invoice_line_ids.includes(l.id)))throw Error('credit_scope_mismatch');
 for(const l of originalLines)ids(l.sale_line_ids);
 const links=new Map();
 for(const l of lines){
  if(!productLine(l)){links.set(l.id,{reason:'not_product_line'});continue}
  const d=documents.find(d=>d.id===id(l.move_id)),parentInfo=parents.get(d.id);
  if(['conflicting_original_invoice_reference','multiple_original_invoice_references','ambiguous_original_invoice_reference'].includes(parentInfo.reason)){
   links.set(l.id,{reason:parentInfo.reason});continue;
  }
  const direct=l.sale_line_ids;
  if(direct.length===1){links.set(l.id,{saleLineId:direct[0],kind:'direct_sale_line'});continue}
  if(direct.length>1){links.set(l.id,{reason:'multiple_sale_lines'});continue}
  const parent=parentInfo.parent;
  if(!parent){links.set(l.id,{reason:parentInfo.reason});continue}
  if(parent.state!=='posted'||id(parent.company_id)!==id(d.company_id)||id(parent.partner_id)!==id(d.partner_id)||name(parent.currency_id)!==name(d.currency_id)){
   links.set(l.id,{reason:'original_invoice_scope_mismatch'});continue;
  }
  const sameProduct=originalLines.filter(o=>id(o.move_id)===parent.id&&productLine(o)&&id(o.product_id)!==null&&
   id(o.product_id)===id(l.product_id)&&invoiceUnitField&&id(o[invoiceUnitField])===id(l[invoiceUnitField]));
  const priceMatches=sameProduct.filter(o=>close(o.price_unit,l.price_unit)&&close(o.discount,l.discount));
  const listingCandidates=!sameProduct.length?originalLines.filter(o=>id(o.move_id)===parent.id&&productLine(o)&&
   id(o.product_id)!==null&&invoiceUnitField&&id(o[invoiceUnitField])===id(l[invoiceUnitField])&&
   compareProductNames(text(l.name),text(o.name))&&positive(l.quantity)&&positive(o.quantity)&&
   positive(l.price_subtotal)&&positive(o.price_subtotal)&&close(l.price_subtotal/l.quantity,o.price_subtotal/o.quantity)):[];
  const candidates=priceMatches.length?priceMatches:sameProduct.length===1?sameProduct:listingCandidates;
  if(candidates.length!==1){links.set(l.id,{reason:candidates.length||sameProduct.length>1?'ambiguous_original_invoice_lines':'missing_original_invoice_line'});continue}
  if(candidates[0].sale_line_ids.length!==1){links.set(l.id,{reason:'multiple_sale_lines'});continue}
  links.set(l.id,{saleLineId:candidates[0].sale_line_ids[0],kind:parentInfo.kind==='native_reversal'?
   'unique_reversed_invoice_line':'explicit_invoice_note_unique_line',invoiceLineId:candidates[0].id,
   listingIdentity:!sameProduct.length&&listingCandidates.length===1});
 }
 const saleIds=[...new Set([...links.values()].map(x=>x.saleLineId).filter(Boolean))];
 if(saleIds.length>400)throw Error('credit_scope_limit');
 const sf=[...SALE_LINE_FIELDS,...(saleUnitField?[saleUnitField]:[])];
 const saleDomain=[['id','in',saleIds],['order_id.user_id','=',uid]];
 const saleLines=saleIds.length?bounded(await read('sale.order.line',saleDomain,sf,401),400):[];
 if(saleLines.some(l=>!saleIds.includes(l.id)||!id(l.order_id)))throw Error('credit_scope_mismatch');
 const orderIds=[...new Set(saleLines.map(l=>id(l.order_id)))];
 if(orderIds.length>200)throw Error('credit_scope_limit');
 const orderDomain=[['id','in',orderIds],['user_id','=',uid]];
 const orders=orderIds.length?bounded(await read('sale.order',orderDomain,SALE_FIELDS,201),200):[];
 if(orders.length!==orderIds.length||orders.some(o=>!orderIds.includes(o.id)||id(o.user_id)!==uid||!companies.has(id(o.company_id))))throw Error('credit_scope_mismatch');
 const pids=[...new Set([...lines,...saleLines,...originalLines].map(l=>id(l.product_id)).filter(Boolean))];
 if(pids.length>400)throw Error('credit_scope_limit');
 const productDomain=[['id','in',pids]],pf=['id','name','default_code'];
 const products=pids.length?bounded(await read('product.product',productDomain,pf,401),400):[];
 if(products.some(p=>!pids.includes(p.id)))throw Error('credit_scope_mismatch');
 const productMap=new Map(products.map(p=>[p.id,p])),returned=new Map();
 for(const l of lines){const link=links.get(l.id),d=documents.find(d=>d.id===id(l.move_id));
  if(d.state==='posted'&&link.saleLineId&&positive(l.quantity))returned.set(link.saleLineId,(returned.get(link.saleLineId)||0)+l.quantity);
 }
 const output=documents.map(d=>{
  const company=companies.get(id(d.company_id)),currency=name(d.currency_id);
  const productAmounts=lines.filter(l=>id(l.move_id)===d.id&&productLine(l)).map(l=>num(l.price_subtotal));
  const documentIssues=[];
  if(num(d.amount_untaxed)===null||productAmounts.some(x=>x===null))documentIssues.push('credit_amount_unverified');
  else if(!close(productAmounts.reduce((a,b)=>a+b,0),d.amount_untaxed))documentIssues.push('credit_line_total_mismatch');
  const dl=lines.filter(l=>id(l.move_id)===d.id).map(l=>{
   const link=links.get(l.id),source=saleLines.find(s=>s.id===link.saleLineId),order=source&&orders.find(o=>o.id===id(source.order_id));
   let reason=link.reason||null,calculation=null,deduction=null,unit=null;
   const product=productMap.get(id(l.product_id)),sku=text(product?.default_code).trim().toUpperCase(),
    sourceProduct=source&&productMap.get(id(source.product_id));
   const sourceSku=text(sourceProduct?.default_code).trim().toUpperCase(),sourceName=text(sourceProduct?.name)||text(source?.name),
    sourceReference=sourceSku||sourceName.match(/^\s*\[([A-Za-z0-9_+./ -]{2,100})\]/)?.[1]||'';
   const matchedInvoiceLine=originalLines.find(o=>o.id===link.invoiceLineId);
   const listingQuality=link.listingIdentity&&compareProductNames(text(product?.name)||text(l.name),sourceName);
   const identityAllowed=!!listingQuality&&id(matchedInvoiceLine?.product_id)===id(source?.product_id)&&
    (!sku||!sourceReference||compatibleListingSku(sku,sourceReference))&&
    !!compareProductNames(text(matchedInvoiceLine?.name),sourceName);
   const listingIdentity=identityAllowed?{method:listingQuality,unique_invoice_line:true,
    source_product_id:id(source.product_id),source_product:sourceName.slice(0,300),source_sku:sourceSku,
    invoice_line_id:link.invoiceLineId}:null;
   const qty=num(l.quantity),subtotal=num(l.price_subtotal),price=num(l.price_unit),discount=num(l.discount);
   if(!reason&&documentIssues.length)reason=documentIssues[0];
   if(!reason&&d.state!=='posted')reason='credit_not_posted';
   if(!reason&&currency!=='EUR')reason='not_eur';
   if(!reason&&(!source||!order))reason='original_sale_not_accessible';
   if(!reason&&(!product||!sourceProduct))reason='product_identity_mismatch';
   if(!reason&&(!['sale','done'].includes(order.state)||id(order.company_id)!==id(d.company_id)||name(order.currency_id)!==currency||
    ![id(order.partner_id),id(order.partner_invoice_id)].includes(id(d.partner_id))))reason='original_sale_scope_mismatch';
   if(!reason&&(!id(l.product_id)||id(l.product_id)!==id(source.product_id))&&!identityAllowed)reason='product_identity_mismatch';
   if(!reason&&(!invoiceUnitField||!saleUnitField||!id(l[invoiceUnitField])||id(l[invoiceUnitField])!==id(source[saleUnitField])))reason='unit_identity_unverified';
   if(!reason&&(!positive(qty)||!positive(subtotal)||!positive(source.product_uom_qty)||!positive(source.price_subtotal)||
    num(discount)===null||discount<0||discount>100||!positive(price)||!positive(source.price_unit)||
    num(source.discount)===null||source.discount<0||source.discount>100))reason='invalid_refund_amount';
   if(!reason&&(qty>source.product_uom_qty+0.000001||(returned.get(source.id)||0)>source.product_uom_qty+0.000001))reason='return_quantity_exceeds_sale';
   if(!reason&&(!close(qty*price*(1-discount/100),subtotal)||
    !close(source.product_uom_qty*source.price_unit*(1-source.discount/100),source.price_subtotal)||
    !close(subtotal,qty*(source.price_subtotal/source.product_uom_qty))))reason='refund_price_mismatch';
   if(!reason&&/(?:^|[^\p{L}\p{N}_])(?:samples?|échantillons?|delivery|shipping|livraison|transport|freight|port)(?=$|[^\p{L}\p{N}_])/iu.test((text(product?.name)||text(l.name).split('\n')[0])+' '+sku))reason='not_eligible';
   const resolved=resolveCatalogProduct({company,sku:sourceSku,product:sourceName||text(product?.name)||text(l.name),
    catalog:catalog||new Map(),duplicates,catalogAvailable}),row=resolved.row;
   if(!reason&&!row)reason=resolved.reason;
   if(!reason&&(!positive(row.cost_eur)||!positive(row.list_price_eur)||!['A','B'].includes(row.tier)))reason='invalid_kino_cost_or_tier';
   if(!reason){
    unit=reconcileKinoUnit({sku:resolved.match?.catalog_sku||sourceSku||sku,productName:row.product_name,cost:row.cost_eur,listedPrice:row.list_price_eur,odooUnitPrice:source.price_unit});
    if(!unit.ok)reason='unverified_unit_scale';
    else try{
     calculation=calculateKinoLine({tier:row.tier,cost:unit.costPerOdooUnit,quantity:source.product_uom_qty,subtotalHT:source.price_subtotal});
     const originalCents=Math.round(calculation.commission*100),estimateCents=Math.round(originalCents*qty/source.product_uom_qty);
     if(!Number.isSafeInteger(estimateCents)||estimateCents<0)throw Error('invalid_calculation');deduction=estimateCents;
    }catch{reason='invalid_calculation';calculation=null;unit=null}
   }
   const original=order?{order_id:order.id,reference:text(order.name).slice(0,120),date:text(order.date_order).slice(0,10),
    state:order.state,line_id:source.id,quantity:num(source.product_uom_qty),subtotal_ht:num(source.price_subtotal),
    price_unit:num(source.price_unit),discount_pct:num(source.discount),unit_id:saleUnitField?id(source[saleUnitField]):null,
    product_id:id(source.product_id),product:sourceName.slice(0,300),sku:sourceSku}:null;
   return {id:l.id,product_id:id(l.product_id),product:text(product?.name)||text(l.name).slice(0,180),sku,
    quantity:qty,subtotal_ht:subtotal,price_unit:price,discount_pct:discount,
    unit_id:invoiceUnitField?id(l[invoiceUnitField]):null,unit:invoiceUnitField?name(l[invoiceUnitField]):'',
    link_kind:original?link.kind||null:null,original_invoice_line_id:original?link.invoiceLineId||null:null,
    original,reason,listing_identity:listingIdentity,listing_match:resolved.match,unit_basis:unit?.ok?unit.basis:null,pack_size_g:unit?.ok?unit.packSizeG:null,
    effective_unit_cost_eur:unit?.ok?unit.costPerOdooUnit:null,kino_tier:!reason?row.tier:null,
    original_calculation:calculation,deduction_estimate_cents:deduction};
  });
  const parentInfo=parents.get(d.id),parent=parentInfo.parent;
  return {id:d.id,reference:text(d.name).slice(0,120),date:date(d.invoice_date),state:d.state,company,currency,
   explicit_invoice_references:noteRefs.get(d.id),original_invoice:parent?{id:parent.id,reference:text(parent.name).slice(0,120),link_kind:parentInfo.kind,
    date:date(parent.invoice_date),currency:name(parent.currency_id),amount_ht:num(parent.amount_untaxed),
    lines:originalLines.filter(l=>id(l.move_id)===parent.id&&productLine(l)).map(l=>({id:l.id,product_id:id(l.product_id),
     product:text(productMap.get(id(l.product_id))?.name)||text(l.name).slice(0,180),sku:text(productMap.get(id(l.product_id))?.default_code).trim(),
     quantity:num(l.quantity),price_unit:num(l.price_unit),discount_pct:num(l.discount),subtotal_ht:num(l.price_subtotal),
     unit_id:invoiceUnitField?id(l[invoiceUnitField]):null,unit:invoiceUnitField?name(l[invoiceUnitField]):'',sale_link_count:l.sale_line_ids.length}))}:null,
   client:name(d.partner_id).slice(0,180),origin_reference:text(d.invoice_origin).slice(0,500),external_reference:text(d.ref).slice(0,500),
   note:text(d.narration).replace(/<[^>]*>/g,' ').slice(0,2000),amount_ht:num(d.amount_untaxed),amount_total:num(d.amount_total),reversed_invoice_id:id(d.reversed_entry_id),issues:documentIssues,lines:dl};
 });
 // Recheck every exact source, then repeat the monthly domain to detect additions/removals.
 if(products.length)assertUnchangedRows(products,await read('product.product',productDomain,pf,401),pf);
 if(orderIds.length)assertUnchangedRows(orders,await read('sale.order',orderDomain,SALE_FIELDS,201),SALE_FIELDS);
 if(saleIds.length)assertUnchangedRows(saleLines,await read('sale.order.line',saleDomain,sf,401),sf);
 if(originalLineIds.length)assertUnchangedRows(originalLines,await read('account.move.line',originalLineDomain,lf,401),lf);
 if(reversalIds.length||invoiceRefs.length)assertUnchangedRows(originals,await read('account.move',invoiceDomain,CREDIT_FIELDS,41),CREDIT_FIELDS);
 if(lineIds.length)assertUnchangedRows(lines,await read('account.move.line',lineDomain,lf,401),lf);
 assertUnchangedRows(documents,await read('account.move',creditDomain,CREDIT_FIELDS,41),CREDIT_FIELDS);
 assertUnchangedRows(companyRows,await read('res.company',[['name','in',Object.keys(COMPANY)]],['id','name'],3),['id','name']);
 return {version:'odoo_monthly_credits_v1',month:period.month,read_at:now().toISOString(),source_rechecked:true,
  scope:'seller_attributed_credit_notes_invoice_date_read_only_rechecked',read_consistency:'two_read_windows_not_atomic_snapshot',
  catalog_snapshot_at:catalogSnapshotAt||null,calculation_version:'original_line_commission_prorata_return_quantity_v1',
  automatic_deduction:false,spiff_enabled:false,historical_costs_verified:false,
  documents:output,document_count:output.length,line_count:lines.length,
  estimated_lines:output.flatMap(d=>d.lines).filter(l=>l.deduction_estimate_cents!==null).length};
}
