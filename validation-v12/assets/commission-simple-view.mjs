import {COMMISSION_STATUSES,commissionStatus,selectCommissions} from './commission-selection.mjs';
import {currentCommissionMonth,shiftCommissionMonth,labelCommissionMonth} from './monthly-commission-d25.mjs';
const node=(tag,cls='',text)=>{const n=document.createElement(tag);n.className=cls;if(text!==undefined)n.textContent=text;return n};
const euro=n=>n===null?'Non calculable':new Intl.NumberFormat('fr-FR',{style:'currency',currency:'EUR'}).format(n);
const button=(text,action)=>{const b=node('button','',text);b.type='button';b.onclick=action;return b};
const date=value=>new Date(value).toLocaleDateString('fr-FR',{day:'numeric',month:'short'});
export function renderSimpleCommissions(root,{source,state,loading,error,onMonth,onRefresh,onCompany,onQuery,onStatus,expanded,technicalOrder,advanced}){
 const panel=node('section','commission-simple');root.append(panel);
 const toolbar=node('div','commission-simple-toolbar');
 const input=node('input');input.type='month';input.value=state.month;input.setAttribute('aria-label','Mois des commissions');
 input.onchange=()=>{if(/^20\d{2}-(0[1-9]|1[0-2])$/.test(input.value))onMonth(input.value);else input.value=state.month};
 const prev=button('‹',()=>onMonth(shiftCommissionMonth(state.month,-1)));prev.setAttribute('aria-label','Mois précédent');
 const next=button('›',()=>onMonth(shiftCommissionMonth(state.month,1)));next.setAttribute('aria-label','Mois suivant');
 const refresh=button(loading?'Actualisation…':'Actualiser Odoo',onRefresh);refresh.disabled=loading;
 toolbar.append(prev,input,next,button('Ce mois',()=>onMonth(currentCommissionMonth())),refresh);
 panel.append(toolbar);
 const filters=node('section','commission-simple-filters');filters.setAttribute('aria-label','Sélection des commissions');
 const companyGroup=node('div','commission-simple-company');companyGroup.setAttribute('role','group');companyGroup.setAttribute('aria-label','Sociétés à inclure');
 const companyButtons=[];
 for(const [value,label] of [['all','Les deux'],['TR','TR'],['GTA','GTA']]){
  const b=button(label,()=>{state.company=value;onCompany(value);draw()});b.dataset.company=value;
  companyButtons.push(b);companyGroup.append(b);
 }
 const statusGroup=node('fieldset','commission-simple-statuses');statusGroup.append(node('legend','','Inclure dans le montant'));
 const statusInputs=[];
 for(const s of COMMISSION_STATUSES){
  const label=node('label');label.title=s.hint;
  const checkbox=node('input');checkbox.type='checkbox';checkbox.checked=state.statuses.has(s.key);checkbox.dataset.status=s.key;
  checkbox.onchange=()=>{if(checkbox.checked)state.statuses.add(s.key);else state.statuses.delete(s.key);onStatus(state.statuses);draw()};
  const text=node('span','',s.label),count=node('small');label.append(checkbox,text,count);statusGroup.append(label);statusInputs.push({checkbox,label,count,key:s.key});
 }
 filters.append(companyGroup,statusGroup);panel.append(filters);
 const result=node('div','commission-simple-result');
 const searchLabel=node('label','commission-simple-search');searchLabel.append(node('span','sr-only','Rechercher un client, une référence ou un produit'));
 const search=node('input');search.type='search';search.placeholder='Rechercher un client, une référence, un produit…';search.value=state.query;
 search.setAttribute('aria-label','Rechercher dans les commissions');search.oninput=()=>{state.query=search.value;onQuery(state.query);draw()};searchLabel.append(search);
 panel.append(searchLabel,result);
 function draw(){
  for(const b of companyButtons)b.setAttribute('aria-pressed',String(b.dataset.company===state.company));
  result.replaceChildren();
  const selected=source?selectCommissions(source,state):null;
  for(const item of statusInputs){item.count.textContent=selected?'('+selected.counts[item.key]+')':'';item.label.classList.toggle('selected',item.checkbox.checked)}
  const hero=node('section','commission-simple-total');hero.setAttribute('aria-label','Montant de la sélection');hero.setAttribute('aria-live','polite');
  const heading=node('div');heading.append(node('span','commission-simple-kicker','COMMISSION DE LA SÉLECTION'),
   node('strong','commission-simple-amount',selected?euro(selected.forecast):'—'));
  const scope=node('div','commission-simple-scope');scope.append(node('strong','',labelCommissionMonth(state.month)+' · '+(state.company==='all'?'TR + GTA':state.company)),
   node('span','',selected?selected.count+' document'+(selected.count>1?'s':'')+' sélectionné'+(selected.count>1?'s':''):'Lecture des documents Odoo'));
  hero.append(heading,scope);
  if(selected&&state.company==='all'){
   const breakdown=node('div','commission-simple-breakdown');
   for(const c of ['TR','GTA']){const part=node('div');part.append(node('span','',c),node('strong','',euro(selected.companies[c].forecast)));breakdown.append(part)}
   hero.append(breakdown);
  }
  const coverage=selected&&(selected.unavailableCount||selected.partialCount);
  hero.append(node('p','commission-simple-note',coverage?
   'Estimation partielle · '+selected.unavailableCount+' document(s) non calculable(s) · '+selected.partialCount+' partiel(s). Les montants manquants ne sont pas comptés.':
   'Estimation avant retours · hors SPIFF.'));
  if(coverage)hero.append(node('small','','Montant avant retours, hors SPIFF.'));
  if(selected?.potentialCount)hero.append(node('p','commission-simple-potential',selected.potentialCount+' devis non confirmé(s) inclus : leur commission reste potentielle.'));
  result.append(hero);
  if(loading){const notice=node('p','commission-simple-notice','Actualisation Odoo en cours…');notice.setAttribute('role','status');result.append(notice)}
  if(error){const notice=node('p','pipeline-error',error);notice.setAttribute('role','alert');result.append(notice)}
  if(!source){result.append(node('p','commission-simple-empty',loading?'Chargement des commissions…':'Aucune donnée disponible. Actualise Odoo pour charger le mois.'));return}
  if(source.enriched===false)result.append(node('p','pipeline-error','Documents Odoo disponibles. Le calcul des commissions est temporairement indisponible ; aucun montant n’est supposé. La facturation n’a pas été vérifiée dans cette lecture.'));
  const title=node('div','commission-simple-list-title');title.append(node('h3','','Détail des commissions'),node('span','',selected.count+' document'+(selected.count>1?'s':'')));result.append(title);
  const list=node('div','commission-simple-list');result.append(list);
  if(!selected.count)list.append(node('p','commission-simple-empty',state.statuses.size?'Aucun document pour cette sélection.':'Coche au moins un statut pour afficher les commissions.'));
  for(const order of selected.orders){
   const card=node('article','commission-simple-order');card.dataset.orderId=String(order.id);
   const head=button('',()=>{if(expanded.has(order.id))expanded.delete(order.id);else expanded.add(order.id);body.hidden=!expanded.has(order.id);head.setAttribute('aria-expanded',String(!body.hidden));chevron.textContent=body.hidden?'⌄':'⌃'});
   head.className='commission-simple-order-head';head.setAttribute('aria-expanded',String(expanded.has(order.id)));head.setAttribute('aria-controls','commission-lines-'+order.id);
   const client=node('div','commission-simple-client');client.append(node('strong','',order.client),node('span','',order.reference+' · '+date(order.date)));
   const status=node('div','commission-simple-order-status');status.append(node('span','commission-simple-company-tag',order.company),node('span','',COMMISSION_STATUSES.find(s=>s.key===commissionStatus(order)).label));
   const amount=node('div','commission-simple-order-amount');amount.append(node('strong','',euro(order.forecast)),node('small','',order.forecast===null?'À rapprocher':order.partial?'Partielle':'Commission estimée'));
   const chevron=node('span','commission-simple-chevron',expanded.has(order.id)?'⌃':'⌄');chevron.setAttribute('aria-hidden','true');head.append(client,status,amount,chevron);
   const body=node('div','commission-simple-lines');body.id='commission-lines-'+order.id;body.hidden=!expanded.has(order.id);
   body.append(node('h4','','Commission par produit'));
   for(const line of order.lines){
    const row=node('div','commission-simple-line'),name=node('div');name.append(node('strong','',line.product),node('small','',[(line.quantity??'—')+' '+(line.unit||'unité(s)'),line.sku].filter(Boolean).join(' · ')));
    const value=node('div');value.append(node('strong','',order.issues.length?'Suspendue':euro(line.commissionEstimate??null)));
    if(line.commissionEstimate==null||order.issues.length)value.append(node('small','','À rapprocher'));
    row.append(name,value);body.append(row);
   }
   if(technicalOrder&&source.enriched!==false){const details=node('details','commission-simple-calculation');details.append(node('summary','','Calculs et factures'),technicalOrder(order));body.append(details)}
   card.append(head,body);list.append(card);
  }
  result.append(node('p','commission-simple-footnote','Mois basé sur la date Odoo du devis ou de la commande. « Validés » et « Facturés » sont deux groupes distincts.'));
  if(advanced)result.append(advanced(selected));
 }
 draw();
}
