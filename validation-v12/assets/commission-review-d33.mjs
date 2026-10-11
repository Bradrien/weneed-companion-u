/** Read-only review worklist. Never amend source identities, exclusions or estimates. */
import {selectedCommissionOrders,csvCell} from './commission-audit-d31.mjs?v=review-1';
import {odooRecordUrl} from './odoo-links-d33.mjs';
export {odooRecordUrl} from './odoo-links-d33.mjs';
const actions=Object.freeze({
 missing_odoo_sku:['Référence interne Odoo','Comparer le produit et sa société à la référence interne Odoo. Le code candidat reste un indice ; il ne remplace pas le SKU source.'],
 missing_kino_match:['Correspondance catalogue','Contrôler le SKU et la société dans le catalogue Kino. Une correspondance de nom seule ne suffit pas.'],
 ambiguous_sku:['Entrée catalogue ambiguë','Identifier l’entrée Kino applicable au SKU et à la société ; plusieurs correspondances empêchent le calcul.'],
 catalog_unavailable:['Catalogue indisponible','Actualiser la lecture du catalogue Kino avant de rapprocher cette ligne.'],
 invalid_kino_tier:['Palier Kino','Confirmer le palier A ou B applicable dans la source Kino.'],
 missing_kino_cost:['Coût Kino absent ou nul','Obtenir un coût strictement positif, son unité et sa date de validité auprès de la source Kino. Aucun coût de remplacement n’est supposé.'],
 unverified_unit_scale:['Unité commerciale','Comparer l’unité et la quantité Odoo au sachet ou au gramme Kino. Confirmer la conversion avant tout calcul.'],
 missing_kino_price:['Tarif de référence Kino','Contrôler le tarif de référence et son unité dans Kino pour établir la conversion commerciale.'],
 invalid_quantity:['Quantité Odoo','Contrôler la quantité source et le traitement métier d’un éventuel retour ou ajustement.'],
 invalid_calculation:['Calcul incohérent','Comparer les entrées de calcul à la ligne Odoo et au catalogue Kino avant une nouvelle simulation.'],
 invalid_amount:['Prix ou montant source','Contrôler prix, quantité, remise et montant HT de la ligne Odoo.'],
 line_price_mismatch:['Prix, remise et total HT','Comparer le montant HT de la ligne au prix après remise multiplié par la quantité Odoo.'],
 incomplete_source_amount:['Montants incomplets','Vérifier les montants HT de la commande et de toutes ses lignes dans Odoo.'],
 lines_total_mismatch:['Somme des lignes HT','Comparer le total HT de la commande aux sous-totaux de toutes les lignes Odoo.'],
 signed_adjustment:['Retour ou ajustement signé','Contrôler les lignes négatives et les avoirs liés dans Odoo ; leur traitement dans les commissions reste à confirmer.'],
 forecast_total_mismatch:['Total simulé incohérent','Comparer l’estimation de la commande à la somme des estimations arrondies par ligne.'],
 invalid_line_inputs:['Prix ou remise incohérent','Contrôler les prix et remises source avant de relancer la lecture Odoo.'],
 not_eur:['Devise de la commande','Contrôler la devise et la règle de conversion applicable. Les montants en devises différentes ne sont pas additionnés.'],
 not_eligible:['Exclusion métier à confirmer','Vérifier si cette ligne doit être exclue selon les règles de rémunération. Le filtre du scénario ne constitue pas une validation contractuelle.']
});
export function reviewAction(reason){
 const [label,instruction]=Object.hasOwn(actions,reason)?actions[reason]:
  ['Diagnostic à vérifier','Contrôler la ligne et ses données dans les sources avant de relancer la simulation.'];
 return {label,instruction};
}
export function reviewPointsForOrders(orders){
 const points=[],affected=new Set(),lineIds=new Set();
 let unestimatedLines=0,monetaryExclusions=0,blockedOrders=0;
 for(const order of orders){
  if(order.issues.length)blockedOrders++;
  const add=(scope,reason,line=null)=>{
   affected.add(order.id);if(line)lineIds.add(line.id);
   points.push({scope,reason,action:reviewAction(reason),order,line,
    orderUrl:odooRecordUrl('sale.order',order.id)});
  };
  for(const reason of order.issues)add('order',reason);
  for(const line of order.lines){
   if(line.reason==='not_eligible'){
    if(line.subtotalHT!==0){monetaryExclusions++;add('line_exclusion',line.reason,line)}
   }else if(line.commissionEstimate===null){unestimatedLines++;add('line_unestimated',line.reason,line)}
  }
 }
 const selected=orders.filter(o=>affected.has(o.id));
 return {points,ordersCount:affected.size,lineCount:lineIds.size,unestimatedLines,monetaryExclusions,blockedOrders,
  pendingOrders:selected.filter(o=>o.stage==='en_cours').length,
  confirmedOrders:selected.filter(o=>o.stage!=='en_cours').length,payable:false};
}
export function buildCommissionReview(data,options){
 return reviewPointsForOrders(selectedCommissionOrders(data,options));
}
export const REVIEW_CSV_COLUMNS=Object.freeze(['mois','societe','commande_odoo','id_commande','client',
 'date_odoo','categorie_odoo','etat_odoo','facturation_odoo','portee_point','diagnostic','controle',
 'action_a_verifier','id_ligne','produit','sku_officiel_odoo','code_candidat','statut_candidat',
 'quantite_odoo','unite_odoo','devise','ht_commande','ht_ligne','cout_brut_catalogue','tarif_brut_catalogue',
 'palier_catalogue','lien_commande_odoo','capture_catalogue','lecture_odoo','source_reverifiee',
 'montants_a_additionner','commission_payable']);
export function createReviewCsv(data,options){
 if(!data?.sourceInputsRechecked)throw Error('review_requires_rechecked_source');
 const review=buildCommissionReview(data,options),rows=[REVIEW_CSV_COLUMNS];
 for(const point of review.points){
  const o=point.order,l=point.line,e=l?.catalogEvidence;
  rows.push([options.month,o.company,o.reference,o.id,o.client,o.date,
   o.stage==='en_cours'?'devis_non_confirme':'commande_confirmee',o.state,o.invoiceStatus,
   point.scope,point.reason,point.action.label,point.action.instruction,l?.id,l?.product,l?.sku,
   e?.source==='product_label_prefix'?e.sku:null,e?.source==='product_label_prefix'?e.status:null,
   l?.quantity,l?.unit,o.currency,o.amountHT,l?.subtotalHT,l?.catalogCostEur??e?.costEur,
   l?.catalogPriceEur??e?.listPriceEur,l?.kinoTier??e?.tier,point.orderUrl,
   data.catalogSnapshotAt,data.readAt,'oui','non','non']);
 }
 return {filename:'points-a-verifier-'+options.month+'-'+(options.company||'all')+'.csv',
  content:'\uFEFF'+rows.map(row=>row.map(csvCell).join(';')).join('\r\n')+'\r\n',
  points:review.points.length,orders:review.ordersCount,lines:review.lineCount};
}
