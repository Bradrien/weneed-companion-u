import {normalizeReturnDeductions,commissionAfterReturns} from './commission-rules-d37.mjs';
const el=(tag,text,cls='')=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n};
const eur=cents=>new Intl.NumberFormat('fr-FR',{style:'currency',currency:'EUR'}).format(cents/100);
export function createCommissionReturns({request,isAuthenticated,onUpdated}){
 let data=null,loading=false,error='',selectedMonth=null,epoch=0;
 function reset(){epoch++;data=null;loading=false;error='';selectedMonth=null}
 async function load(month){
  if(!isAuthenticated())return;
  if(typeof request!=='function'){selectedMonth=month;data=null;error='Déductions de retour non disponibles dans cette lecture.';return;}
  const ticket=++epoch;selectedMonth=month;data=null;loading=true;error='';
  try{
   const response=await request(month);
   if(ticket!==epoch||!isAuthenticated())return;
   data=normalizeReturnDeductions(response,month);
  }catch{if(ticket===epoch)error='Les déductions de retour ne sont pas disponibles. Le montant après retours reste non confirmé.'}
  finally{if(ticket===epoch){loading=false;onUpdated?.()}}
 }
 function render({month,company,query,confirmed,sourceFresh,pipelineReadAt}){
  const panel=el('section',undefined,'commission-return-panel');
  panel.append(el('h3','Retours à déduire de la commission'),
   el('p','La commande confirmée déclenche la commission. La commission des retours est soustraite du total du mois où la déduction est renseignée.','commission-month-detail'));
  if(selectedMonth!==month||loading){panel.append(el('p','Lecture des déductions de retour…','commission-month-detail'));return panel}
  if(error||!data){panel.append(el('p',error||'Déductions de retour non chargées.','pipeline-error'));return panel}
  const now=Date.now(),freshTime=t=>{const n=Date.parse(t);return Number.isFinite(n)&&n<=now+300000&&now-n<=900000};
  const result=commissionAfterReturns(confirmed,data,{month,company,query,
   fresh:sourceFresh&&freshTime(data.readAt)&&freshTime(pipelineReadAt)});
  const rows=result.rows||[];
  const grid=el('div',undefined,'commission-month-grid');
  const metric=(title,value,help)=>{const n=el('article',undefined,'commission-month-metric');n.append(el('span',title),el('strong',value),el('small',help));return n};
  grid.append(metric('Déductions de retour enregistrées',eur(-(result.deductionCents||0)),rows.length+' pièce(s) renseignée(s).'),
   metric('Après déductions enregistrées · provisoire',result.available?eur(result.netCents):'Non calculé',
    result.available?'Commandes confirmées estimées '+eur(result.grossCents)+' moins les déductions ci-contre.':
    result.reason==='search_scope'?'Efface la recherche pour comparer le mois complet de la société sélectionnée.':
    'Lecture Odoo et déductions à actualiser ; aucune valeur manquante remplacée par zéro.'));
  panel.append(grid);
  for(const r of rows){
   const card=el('article',undefined,'commission-review-point');
   card.append(el('strong',r.reference+' · '+r.company+' · −'+eur(r.commission_cents)),
    el('p',r.description||'Déduction de commission liée à un retour.','commission-month-detail'),
    el('small','Source : '+r.source_file+' · '+r.source_sheet+' · '+r.amount_cell+
     '. Total source : '+r.net_formula_cell+' '+r.net_formula+'.','commission-month-detail'));
   panel.append(card);
  }
  panel.append(el('p',rows.length?
   'Ces pièces sont déduites une seule fois dans leur mois d’imputation, y compris lorsque la commande d’origine appartient à un autre mois.':
   'Aucune déduction de retour renseignée pour ce mois et cette société. Cela ne confirme pas l’absence de retour.',
   'commission-month-detail'));
  panel.append(el('p','Déductions enregistrées uniquement : le rapprochement de tous les retours reste nécessaire pour établir la commission finale. '+
   'Lecture des déductions : '+new Date(data.readAt).toLocaleString('fr-FR')+'.','commission-month-detail'));
  return panel;
 }
 return {reset,load,render};
}
