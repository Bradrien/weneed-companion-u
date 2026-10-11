import {normalizeOdooPipeline,filterOdooPipeline,odooPipelineTotals,statusLabels} from './odoo-commission-model-d30.mjs';
import {COMMISSION_ISSUES,COMMISSION_RULE_STATUS} from './commission-integrity-d24.mjs';
import {currentCommissionMonth,shiftCommissionMonth,labelCommissionMonth,summarizeCommissionMonth} from './monthly-commission-d25.mjs';
import {normalizeMonthlyOdooSource} from './monthly-odoo-fallback-d26.mjs';
const el=(tag,cls='',s)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(s!==undefined)n.textContent=String(s);return n};
const money=(n,currency='EUR')=>typeof n==='number'&&Number.isFinite(n)&&currency?
 new Intl.NumberFormat('fr-FR',{style:'currency',currency,maximumFractionDigits:2}).format(n):'Non calculable';
const eur=n=>money(n,'EUR');
const when=d=>{try{return new Date(d).toLocaleDateString('fr-FR')}catch{return 'Date inconnue'}};
const filters=['en_cours','confirme','facture'];
const name={en_cours:'Devis en cours',confirme:'Confirmées non facturées entièrement',facture:'Facturées'};
const lineReasons={catalog_unavailable:'Catalogue Kino indisponible',missing_kino_match:'SKU absent du catalogue Kino',
 ambiguous_sku:'SKU ambigu dans Kino',invalid_kino_tier:'Catégorie Kino inconnue',
 missing_kino_cost:'Coût Kino absent',line_price_mismatch:'Montant et remise Odoo incohérents',
 invalid_quantity:'Quantité invalide',invalid_calculation:'Simulation impossible',
 invalid_amount:'Prix, remise ou montant incompatible avec le scénario',
 missing_odoo_sku:'SKU absent dans Odoo : rapprochement nécessaire',
 not_eligible:'Ligne hors scénario selon le filtre actuel ; exclusion métier à confirmer',
 estimated_units_unverified:'Coût fondé sur les prix unitaires Kino actuels, historique à valider',
 unverified_unit_scale:'Coût au gramme ou au sachet non identifiable : estimation suspendue',
 missing_kino_price:'Prix de référence Kino manquant'};
export function createOdooQuotePipeline({request,monthlyReportRequest,isActive,isAuthenticated}){
 let data=null,fallbackData=null,fallbackMonth=null,fallbackLoading=false,fallbackError='',loading=false,error='',stages=new Set(filters),company='all',search='',month=currentCommissionMonth(),epoch=0,expanded=new Set(),failedCode='';
 const host=()=>document.getElementById('odoo-quote-pipeline-root');
 function reset(){epoch++;data=null;fallbackData=null;fallbackMonth=null;fallbackError='';fallbackLoading=false;loading=false;error='';failedCode='';stages=new Set(filters);company='all';search='';month=currentCommissionMonth();expanded.clear();host()?.replaceChildren()}
 async function load(force=false){
  if(!isAuthenticated()||loading)return;
  if((data||fallbackData)&&!force){render();return}
  const ticket=++epoch;loading=true;error='';render();
  try{
   const selectedMonth=month;
   const response=await request(selectedMonth);
   if(ticket!==epoch||!isAuthenticated())return;
   if(response.data?.period_from&&response.data.period_from!==selectedMonth+'-01')throw Error('report_period_mismatch');
   data=normalizeOdooPipeline(response.data);fallbackData=null;fallbackMonth=null;fallbackError='';
  }catch(e){if(ticket===epoch){
   failedCode=typeof e?.message==='string'?e.message:'odoo_pipeline_unavailable';
   const labels={
    odoo_auth_failed:'La connexion du service à Odoo est refusée.',
    report_period_mismatch:'Le rapport ne correspond pas au mois demandé.',
    odoo_scope_too_large:'Le périmètre Odoo contient trop de données pour cette lecture.',
    odoo_state_changed:'Une commande a changé de statut en cours de lecture.',
    odoo_source_changed:'Une commande ou ses lignes ont changé pendant la lecture : actualise Odoo.',
    odoo_unreachable:'Odoo ne répond pas à la passerelle.',
    odoo_remote_error:'Odoo a refusé une des lectures de données.',
    odoo_not_configured:'La connexion Odoo de la passerelle n’est pas configurée.',
    invalid_period:'Période Odoo invalide.',
    origin_not_allowed:'L’origine Safari a été refusée.',
    invalid_session:'La session propriétaire a expiré : reconnecte-toi.',
    owner_only:'Ce compte n’a pas l’autorisation propriétaire.',
    invalid_odoo_pipeline:'Le serveur a fourni une réponse non conforme.',
    invalid_odoo_pipeline_order:'Une commande source est incohérente.',
    invalid_odoo_line:'Une ligne source est invalide ou dupliquée.',
    invalid_line_coverage:'Le nombre de lignes simulées ne correspond pas au détail source.',
    invalid_odoo_forecast:'L’estimation source est invalide.',
    odoo_stage_mismatch:'Le statut affiché ne correspond pas à Odoo.',
    odoo_pipeline_unavailable:'Le service de synchronisation n’a pas renvoyé de données utilisables.',
    network_error:'Le navigateur ne parvient pas à joindre le service.'
   };
   const phase=typeof e?.stage==='string'&&/^[a-z_]{3,40}$/.test(e.stage)?e.stage:null;
   error=(labels[failedCode]||'La lecture des devis Odoo a échoué.')+
    ' Code : '+(/^[a-z0-9_]{3,65}$/.test(failedCode)?failedCode:'erreur_reseau')+
    (phase?' · Étape : '+phase:'')+
    '. Le bilan mensuel tente alors la lecture Odoo classique.';
   if(typeof monthlyReportRequest==='function'){
    const selectedMonth=month;
    fallbackLoading=true;fallbackError='';
    try{
     const result=await monthlyReportRequest(selectedMonth);
     if(ticket===epoch&&isAuthenticated()&&selectedMonth===month){
      fallbackData=normalizeMonthlyOdooSource(result,selectedMonth);fallbackMonth=selectedMonth;
     }
    }catch(failure){
     if(ticket===epoch){
      fallbackData=null;fallbackMonth=null;
      fallbackError='Lecture Odoo mensuelle indisponible : '+(typeof failure?.message==='string'?
       failure.message.slice(0,80):'erreur inconnue');
     }
    }finally{fallbackLoading=false}
   }
  }}
  finally{if(ticket===epoch){loading=false;render()}}
 }
 function mini(title,value,details){const box=el('article','pipeline-stat');
  box.append(el('span','',title),el('strong','',value),el('small','',details));return box}
 function orderCard(o){
  const wrap=el('article','pipeline-order');
  const trigger=el('button','pipeline-order-head');trigger.type='button';
  trigger.setAttribute('aria-expanded',String(expanded.has(o.id)));
  const left=el('div');
  left.append(el('strong','',o.reference+' · '+o.company),el('small','',o.client+' · '+when(o.date)));
  const right=el('div','pipeline-right');
  right.append(el('strong','',money(o.amountHT,o.currency)+' HT'),el('small','',statusLabels[o.stage]));
  trigger.append(left,right);wrap.append(trigger);
  const details=el('div','pipeline-order-details');
  details.hidden=!expanded.has(o.id);
  details.append(el('p','pipeline-status',
   'État Odoo : '+o.state+' · Facturation Odoo : '+(o.invoiceStatus||'non renseignée')+
   '. « Facturé » ne prouve pas que la facture est réglée.'));
  const calc=el('p','pipeline-estimate',o.forecast===null?
   'Commission potentielle : '+(o.issues.length?'estimation suspendue.':'non calculable avec les données actuelles.'):
   'Commission potentielle'+(o.partial?' partielle':'')+
    ' : '+eur(o.forecast)+' · '+o.matchedLines+' ligne(s) estimées, '+o.unmatchedLines+' à rapprocher');
  details.append(calc);
  if(o.excludedLines)details.append(el('p','pipeline-hint',
   o.excludedLines+' ligne(s) hors scénario, dont '+o.excludedMonetaryLines+' avec un montant HT ou montant manquant. Ces exclusions ne valident pas une règle de rémunération.'));
  for(const issue of o.issues)details.append(el('p','pipeline-error',COMMISSION_ISSUES[issue]||'Calcul à vérifier'));
  const list=el('div','pipeline-lines');
  for(const l of o.lines){
   const item=el('div','pipeline-line');
   item.append(el('strong','',l.product+(l.sku?' · '+l.sku:'')));
   item.append(el('span','',
     (l.quantity??'—')+' '+(l.unit||'unité')+' · '+money(l.subtotalHT,o.currency)+' HT'));
   item.append(el('small','',
    l.commissionEstimate!==null?(o.issues.length?'Estimation suspendue pour cette commande':
      'Commission estimée : '+eur(l.commissionEstimate)+' · Coût historique à confirmer'):
      'Non estimée : '+(lineReasons[l.reason]||l.reason)));
   if(l.unitBasis&&l.effectiveUnitCostEur!==null){
    const basis=l.unitBasis==='pack_cost_divided_by_grams'?
     'Sachet Kino '+l.packSizeG+' g → coût converti au gramme':
     (l.packSizeG?'Sachet Kino '+l.packSizeG+' g → coût par sachet':'Même unité que le tarif catalogue Kino');
    item.append(el('small','pipeline-cost-detail',
     'Contrôle Kino : '+basis+' · Coût '+eur(l.effectiveUnitCostEur)+
     '/unité Odoo · Tarif catalogue '+eur(l.catalogUnitPriceEur)+
     '/unité Odoo · Palier '+l.kinoTier+'.'));
   }
   list.append(item);
  }
  details.append(list);
  const toOrder=el('p','pipeline-hint','Seuls les documents Odoo sont affichés. Ouvrir Commandes pour le contrôle mensuel détaillé. Aucun devis n’est ajouté ou modifié dans Odoo.');
  details.append(toOrder);wrap.append(details);
  trigger.onclick=()=>{if(expanded.has(o.id))expanded.delete(o.id);else expanded.add(o.id);
   details.hidden=!expanded.has(o.id);trigger.setAttribute('aria-expanded',String(expanded.has(o.id)))};
  return wrap;
 }

 async function reloadFallback(selectedMonth){
  if(typeof monthlyReportRequest!=='function'||!isAuthenticated()||data)return;
  const ticket=epoch;
  fallbackData=null;fallbackMonth=null;fallbackError='';fallbackLoading=true;render();
  try{
   const response=await monthlyReportRequest(selectedMonth);
   if(ticket!==epoch||!isAuthenticated()||selectedMonth!==month)return;
   fallbackData=normalizeMonthlyOdooSource(response,selectedMonth);fallbackMonth=selectedMonth;
  }catch(e){
   if(ticket===epoch&&selectedMonth===month)fallbackError='Lecture mensuelle Odoo indisponible : '+
    (typeof e?.message==='string'?e.message.slice(0,80):'erreur inconnue');
  }finally{
   if(ticket===epoch&&selectedMonth===month){fallbackLoading=false;render()}
  }
 }
 function monthlyMetric(title,group,description){
  const box=el('article','commission-month-metric');
  box.append(el('span','',title),
   el('strong','',group.forecast===null?'—':eur(group.forecast)),
   el('small','',group.count+' document(s) · '+group.estimatedCount+' estimation(s) calculables'+
    (group.unavailableCount?' · '+group.unavailableCount+' à rapprocher':'')+
    (group.partialCount?' · '+group.partialCount+' partielle(s)':'')+'. '+description));
  return box;
 }
 function drawMonthly(target){
  target.replaceChildren();
  const monthlyData=data||(fallbackMonth===month?fallbackData:null);
  if(!monthlyData){
   target.append(el('p','commission-month-detail',(loading||fallbackLoading)?
    'Lecture des devis et commandes Odoo en cours…':
    'Aucune donnée Odoo chargée : impossible de lister les devis. Utilise « Actualiser Odoo ».'));
   if(fallbackError)target.append(el('p','pipeline-error',fallbackError));
   return;
  }
  if(!data)target.append(el('p','commission-month-detail',
    'Source : rapport Odoo classique vérifié sur le mois. Documents réels, mais estimations de commissions suspendues car le calcul enrichi est indisponible.'+
    (monthlyData.excludedCount?' '+monthlyData.excludedCount+' document(s) annulé(s) exclus.':'')));
  const summary=summarizeCommissionMonth(monthlyData,{month,company,query:search});
  const grid=el('div','commission-month-grid');
  grid.append(
   monthlyMetric('Devis non confirmés · potentiels',summary.pending,
    'Sous réserve de confirmation Odoo.'),
   monthlyMetric('Commandes confirmées · prévisionnelles',summary.confirmed,
    'Comprend les commandes facturées ; ne signifie pas payé.')
  );
  const validated=el('article','commission-month-metric');
  validated.append(el('span','','Commissions validées · acquises'),
   el('strong','','Non disponible'),
   el('small','','Aucune validation officielle de rémunération ou preuve de paiement accessible.'));
  grid.append(validated);
  target.append(grid);
  const groups=[
   ['Devis en cours',summary.pending],
   ['Confirmées et facturées',summary.confirmed]
  ];
  for(const [heading,group] of groups){
   const section=el('div','commission-month-breakdown');
   section.append(el('h3','',heading+' · '+group.count));
   const list=el('div','commission-month-list');
   if(!group.orders.length)list.append(el('p','commission-month-detail','Aucun document pour ce mois avec les filtres actuels.'));
   for(const o of group.orders.slice(0,80)){
    const item=el('article','commission-month-row');
    const left=el('div');
    left.append(el('strong','',o.reference+' · '+o.client),
     el('small','',o.company+' · '+when(o.date)+' · '+money(o.amountHT,o.currency)+' HT'+
      (o.stage==='facture'?' · Facturé (Odoo)':'')));
    const value=el('div','monthly-forecast',o.forecast===null?'Estimation à rapprocher':
     eur(o.forecast)+(o.partial?' · partielle':''));
    item.append(left,value);list.append(item);
   }
   if(group.orders.length>80)list.append(el('p','commission-month-detail',
    '80 premiers documents affichés pour cette catégorie. Recherche plus précise nécessaire.'));
   section.append(list);target.append(section);
  }
  target.append(el('p','commission-month-detail',
   'Mois établi à partir de la date Odoo du devis ou de la commande. Catégories exclusives : un devis confirmé quitte la catégorie « devis en cours ». '+
   'Les montants sont des estimations partielles lorsque des lignes ne sont pas rapprochées. '+
   'La recherche en haut du bilan permet de retrouver directement un client ou une référence.'));
  if(error)target.append(el('p','pipeline-error',data?
   'Attention : actualisation échouée. Dernière réponse en mémoire, potentiellement périmée.':
   'Le pipeline de calcul enrichi est indisponible ('+failedCode+'). Les devis affichés proviennent du rapport Odoo classique.'));
 }
 function renderMonthly(root){
  const panel=el('section','commission-monthly-panel');
  panel.append(el('span','eyebrow','BILAN COMMERCIAL MENSUEL'),
   el('h2','','Devis, commandes et commissions'),
   el('p','','Prévisionnel exclusivement basé sur les documents Odoo accessibles à ton compte. Aucune commission acquise supposée.'));
  const toolbar=el('div','commission-month-toolbar');
  const previous=el('button','','‹');previous.type='button';
  previous.setAttribute('aria-label','Mois précédent du bilan commissions');
  const select=el('input');select.type='month';select.value=month;
  select.setAttribute('aria-label','Mois du bilan commissions');
  const next=el('button','','›');next.type='button';
  next.setAttribute('aria-label','Mois suivant du bilan commissions');
  const current=el('button','','Mois courant');current.type='button';
  const refresh=el('button','','↻ Odoo');refresh.type='button';refresh.disabled=loading;
  refresh.setAttribute('aria-label','Actualiser le bilan Odoo');
  refresh.onclick=()=>load(true);
  const label=el('strong','',labelCommissionMonth(month));
  const body=el('div','commission-month-body');
  function changeMonth(nextMonth){
   if(nextMonth!==month){
    // Never present the prior month's Odoo snapshot as the newly selected month.
    data=null;fallbackData=null;fallbackMonth=null;fallbackError='';
   }
   month=nextMonth;select.value=month;label.textContent=labelCommissionMonth(month);drawMonthly(body);
   load(true);
  }
  previous.onclick=()=>changeMonth(shiftCommissionMonth(month,-1));
  next.onclick=()=>changeMonth(shiftCommissionMonth(month,1));
  current.onclick=()=>changeMonth(currentCommissionMonth());
  select.onchange=()=>{if(/^\d{4}-(0[1-9]|1[0-2])$/.test(select.value))changeMonth(select.value);
   else select.value=month};
  toolbar.append(previous,select,next,current,refresh);
  const quick=el('div','commission-quick-controls');
  const filterLabel=el('label','commission-quick-label','Recherche rapide par client ou référence Odoo');
  const quickSearch=el('input');
  quickSearch.type='search';quickSearch.value=search;quickSearch.placeholder='Ex. CBW, T02163, S03687';
  quickSearch.setAttribute('aria-label','Rechercher dans le bilan mensuel');
  quickSearch.oninput=()=>{
   search=quickSearch.value;
   drawMonthly(body);
   const detail=root.querySelector('.pipeline-result');if(detail&&data)drawRows(detail);
   const lower=root.querySelector('input[aria-label="Rechercher les devis Odoo"]');
   if(lower&&lower!==quickSearch)lower.value=search;
  };
  filterLabel.append(quickSearch);
  const companySelect=el('select');
  companySelect.setAttribute('aria-label','Filtrer le bilan mensuel par société');
  for(const [value,name] of [['all','GTA + TR'],['GTA','GTA seulement'],['TR','TR seulement']]){
   const opt=el('option','',name);opt.value=value;companySelect.append(opt);
  }
  companySelect.value=company;
  companySelect.onchange=()=>{company=companySelect.value;render()};
  const hint=el('small','commission-quick-hint','Recherche dans les documents attribués à ton utilisateur Odoo.');
  quick.append(filterLabel,companySelect,hint);
  panel.append(toolbar,label,quick,body);
  root.append(panel);drawMonthly(body);
 }

 function render(){
  if(!isActive())return;
  const root=host();if(!root)return;root.replaceChildren();
  renderMonthly(root);
  const top=el('section','pipeline-head');
  top.append(el('h3','','Devis et commandes synchronisés depuis Odoo'),
   el('p','pipeline-hint',
    'Aucune saisie manuelle. Sélectionne les statuts à inclure : en cours, confirmés non entièrement facturés et facturés. Les choix sont combinables. Ce n’est pas une commission acquise.'));
  const refresh=el('button','secondary-button',loading?'Actualisation…':'↻ Actualiser Odoo');
  refresh.disabled=loading;refresh.type='button';refresh.onclick=()=>load(true);
  top.append(refresh);root.append(top);
  root.append(el('p','pipeline-hint',
   'Commissions payables : non validées. '+COMMISSION_RULE_STATUS.explanation));
  const all=data?odooPipelineTotals(data.orders):null;
  if(data)root.append(el('p','pipeline-filter-intro','Inclure dans la liste détaillée (coche plusieurs statuts) :'));
  const pills=el('div','pipeline-pills');
  for(const value of filters){
   const count=all?String(all[value]):'—';
   const checked=stages.has(value);
   const label=el('label','pipeline-filter'+(checked?' selected':''));
   const box=el('input');box.type='checkbox';box.checked=checked;
   box.setAttribute('aria-label','Inclure '+name[value]);
   box.onchange=()=>{
    if(box.checked)stages.add(value);else stages.delete(value);
    render();
   };
   label.append(box,el('span','',name[value]+' ('+count+')'));pills.append(label);
  }
  if(data)root.append(pills);
  if(loading)root.append(el('p','pipeline-hint','Actualisation Odoo en cours…'));
  if(error){const warn=el('p','pipeline-error',error);root.append(warn)}
  if(!data){
   root.append(el('p','pipeline-hint',fallbackData?
    'La liste détaillée et le calcul des commissions restent indisponibles. Les documents du mois apparaissent dans le bilan ci-dessus grâce au rapport Odoo classique.':
    'Les filtres sont prêts. La liste détaillée apparaîtra si le pipeline Odoo enrichi répond ; réessaie avec « Actualiser Odoo ».'));
   return;
  }
  if(error)root.append(el('p','pipeline-hint','Dernière lecture en mémoire affichée ci-dessous : elle peut être périmée.'));
  if(!data.sourceInputsRechecked)root.append(el('p','pipeline-hint',
   'Le service actuel ne revérifie pas encore les prix, remises et montants après la première lecture. Actualisation du contrôle requise avant validation.'));
  const controls=el('div','pipeline-controls'),selector=el('select');
  for(const [value,label]of [['all','GTA + TR'],['GTA','GTA uniquement'],['TR','TR uniquement']]){
   const opt=el('option','',label);opt.value=value;selector.append(opt)}
  selector.value=company;selector.setAttribute('aria-label','Filtrer les commandes par société');
  selector.onchange=()=>{company=selector.value;render()};
  const q=el('input');q.type='search';q.value=search;
  q.placeholder='Client, commande, référence…';q.setAttribute('aria-label','Rechercher les devis Odoo');
  q.oninput=()=>{search=q.value;const r=root.querySelector('.pipeline-result');if(r)drawRows(r);const m=root.querySelector('.commission-month-body');if(m)drawMonthly(m)};
  controls.append(selector,q);root.append(controls);
  const result=el('div','pipeline-result');root.append(result);drawRows(result);
  root.append(el('p','pipeline-hint',
   'Périmètre : devis et commandes Odoo pour le mois sélectionné, sous ton utilisateur commercial. '+
   'Le statut facturé provient de invoice_status et ne prouve aucun règlement. '+
   'Les coûts ont été rapprochés de l’unité commerciale lorsque le catalogue fournit suffisamment d’indices ; tout cas ambigu reste non estimé. '+
   'Le catalogue Kino est une photographie actuelle : coûts historiques, exclusions, SPIFF, avoirs et paiements restent à vérifier. '+
   'Dernière lecture : '+when(data.readAt)+'. Catalogue : '+
   (data.catalogSnapshotAt?when(data.catalogSnapshotAt):'date indisponible')+'.'));
 }
 function drawRows(container){
  container.replaceChildren();
  const rows=filterOdooPipeline(data,{stages:[...stages],company,query:search}),totals=odooPipelineTotals(rows);
  const grid=el('div','pipeline-stats');
  grid.append(mini('Documents affichés',totals.orders,'Filtre actuel'),
   mini(totals.amountKnown<totals.orders?'CA HT disponible (partiel)':'CA HT du périmètre',
    totals.amountKnown?money(totals.amountHT,totals.amountCurrency):'Non disponible',
    totals.mixedCurrencies?'Plusieurs devises : total non additionné':totals.amountKnown+'/'+totals.orders+' montants disponibles'),
   mini('Commission potentielle estimée',totals.forecastCount?eur(totals.forecast):'Non calculable',
    totals.forecastCount+'/'+totals.orders+' documents estimés ; '+totals.forecastPartial+' partiel(s), '+totals.blocked+' suspendu(s)'),
   mini('Non simulés',String(totals.orders-totals.forecastCount),
    'Pas de commission zéro supposée'));
  container.append(grid);
  if(!rows.length){container.append(el('p','pipeline-hint','Aucun document Odoo pour ces filtres.'));return}
  for(const o of rows.slice(0,120))container.append(orderCard(o));
  if(rows.length>120)container.append(el('p','pipeline-hint',
   'Affichage limité aux 120 premiers documents triés par date : affine la recherche ou le filtre.'));
 }
 return {load,reset,render};
}
