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


/**
 * Categorize only lines already contained in the read-only, owner-authenticated
 * Odoo/Kino report. A keyword-based classification is an audit flag, not a
 * definitive exclusion from commission.
 */
export function auditReconciliation(report){
 if(!report)return null;
 const missing=[],samples=[],shipping=[],zeroAmountOrders=[];
 for(const order of report.orders){
  const confirmed=['sale','done'].includes(order.state);
  if(confirmed&&order.amount_ht===0)zeroAmountOrders.push(order);
  for(const line of order.lines){
   const entry={order,line,confirmed};
   if(line.catalog_match?.status==='missing_sku')missing.push(entry);
   if(line.kind==='sample')samples.push(entry);
   if(line.kind==='shipping')shipping.push(entry);
  }
 }
 const confirmedSamples=samples.filter(x=>x.confirmed);
 const paidSamples=confirmedSamples.filter(x=>typeof x.line.line_ht==='number'&&x.line.line_ht>0);
 const confirmedShipping=shipping.filter(x=>x.confirmed);
 const paidShipping=confirmedShipping.filter(x=>typeof x.line.line_ht==='number'&&x.line.line_ht>0);
 return {missing,samples,confirmedSamples,paidSamples,shipping,confirmedShipping,paidShipping,zeroAmountOrders};
}


/**
 * A prefix inside the product description is only a candidate for a missing
 * Odoo internal reference. It is NOT an automatically verified Kino SKU.
 */
export function candidateSkuFromName(name){
 if(typeof name!=='string')return null;
 const hit=name.match(/^\s*\[([A-Za-z0-9_+./-]{2,40})\]/);
 return hit?hit[1].toUpperCase():null;
}

export function groupMissingSkuCandidates(report){
 const audit=auditReconciliation(report);
 if(!audit)return [];
 const groups=new Map();
 for(const entry of audit.missing){
  const candidate=candidateSkuFromName(entry.line.product_name);
  const currency=entry.order.currency||null;
  const key=JSON.stringify([entry.order.company,candidate,currency]);
  let g=groups.get(key);
  if(!g){
   g={company:entry.order.company,candidate,currency,count:0,total:0,amountComplete:true,entries:[],catalogFound:0,catalogNames:new Set()};
   groups.set(key,g);
  }
  g.count++;
  g.entries.push(entry);
  const proposed=entry.line.catalog_match?.candidate;
  if(candidate&&proposed?.status==='found'&&proposed.sku===candidate){
   g.catalogFound++;
   if(proposed.catalog_name)g.catalogNames.add(proposed.catalog_name);
  }
  if(typeof entry.line.line_ht==='number'&&Number.isFinite(entry.line.line_ht))g.total+=entry.line.line_ht;
  else g.amountComplete=false;
 }
 return [...groups.values()].map(g=>({...g,catalogNames:[...g.catalogNames]}))
  .sort((a,b)=>b.count-a.count || a.company.localeCompare(b.company) ||
  (a.candidate||'').localeCompare(b.candidate||''));
}

export function renderReconciliationAudit(report,el,{empty,fmtNumber,onOpenOrder}){
 el.replaceChildren();
 const audit=auditReconciliation(report);
 if(!audit){el.append(empty('Charge le rapport de la période pour examiner les lignes non rapprochées.'));return}
 const makeTitle=(title,detail)=>{
  const header=make('div','audit-heading');
  header.append(make('h3','',title),make('p','audit-hint',detail));el.append(header);
 };
 const showEntries=(entries,cap=12)=>{
  for(const {order,line} of entries.slice(0,cap)){
   const card=make('div','audit-line');
   const head=make('div','audit-line-head');
   head.append(make('strong','',order.reference||'Commande sans référence'),
     make('span','',order.company+' · '+shortDate(order.date)));
   card.append(head,
     make('div','audit-product',line.product_name||'Produit non renseigné'),
     make('div','audit-note',
       (order.client||'Client non renseigné')+' · '+formatMoney(line.line_ht,order.currency||'EUR')));
   if(line.catalog_match?.status==='missing_sku'&&
       line.catalog_match?.candidate?.status==='found'){
    card.append(make('div','audit-verified','Code présent dans Kino, mais absent du champ SKU de la fiche Odoo.'));
   }
   if(typeof onOpenOrder==='function'){
    const open=make('button','audit-order-link','Ouvrir la commande');
    open.type='button';
    open.setAttribute('aria-label','Ouvrir '+(order.reference||'la commande')+' dans Commandes');
    open.addEventListener('click',()=>onOpenOrder(order));
    card.append(open);
   }
   el.append(card);
  }
  if(entries.length>cap)el.append(make('p','audit-hint',
    'Affichage des '+cap+' premières lignes sur '+entries.length+'.'));
 };
 makeTitle('Références internes Odoo manquantes — '+fmtNumber(audit.missing.length)+' ligne(s)',
  'Lignes éligibles dont la fiche produit Odoo ne fournit aucun SKU. Vérifier les références internes avant de rapprocher les commissions.');
 if(audit.missing.length){
  const candidates=groupMissingSkuCandidates(report);
  const candidateCount=new Set(candidates.filter(g=>g.candidate).map(g=>g.company+'|'+g.candidate)).size;
  const confirmedCount=candidates.filter(g=>g.candidate&&g.catalogFound===g.count).length;
  el.append(make('p','audit-hint',candidateCount+' code(s) candidat(s) extraits des descriptions. '+
   confirmedCount+' groupe(s) retrouvé(s) exactement dans le catalogue Kino. Les références internes Odoo restent à compléter ; le compteur officiel de rapprochement ne change pas.'));
  for(const group of candidates){
   const box=make('div','audit-candidate');
   const code=group.candidate?'['+group.candidate+']':'Code non identifié dans la description';
   box.append(make('strong','',group.company+' · '+code),
     make('div','audit-note',fmtNumber(group.count)+' ligne(s) · '+
       (group.amountComplete&&group.currency?formatMoney(group.total,group.currency):'Montant HT non totalisable')));
   const allFound=group.candidate&&group.catalogFound===group.count;
   box.append(make('div',allFound?'audit-verified':'audit-note',
    allFound?'Référence exacte trouvée dans Kino · Proposition à valider dans Odoo':
    'Correspondance Kino non confirmée pour '+(group.count-group.catalogFound)+' ligne(s)'));
   el.append(box);
  }
  showEntries(audit.missing,20);
 } else el.append(make('p','audit-ok','Aucune ligne éligible sans SKU sur cette période.'));
 makeTitle('Échantillons : classement automatique à confirmer',
  fmtNumber(audit.samples.length)+' lignes signalées, dont '+fmtNumber(audit.confirmedSamples.length)+
  ' dans des commandes confirmées et '+fmtNumber(audit.paidSamples.length)+
  ' avec un montant HT positif. Classement par mot-clé « sample » ou « échantillon », pas par une règle Kino validée.');
 if(audit.paidSamples.length){
  el.append(make('p','audit-hint','Exemples prioritaires : échantillons facturés dans des commandes confirmées.'));
  showEntries(audit.paidSamples,6);
 } else el.append(make('p','audit-ok','Aucun échantillon classé avec un montant HT positif dans les commandes confirmées.'));
 makeTitle('Livraisons : contrôle des exclusions',
  fmtNumber(audit.shipping.length)+' lignes signalées, dont '+fmtNumber(audit.confirmedShipping.length)+
  ' sur commandes confirmées et '+fmtNumber(audit.paidShipping.length)+
  ' facturées. Vérifier la règle de calcul Kino avant toute déduction.');
 makeTitle('Commandes confirmées à 0 € — '+fmtNumber(audit.zeroAmountOrders.length),
  'Peuvent être des commandes offertes, des échantillons ou des dossiers à contrôler.');
 for(const order of audit.zeroAmountOrders.slice(0,10)){
  const card=make('div','audit-line');
  card.append(make('strong','',order.reference||'Sans référence'),
    make('div','audit-note',order.company+' · '+(order.client||'Client inconnu')+' · '+shortDate(order.date)));
  el.append(card);
 }
 if(audit.zeroAmountOrders.length>10)el.append(make('p','audit-hint','Les dix premières commandes sont affichées.'));
}
