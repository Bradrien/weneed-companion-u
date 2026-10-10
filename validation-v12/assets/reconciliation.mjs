/** Pure, read-only Kino reconciliation UI. No tokens, network access or payout calculations. */
import {formatMoney,shortDate} from './model.mjs';

export function catalogLineDetail(match){
 if(!match||match.status==='not_applicable')return '';
 if(match.status!=='matched'){
  return ({missing_sku:'SKU Odoo manquant',not_found:'Absent du catalogue Kino',
   ambiguous_sku:'Référence Kino ambiguë',catalog_invalid_price:'Prix catalogue incohérent'}
  )[match.status]||'Rapprochement à examiner';
 }
 const warnings=[match.cost_zero?'Coût à 0 € à contrôler':'',match.price_zero?'Prix catalogue à 0 € à contrôler':''].filter(Boolean);
 return `Kino ${match.tier} · Coût ${formatMoney(match.cost_eur,'EUR')} · Catalogue ${formatMoney(match.list_price_eur,'EUR')} / ${match.category}`+
  (warnings.length?' · '+warnings.join(', '):'')+
  ' · Aucun calcul de commission';
}
const make=(tag,cls,text)=>{
 const el=document.createElement(tag);
 if(cls)el.className=cls;
 if(text!==undefined)el.textContent=String(text);
 return el;
};
export function renderCatalogCommissions(report,el,{empty,warningInFrench,fmtNumber}){
 el.replaceChildren();
 if(!report){el.append(empty('Charge les commandes Odoo pour afficher le rapprochement.'));return}
 const m=report.catalog_matching,k=report.line_kinds||{};
 const rows=m?[
  ['Références retrouvées dans Kino',m.matched],
  ['Produits éligibles au rapprochement',m.eligible],
  ['SKU absents du catalogue',m.not_found],
  ['SKU manquants dans Odoo',m.missing_sku],
  ['Références ambiguës',m.ambiguous_sku],
  ['Coûts Kino à zéro (lignes rapprochées)',m.zero_cost],
  ['Prix catalogue à zéro (lignes rapprochées)',m.zero_list_price]
 ]:[['Rapprochement Kino','Indisponible']];
 rows.push(['Échantillons signalés (tous statuts)',k.sample||0],
  ['Lignes de livraison (tous statuts)',k.shipping||0],
  ['Lignes en anomalie (tous statuts)',k.anomaly||0]);
 for(const [label,value] of rows){
  const row=make('div','review-item');
  row.append(make('span','',label),make('strong','',typeof value==='number'?fmtNumber(value):value));
  el.append(row);
 }
 if(report.catalog_snapshot){
  el.append(make('div','catalog-reference',
   `Source : ${report.catalog_snapshot.products_total} produits Kino, capture du ${shortDate(report.catalog_snapshot.source_completed_at)}. Correspondance par société + SKU, sans calcul de marge ni de rémunération.`));
 }
 if(report.warnings?.length){
  el.append(make('div','disclaimer',report.warnings.filter(Boolean).map(warningInFrench).join(' · ')));
 }
}
