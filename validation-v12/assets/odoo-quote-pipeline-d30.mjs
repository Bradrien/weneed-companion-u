import {normalizeOdooPipeline,filterOdooPipeline,odooPipelineTotals,statusLabels,pipelineReconciliationGroups} from './odoo-commission-model-d30.mjs?v=rules-1';
import {catalogueProvenance,selectedCommissionOrders,createCommissionCsv} from './commission-audit-d31.mjs?v=rules-1';
import {createInvoiceEvidenceView} from './odoo-invoice-evidence-d32.mjs?v=review-1';
import {reviewAction,reviewPointsForOrders,createReviewCsv,odooRecordUrl} from './commission-review-d33.mjs';
import {COMMISSION_ISSUES} from './commission-integrity-d24.mjs';
import {COMMISSION_RULE_STATUS} from './commission-rules-d37.mjs';
import {createCommissionReturns} from './commission-returns-d37.mjs?v=credits-1';
import {createMonthlyCredits} from './monthly-credits-d38.mjs?v=date-1';
import {currentCommissionMonth,shiftCommissionMonth,labelCommissionMonth,summarizeCommissionMonth} from './monthly-commission-d25.mjs';
import {normalizeMonthlyOdooSource} from './monthly-odoo-fallback-d26.mjs';
const el=(tag,cls='',s)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(s!==undefined)n.textContent=String(s);return n};
const money=(n,currency='EUR')=>typeof n==='number'&&Number.isFinite(n)&&currency?
 new Intl.NumberFormat('fr-FR',{style:'currency',currency,maximumFractionDigits:2}).format(n):'Non calculable';
const eur=n=>money(n,'EUR');
const preciseEur=n=>new Intl.NumberFormat('fr-FR',{style:'currency',currency:'EUR',maximumFractionDigits:6}).format(n);
const percent=n=>new Intl.NumberFormat('fr-FR',{style:'percent',maximumFractionDigits:4}).format(n);
const timestamp=d=>d&&Number.isFinite(Date.parse(d))?new Date(d).toLocaleString('fr-FR',{
 dateStyle:'short',timeStyle:'short'}):'Indisponible';
const when=d=>{try{return new Date(d).toLocaleDateString('fr-FR')}catch{return 'Date inconnue'}};
const filters=['en_cours','confirme','facture'];
const name={en_cours:'Devis en cours',confirme:'Confirmées non facturées entièrement',facture:'Facturées'};
const lineReasons={catalog_unavailable:'Catalogue Kino indisponible',missing_kino_match:'SKU absent du catalogue Kino',
 ambiguous_sku:'SKU ambigu dans Kino',invalid_kino_tier:'Catégorie Kino inconnue',
 missing_kino_cost:'Coût Kino absent ou nul',line_price_mismatch:'Montant et remise Odoo incohérents',
 invalid_quantity:'Quantité invalide',invalid_calculation:'Simulation impossible',
 invalid_amount:'Prix, remise ou montant incompatible avec le scénario',
 missing_odoo_sku:'SKU absent dans Odoo : rapprochement nécessaire',
 not_eligible:'Ligne hors scénario selon le filtre actuel ; exclusion métier à confirmer',
 estimated_units_unverified:'Coût fondé sur les prix unitaires Kino actuels, historique à valider',
 unverified_unit_scale:'Coût au gramme ou au sachet non identifiable : estimation suspendue',
 missing_kino_price:'Prix de référence Kino manquant'};
export function createOdooQuotePipeline({request,monthlyReportRequest,invoiceEvidenceRequest,returnDeductionsRequest,monthlyCreditsRequest,isActive,isAuthenticated}){
 let data=null,fallbackData=null,fallbackMonth=null,fallbackLoading=false,fallbackError='',loading=false,error='',stages=new Set(filters),company='all',search='',month=currentCommissionMonth(),epoch=0,expanded=new Set(),failedCode='';
 const host=()=>document.getElementById('odoo-quote-pipeline-root');
 const monthlyCredits=createMonthlyCredits({request:monthlyCreditsRequest,isAuthenticated,onUpdated:()=>render()});
 const returnDeductions=createCommissionReturns({request:returnDeductionsRequest,isAuthenticated,onUpdated:()=>render()});
 const invoiceEvidence=typeof invoiceEvidenceRequest==='function'?
  createInvoiceEvidenceView({request:invoiceEvidenceRequest,isAuthenticated}):null;
 function reset(){epoch++;invoiceEvidence?.reset();returnDeductions.reset();monthlyCredits.reset();data=null;fallbackData=null;fallbackMonth=null;fallbackError='';fallbackLoading=false;loading=false;error='';failedCode='';stages=new Set(filters);company='all';search='';month=currentCommissionMonth();expanded.clear();host()?.replaceChildren()}
 async function load(force=false){
  if(!isAuthenticated()||loading)return;
  if((data||fallbackData)&&!force){render();return}
  const ticket=++epoch;invoiceEvidence?.reset();loading=true;error='';monthlyCredits.reset();void returnDeductions.load(month);render();
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
    invalid_catalog_evidence:'Le rapprochement catalogue ne correspond pas à la ligne source.',
    invalid_odoo_calculation:'Le détail de calcul ne correspond pas aux prix, coûts et montants de la ligne source.',
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
 function appendCatalogEvidence(target,evidence){
  if(!evidence)return;
  target.append(el('small','pipeline-catalog-evidence',evidence.source==='product_label_prefix'?
   'Code candidat '+evidence.sku+' lu entre crochets dans le libellé produit. Le champ SKU Odoo reste vide.':
   'Référence interne Odoo : '+evidence.sku+'.'));
  const status={found:'Code trouvé dans Kino',ambiguous:'Plusieurs entrées Kino pour ce code',
   not_found:'Code introuvable dans Kino',unavailable:'Catalogue Kino indisponible'};
  target.append(el('small','pipeline-catalog-evidence',status[evidence.status]+' · Société '+evidence.company+
   (evidence.catalogName?' · '+evidence.catalogName:'')+'.'));
  if(evidence.status==='found'){
   target.append(el('small','pipeline-catalog-evidence',
    'Catalogue actuel : coût '+(evidence.costEur===null?'absent':eur(evidence.costEur))+
    (evidence.costEur!==null&&evidence.costEur<=0?' (inutilisable pour le calcul)':'')+
    ' · Tarif '+(evidence.listPriceEur===null?'absent':eur(evidence.listPriceEur))+
    ' · Palier '+(evidence.tier||'absent')+'. Valeurs par unité catalogue ; coût historique à confirmer.'));
  }
 }
 function openOrder(orderId){
  const order=data?.orders.find(o=>o.id===orderId);if(!order)return;
  expanded.add(orderId);stages.add(order.stage);render();
  let card=host()?.querySelector('[data-order-id="'+orderId+'"]');
  if(!card){search=order.reference;render();card=host()?.querySelector('[data-order-id="'+orderId+'"]')}
  card?.scrollIntoView({behavior:'smooth',block:'start'});
  card?.querySelector('.pipeline-order-head')?.focus({preventScroll:true});
 }
 function drawReconciliation(target,orders){
  const groups=pipelineReconciliationGroups(orders);
  const review=reviewPointsForOrders(orders);
  const panel=el('section','pipeline-reconciliation');
  const count=groups.reduce((n,g)=>n+g.lines.length,0);
  panel.append(el('h3','',count?'Lignes à rapprocher · '+count:'Points à vérifier'),el('p','commission-month-detail',
   count?'Ces lignes restent non estimées. Les codes candidats servent au contrôle de la référence interne Odoo. Les coûts doivent être confirmés dans la source Kino.':
   'Aucune ligne non estimée dans cette sélection. Les contrôles de source et les exclusions restent distincts de la validation de rémunération.'));
  const controls=el('div','commission-review-controls'),exportButton=el('button','','Exporter les points à vérifier');
  exportButton.type='button';exportButton.disabled=loading||!!error||!isAuthenticated()||!data.sourceInputsRechecked||!review.points.length;
  const status=el('small','commission-month-detail',review.points.length+' point(s) à vérifier · '+review.ordersCount+
   ' document(s) concerné(s), dont '+review.pendingOrders+' devis et '+review.confirmedOrders+
   ' commande(s) confirmée(s) · '+review.unestimatedLines+' ligne(s) non estimée(s) · '+review.monetaryExclusions+
   ' exclusion(s) avec montant ou montant manquant.');
  status.setAttribute('role','status');
  exportButton.onclick=()=>{
   if(loading||error||!isAuthenticated())return;
   try{
    const output=createReviewCsv(data,{month,company,query:search});
    const url=URL.createObjectURL(new Blob([output.content],{type:'text/csv;charset=utf-8'}));
    const link=el('a');link.href=url;link.download=output.filename;document.body.append(link);
    link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),5000);
    status.textContent='Dossier préparé : '+output.points+' point(s), '+output.orders+
     ' document(s). Les montants de commande sont répétés par contrôle ; ne pas les additionner.';
   }catch{status.textContent='Dossier indisponible : actualise la lecture Odoo.'}
  };
  controls.append(exportButton,status);panel.append(controls);
  for(const group of groups){
   const card=el('details','pipeline-reconciliation-group');
   card.append(el('summary','',group.company+' · '+(group.sku||'SKU absent')+' · '+group.lines.length+' ligne(s)'));
   const body=el('div','pipeline-reconciliation-body');
   body.append(el('strong','',lineReasons[group.reason]||group.reason));
   body.append(el('p','commission-review-action',reviewAction(group.reason).instruction));
   appendCatalogEvidence(body,group.catalogEvidence);
   body.append(el('small','',
    (group.amountHT===null?'Montant HT non additionnable':money(group.amountHT,group.currency)+' HT'+
     (group.amountKnown<group.lines.length?' disponible (partiel)':''))+
    ' · '+group.confirmedLines+' ligne(s) confirmée(s), '+group.pendingLines+' en devis. Ce montant HT ne représente pas une commission.'));
   for(const line of group.lines){
    const row=el('div','pipeline-reconciliation-row');
    const button=el('button','',line.reference+' · Voir la commande');button.type='button';
    button.onclick=()=>openOrder(line.orderId);
    row.append(button,el('small','',line.client+' · Ligne '+line.lineId+' · Quantité '+
     (line.quantity??'—')+' · '+money(line.amountHT,line.currency)+' HT'));
    row.append(sourceOrderLink(line.orderId));
    body.append(row);
   }
   card.append(body);panel.append(card);
  }
  const other=review.points.filter(p=>p.scope!=='line_unestimated');
  if(other.length){
   const extra=el('details','commission-review-other');
   extra.append(el('summary','','Montants et exclusions à vérifier · '+other.length));
   const body=el('div','commission-review-other-body');
   for(const point of other){
    const row=el('article','commission-review-point'),o=point.order,l=point.line;
    row.append(el('strong','',o.reference+' · '+o.company+' · '+point.action.label),
     el('p','commission-review-action',point.action.instruction),
     el('small','',l?'Ligne '+l.id+' · '+l.product+' · '+money(l.subtotalHT,o.currency)+' HT':
      'Contrôle de la commande entière · '+money(o.amountHT,o.currency)+' HT'));
    const open=el('button','','Voir le détail de '+o.reference);open.type='button';open.onclick=()=>openOrder(o.id);
    row.append(open,sourceOrderLink(o.id));body.append(row);
   }
   extra.append(body);panel.append(extra);
  }
  if(!review.points.length)panel.append(el('p','commission-month-detail',
   'Aucun point technique détecté. Déclenchement à la confirmation et déduction des retours confirmés. Coûts historiques, SPIFF et exhaustivité des déductions restent à vérifier.'));
  target.append(panel);
 }
 function sourceOrderLink(id){
  const link=el('a','commission-source-link','Ouvrir la commande dans Odoo');
  link.href=odooRecordUrl('sale.order',id);link.target='_blank';link.rel='noopener noreferrer';return link;
 }
 function appendCalculation(target,line,suspended){
  const c=line.calculation;if(!c)return;
  const details=el('details','pipeline-calculation');
  details.append(el('summary','','Voir le calcul de cette ligne'));
  const rows=el('dl','pipeline-calculation-values');
  for(const [label,value] of [
   ['Prix net après remise',preciseEur(c.netUnitPrice)+'/unité Odoo'],
   ['Coût Kino rapproché',preciseEur(line.effectiveUnitCostEur)+'/unité Odoo'],
   ['Majoration du coût Kino',percent(c.costMultiplier-1)+' · Palier '+line.kinoTier],
   ['Coût ajusté',preciseEur(c.adjustedUnitCost)+'/unité Odoo'],
   ['Marge de calcul par unité',preciseEur(c.unitMargin)],
   ['Quantité Odoo',String(line.quantity)],
   ['Marge de calcul de la ligne',eur(c.margin)],
   ['Taux appliqué',percent(c.rate)],
   ['Estimation arrondie au centime',suspended?'Suspendue pour cette commande':eur(c.commission)]
  ])rows.append(el('dt','',label),el('dd','',value));
  details.append(rows,el('small','pipeline-hint',
   'Marge de calcul selon le simulateur Kino, fondée sur le coût catalogue actuel. SPIFF désactivé ; ce détail ne valide pas une rémunération.'));
  target.append(details);
 }
 function drawAuditControls(target,orders){
  const info=catalogueProvenance(data,orders),panel=el('details','pipeline-provenance');
  panel.append(el('summary','','Source des coûts et contrôles du calcul'));
  const body=el('div','pipeline-provenance-body');
  body.append(el('p','commission-month-detail','Capture Kino : '+timestamp(info.capturedAt)+
   (info.productsTotal?' · '+info.productsTotal+' produits':'')+
   (info.available===false?' · Catalogue indisponible pour cette lecture':'')+'.'));
  if(info.ageHours!==null)body.append(el('p','commission-month-detail',
   'Capture réalisée '+new Intl.NumberFormat('fr-FR',{maximumFractionDigits:1}).format(info.ageHours)+
   ' h avant la lecture Odoo.'));
  if(info.beforeCapture!==null)body.append(el('p','commission-month-detail',
   info.beforeCapture+' document(s) antérieur(s) au jour de capture, '+info.sameDay+
   ' le même jour, '+info.afterCapture+' après. Cette capture ne prouve pas les coûts à la date de vente.'));
  if(info.capturedAt&&!info.chronologyValid)body.append(el('p','commission-month-detail',
   'L’horodatage du catalogue ne peut pas être comparé à la lecture Odoo : provenance à vérifier.'));
  body.append(el('p','commission-month-detail',
   (data.sourceInputsRechecked?'Prix, remises, montants et statuts Odoo revérifiés pendant la lecture.':
    'La réponse disponible ne confirme pas la seconde lecture Odoo.')+
   ' Lecture : '+timestamp(info.readAt)+'. Calcul hors SPIFF, arrondi au centime par ligne. '+
   'Déclenchement confirmé : commande confirmée. Les commissions des retours sont déduites du total final. Coûts historiques, SPIFF et pièces de déduction restent à rapprocher.'));
  panel.append(body);target.append(panel);
  const exportPanel=el('div','commission-export-controls'),button=el('button','','Exporter le bilan CSV');
  button.type='button';button.disabled=loading||!!error||!data.sourceInputsRechecked||!orders.length;
  const status=el('small','commission-month-detail',
   'Export du mois sélectionné avec les filtres société et recherche : '+orders.length+
   ' document(s), devis et commandes séparés. Estimations des ventes avant déduction des retours ; les montants manquants ou suspendus restent vides.');
  status.setAttribute('role','status');
  button.onclick=()=>{
   if(loading||error||!isAuthenticated())return;
   try{
    const output=createCommissionCsv(data,{month,company,query:search});
    const url=URL.createObjectURL(new Blob([output.content],{type:'text/csv;charset=utf-8'}));
    const link=el('a');link.href=url;link.download=output.filename;document.body.append(link);
    link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),5000);
    status.textContent='Export préparé : '+output.orders+' document(s), '+output.lines+
     ' ligne(s). Montants provisoires, non payables.';
   }catch{status.textContent='Export indisponible : actualise la lecture Odoo.'}
  };
  exportPanel.append(button,status);target.append(exportPanel);
 }
 function drawCompanyBreakdown(target,orders){
  const table=el('table','commission-company-table');
  table.append(el('caption','','Répartition GTA / TR · estimations provisoires'));
  const head=el('tr');for(const label of ['Société','Devis potentiels','Commandes prévisionnelles'])head.append(el('th','',label));
  table.append(head);
  for(const code of ['GTA','TR'].filter(c=>company==='all'||company===c)){
   const row=el('tr');row.append(el('th','',code));
   for(const pending of [true,false]){
    const selected=orders.filter(o=>o.company===code&&(o.stage==='en_cours')===pending),totals=odooPipelineTotals(selected);
    const cell=el('td');cell.append(el('strong','',totals.forecastCount?eur(totals.forecast):'—'),
     el('small','',selected.length+' doc. · '+totals.forecastCount+' estimé(s)'));
    row.append(cell);
   }
   table.append(row);
  }
  target.append(table);
 }
 function orderCard(o){
  const wrap=el('article','pipeline-order');
  wrap.dataset.orderId=String(o.id);
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
  details.append(sourceOrderLink(o.id));
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
   appendCatalogEvidence(item,l.catalogEvidence);
   if(l.unitBasis&&l.effectiveUnitCostEur!==null){
    const basis=l.unitBasis==='pack_cost_divided_by_grams'?
     'Sachet Kino '+l.packSizeG+' g → coût converti au gramme':
     (l.packSizeG?'Sachet Kino '+l.packSizeG+' g → coût par sachet':'Même unité que le tarif catalogue Kino');
    item.append(el('small','pipeline-cost-detail',
     'Contrôle Kino : '+basis+' · Coût '+eur(l.effectiveUnitCostEur)+
     '/unité Odoo · Tarif catalogue '+eur(l.catalogUnitPriceEur)+
     '/unité Odoo · Palier '+l.kinoTier+'.'));
   }
   appendCalculation(item,l,o.issues.length>0);
   list.append(item);
  }
  details.append(list);
  if(invoiceEvidence)details.append(invoiceEvidence.render(o));
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
   target.append(monthlyCredits.render({month,company,query:search,recorded:returnDeductions.snapshot(month)}));
   return;
  }
  if(!data)target.append(el('p','commission-month-detail',
    'Source : rapport Odoo classique vérifié sur le mois. Documents réels, mais estimations de commissions suspendues car le calcul enrichi est indisponible.'+
    (monthlyData.excludedCount?' '+monthlyData.excludedCount+' document(s) annulé(s) exclus.':'')));
  const selected=data?selectedCommissionOrders(data,{month,company,query:search}):null;
  const summary=summarizeCommissionMonth(selected?{...monthlyData,orders:selected}:monthlyData,
   {month,company,query:data?'':search});
  const grid=el('div','commission-month-grid');
  grid.append(
   monthlyMetric('Devis non confirmés · potentiels',summary.pending,
    'Sous réserve de confirmation Odoo.'),
   monthlyMetric('Commandes confirmées · prévisionnelles',summary.confirmed,
    'Déclenchement à la confirmation ; comprend les commandes facturées, avant déduction des retours.')
  );
  const validated=el('article','commission-month-metric');
  validated.append(el('span','','Commission finale · après tous les retours'),
   el('strong','','Non disponible'),
   el('small','','Règles de confirmation et de déduction des retours établies. Le montant final attend le rapprochement des coûts, du SPIFF et de toutes les pièces de retour.'));
  grid.append(validated);
  target.append(grid);
  target.append(returnDeductions.render({month,company,query:search,confirmed:summary.confirmed,sourceFresh:!!data&&data.calculationVersion==='kino_browser_arithmetic_v1_cent_per_line'&&data.sourceInputsRechecked&&!loading&&!error,pipelineReadAt:monthlyData.readAt}));
  target.append(monthlyCredits.render({month,company,query:search,recorded:returnDeductions.snapshot(month),confirmed:summary.confirmed,sourceFresh:!!data&&data.sourceInputsRechecked&&data.calculationVersion==='kino_browser_arithmetic_v1_cent_per_line'&&!loading&&!error,pipelineReadAt:monthlyData.readAt,catalogSnapshotAt:data?.catalogSnapshotAt||null}));
  if(data){drawCompanyBreakdown(target,selected);drawAuditControls(target,selected)}
  if(data)drawReconciliation(target,[...summary.pending.orders,...summary.confirmed.orders]);
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
    if(data){const open=el('button','commission-month-open','Voir le détail');open.type='button';
     open.setAttribute('aria-label','Voir le détail de '+o.reference);open.onclick=()=>openOrder(o.id);
     left.append(open)}
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
   el('p','','La confirmation déclenche la commission. Les devis restent potentiels ; la commission des retours est déduite du total final.'));
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
    epoch++;invoiceEvidence?.reset();returnDeductions.reset();monthlyCredits.reset();loading=false;fallbackLoading=false;expanded.clear();
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
   'Le catalogue Kino est une photographie actuelle : coûts historiques, exclusions et SPIFF restent à vérifier. Les factures et avoirs se lisent séparément dans chaque commande ; leurs états ne valident pas une commission. '+
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
