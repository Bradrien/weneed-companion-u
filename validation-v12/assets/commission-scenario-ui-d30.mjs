/** Read-only presentation of a provisional scenario; no server writes or validation claims. */
import {formatMoney} from './model.mjs';
import {simulateOdooReport,SCENARIO_REASONS} from './commission-scenario-d30.mjs?v=rules-1';
import {sumCents} from './commission-integrity-d24.mjs';
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
