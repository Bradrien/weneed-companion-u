// Adapt a validated, current pipeline row without replacing missing amounts by zero.
const reasons={not_eligible:'Ligne hors estimation',missing_odoo_sku:'Référence produit à rapprocher',missing_kino_match:'Produit absent du catalogue',
 ambiguous_sku:'Plusieurs produits possibles',missing_kino_cost:'Coût manquant',missing_kino_price:'Tarif de référence manquant',
 unverified_unit_scale:'Unité de vente à vérifier',invalid_kino_tier:'Catégorie à vérifier',line_price_mismatch:'Prix et remise à vérifier',invalid_amount:'Montant à vérifier'};
export function presentPipelineOrder(o){
 const lineCents=o.lines.map(l=>l.subtotalHT===null?null:Math.round(l.subtotalHT*100));
 const total=lineCents.some(n=>n===null)?null:lineCents.reduce((a,b)=>a+b,0);
 return {native:true,needsReview:o.partial||o.issues.length>0||o.forecast===null,nativeSummary:o.forecast===null?null:{amount:o.forecast,simulatedLines:o.matchedLines,excludedLines:o.unmatchedLines},
  amount_difference:o.amountHT===null||total===null?null:(Math.round(o.amountHT*100)-total)/100,
  id:o.id,reference:o.reference,client:o.client,date:o.date,company:o.company,state:o.state,
  currency:o.currency,amount_ht:o.amountHT,salesperson:'Odoo',issues:o.issues,line_sum_ht:total===null?null:total/100,
  lines:o.lines.map(l=>({id:l.id,product_name:l.product,sku:l.sku,quantity:l.quantity,unit_price:l.unitPrice,
   discount_pct:l.discountPct,line_ht:l.subtotalHT,kind:l.reason==='not_eligible'?'review':'candidate',catalog_match:null,
   nativeListingMatch:l.listingMatch,nativeEstimate:l.commissionEstimate!==null&&!o.issues.length?
    {status:'simulated',commission:l.commissionEstimate,rate:l.calculation?.rate,costPerAssumedUnit:l.effectiveUnitCostEur,quantity:l.quantity}:
    {status:'excluded',reason:o.issues.length?'Les montants de cette commande sont à vérifier':reasons[l.reason]||'Information à vérifier'}}))};
}
