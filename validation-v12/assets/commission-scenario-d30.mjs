/**
 * Pure, provisional per-line Kino simulation from the authenticated read-only Odoo report.
 * Uses the same conservative unit basis and line-cent rounding as the D30 pipeline.
 * Historical costs and Kino server rules remain unverified. Never payable.
 */
import {calculateKinoLine} from './kino-calculation-d31.mjs';
import {sourceAmountIssues,COMMISSION_RULE_STATUS,sumCents} from './commission-integrity-d24.mjs';
import {reconcileKinoUnit} from './kino-unit-basis-d30.mjs';

const CONFIRMED=new Set(['sale','done']);
export const SCENARIO_REASONS=Object.freeze({
  not_confirmed:'Commande non confirmée',
  invalid_order_totals:'Sous-total de commande Odoo incohérent ou incomplet',
  signed_adjustment:'Ligne négative ou ajustement : estimation de la commande suspendue',
  excluded_kind:'Échantillon, livraison, gratuité ou ligne non éligible',
  not_matched:'Référence ou SKU non officiellement rapproché',
  not_eur:'Devise différente de EUR',
  invalid_tier:'Catégorie Kino différente de A/B',
  invalid_cost:'Coût ou prix catalogue Kino indisponible / nul',
  invalid_quantity:'Quantité Odoo invalide',
  invalid_amount:'Prix de vente ou montant HT Odoo invalide',
  inconsistent_subtotal:'Remise ou sous-total Odoo incohérent',
  unverified_unit_scale:'Coût au gramme ou au sachet non identifiable : estimation suspendue',
  unverified_commission:'Source contenant une commission non nulle',
  simulation_error:'Erreur de simulation'
});
function usable(n){return typeof n==='number'&&Number.isFinite(n)}
function roundedSum(values){
 const amount=sumCents(values);
 if(amount===null)throw new Error('invalid_simulation_total');
 return amount/100;
}
function checkLine(order,line,orderIssues){
 if(!CONFIRMED.has(order.state))return 'not_confirmed';
 if(orderIssues.includes('signed_adjustment'))return 'signed_adjustment';
 if(orderIssues.some(x=>x==='lines_total_mismatch'||x==='incomplete_source_amount'))return 'invalid_order_totals';
 if(line.kind!=='candidate')return 'excluded_kind';
 const match=line.catalog_match;
 if(!match||match.status!=='matched')return 'not_matched';
 if(order.currency!=='EUR')return 'not_eur';
 if(match.tier!=='A'&&match.tier!=='B')return 'invalid_tier';
 if(!usable(match.cost_eur)||match.cost_eur<=0||
    !usable(match.list_price_eur)||match.list_price_eur<=0)return 'invalid_cost';
 if(!usable(line.quantity)||line.quantity<=0)return 'invalid_quantity';
 if(!usable(line.unit_price)||line.unit_price<0||
    !usable(line.line_ht)||line.line_ht<0||
    !usable(line.discount_pct)||line.discount_pct<0||line.discount_pct>100)return 'invalid_amount';
 const expected=line.quantity*line.unit_price*(1-line.discount_pct/100);
 if(Math.abs(expected-line.line_ht)>0.04)
  return 'inconsistent_subtotal';
 if(line.commission_eur!==null||order.commission_eur!==null)return 'unverified_commission';
 if(!unitBasis(line).ok)return 'unverified_unit_scale';
 return null;
}
function unitBasis(line){
 const match=line.catalog_match;
 return reconcileKinoUnit({sku:line.sku,productName:match?.catalog_name,
  cost:match?.cost_eur,listedPrice:match?.list_price_eur,odooUnitPrice:line.unit_price});
}
export function simulateOdooReport(report){
 if(!report||!Array.isArray(report.orders))return null;
 // The gateway asserts that no commission has been verified or persisted.
 if(report.verified_commissions_eur!==null||
    report.commissions_are_calculated!==false||report.persisted!==false)
  throw new Error('simulation_requires_unverified_read_only_report');
 // Prevent presenting figures from older gateway versions without a second Odoo status read.
 if(report.source_order_status_rechecked!==true||
    typeof report.source_order_status_checked_at!=='string'||
    !Number.isFinite(Date.parse(report.source_order_status_checked_at)))
  throw new Error('simulation_requires_rechecked_order_status');
 const byCompany={GTA:{company:'GTA',lineCount:0,simulated:0,commission:0,margin:0,sales:0,orders:new Set()},
                  TR:{company:'TR',lineCount:0,simulated:0,commission:0,margin:0,sales:0,orders:new Set()}};
 const ready=[],excluded=[],reasons={},cancelledOrders=[];
 const orderIds=new Set(),lineIds=new Set();
 for(const order of report.orders){
  if(!order||!Number.isSafeInteger(order.id)||order.id<1||orderIds.has(order.id)||
   !Array.isArray(order.lines))throw new Error('invalid_simulation_order');
  orderIds.add(order.id);
  if(!byCompany[order.company])throw new Error('unknown_company');
  const orderIssues=[...(order.issues||[]),...sour…732 tokens truncated…s} from './commission-integrity-d24.mjs';
const el=(tag,cls,value)=>{
 const n=document.createElement(tag);
 if(cls)n.className=cls;
 if(value!==undefined)n.textContent=String(value);
 return n;
};
function metric(label,value,subtitle){
 const box=el('article','scenario-metric');
 box.append(el('span','scenario-label',label),el('strong','scenario-amount',value),
  el('small','scenario-small',subtitle));return box;
}
export function renderCommissionScenario(report,target,{onOpenOrder}={}){
 target.replaceChildren();
 if(!report){target.append(el('p','audit-hint','Charge d’abord les commandes Odoo pour préparer un scénario.'));return}
 let result;
 try{result=simulateOdooReport(report)}
 catch(error){
  const requiresStatus=error?.message==='simulation_requires_rechecked_order_status';
  target.append(el('p','scenario-warning',requiresStatus?
   'STATUTS ODOO NON REVÉRIFIÉS — simulation suspendue. Actualise les commandes avec ↻ pour recontrôler les annulations depuis Odoo.':
   'Rapport incompatible avec la simulation en lecture seule. Aucun montant présenté.'));
  return;
 }
 if(!result.eligibleMatched){
  target.append(el('p','audit-hint','Le rapport ne comporte aucune ligne rapprochée dans Kino. Scénario indisponible.'));
  return;
 }
 const banner=el('p','scenario-warning',
  'SIMULATION CONDITIONNELLE — NON ACQUISE. Coûts du catalogue Kino actuel rapprochés des unités Odoo ; cas ambigus suspendus. Coûts à la date de vente, SPIFF, avoirs, exclusions contractuelles et déclenchement du paiement restent à confirmer. SPIFF désactivé.');
 target.append(banner);
 const checkedAt=new Date(result.sourceStatusCheckedAt).toLocaleString('fr-FR',{
  dateStyle:'short',timeStyle:'short'});
 target.append(el('p','scenario-verified-status',
  'États des commandes revérifiés dans Odoo le '+checkedAt+
  '. La situation peut évoluer après cette lecture : recharge ↻ avant toute comparaison.'));
 const grid=el('div','scenario-grid');
 for(const code of ['GTA','TR']){
  const g=result.companies[code];
  grid.append(metric('Scénario '+code,formatMoney(g.commission,'EUR'),
   g.lineCount+' ligne(s) sur '+g.orders+' commande(s) · Coût catalogue actuel'));
 }
 grid.append(metric('Scénario total partiel',formatMoney(result.total,'EUR'),'Montant théorique non payable'));
 target.append(grid);
 target.append(el('p','scenario-explainer',
  result.simulatedLines+' ligne(s) simulées sur '+result.eligibleMatched+
  ' lignes officiellement rapprochées. Calcul sur le HT après remise. Aucune ligne non rapprochée, échantillon, livraison ou commande non confirmée n’est rémunérée dans ce scénario.'));
 const cancelled=result.cancelledOrders;
 const cancelPanel=el('section','scenario-coverage');
 cancelPanel.append(el('strong','','Commandes Odoo annulées : '+cancelled.length+' · exclues du scénario'));
 if(cancelled.length){
  cancelPanel.append(el('p','scenario-small',
   'Statut source cancel, revérifié au chargement. Si une commande simulée est annulée dans Odoo, communique sa référence : il faut examiner cette divergence.'));
  for(const order of cancelled.slice(0,25)){
   const line=el('div','scenario-cancel-row');
   line.append(el('span','',order.reference+' · '+order.company+' · '+(order.client||'Client non renseigné')),
    el('strong','','Annulée · exclue'));
   cancelPanel.append(line);
  }
  if(cancelled.length>25)cancelPanel.append(el('p','scenario-small','25 premières commandes annulées affichées.'));
 }else cancelPanel.append(el('p','scenario-small','Aucune commande au statut cancel dans ce rapport.'));
 target.append(cancelPanel);
 const failures=Object.entries(result.reasons).filter(([,count])=>count>0);
 const panel=el('div','scenario-coverage');
 panel.append(el('strong','','Lignes non simulées : '+result.excluded.length));
 const list=el('ul','scenario-exclusions');
 for(const [reason,count] of failures.sort((a,b)=>b[1]-a[1]))
  list.append(el('li','',count+' · '+(SCENARIO_REASONS[reason]||'À vérifier')));
 panel.append(list);target.append(panel);
 const byOrder=new Map();
 for(const row of result.ready){
  const key=row.company+'|'+row.order_id;
  if(!byOrder.has(key))byOrder.set(key,{company:row.company,reference:row.reference,
   client:row.client,id:row.order_id,lines:0,amount:0});
  const acc=byOrder.get(key);acc.lines++;acc.amount=sumCents([acc.amount,row.commission])/100;
 }
 const title=el('h3','scenario-subtitle','Détail du scénario par commande');
 target.append(title);
 const sorted=[...byOrder.values()].sort((a,b)=>a.company.localeCompare(b.company)||
  a.reference.localeCompare(b.reference));
 for(const order of sorted.slice(0,30)){
  const card=el('div','scenario-order');
  const row=el('div','scenario-order-line');
  row.append(el('strong','',order.reference+' · '+order.company),
   el('strong','',formatMoney(order.amount,'EUR')));
  card.append(row,el('small','scenario-small',
   (order.client||'Client sans nom')+' · '+order.lines+' ligne(s) simulée(s) · Statut Odoo : confirmée · Montant théorique'));
  if(typeof onOpenOrder==='function'){
   const b=el('button','audit-order-link','Voir la commande');
   b.type='button';b.addEventListener('click',()=>onOpenOrder({id:order.id,reference:order.reference}));
   card.append(b);
  }
  target.append(card);
 }
 if(sorted.length>30)target.append(el('p','audit-hint','Affichage limité aux 30 premières commandes sur '+sorted.length+'.'));
 target.append(el('p','scenario-final','Ce scénario ne valide pas les commissions de la période et ne constitue pas un décompte de rémunération. Il dépend des unités d’achat, des coûts historiques, de la logique serveur Kino, des avoirs et des règles d’exclusion.'));
}
