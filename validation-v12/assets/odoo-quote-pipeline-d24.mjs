import {normalizeOdooPipeline,filterOdooPipeline,odooPipelineTotals,statusLabels} from './odoo-commission-model-d24.mjs';
import {COMMISSION_ISSUES,COMMISSION_RULE_STATUS} from './commission-integrity-d24.mjs';
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
 estimated_units_unverified:'Unité Odoo / Kino à vérifier'};
export function createOdooQuotePipeline({request,isActive,isAuthenticated}){
 let data=null,loading=false,error='',stages=new Set(filters),company='all',search='',epoch=0,expanded=new Set(),failedCode='';
 const host=()=>document.getElementById('odoo-quote-pipeline-root');
 function reset(){epoch++;data=null;loading=false;error='';failedCode='';stages=new Set(filters);company='all';search='';expanded.clear();host()?.replaceChildren()}
 async function load(force=false){
  if(!isAuthenticated()||loading)return;
  if(data&&!force){render();return}
  const ticket=++epoch;loading=true;error='';render();
  try{
   const response=await request();
   if(ticket!==epoch||!isAuthenticated())return;
   data=normalizeOdooPipeline(response.data);
  }catch(e){if(ticket===epoch){
   failedCode=typeof e?.message==='string'?e.message:'odoo_pipeline_unavailable';
   const labels={
    odoo_auth_failed:'La connexion du service à Odoo est refusée.',
    odoo_scope_too_large:'Le périmètre Odoo contient trop de données pour cette lecture.',
    odoo_state_changed:'Une commande a changé de statut en cours de lecture.',
    odoo_source_changed:'Une commande ou ses lignes ont changé pendant la lecture : actualise Odoo.',
    odoo_unreachable:'Odoo ne répond pas à la passerelle.',
    odoo_remote_error:'Odoo a refusé une des lectures de données.',
    odoo_not_configured:'La connexion Odoo de la passerelle n’est pas configurée.',
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
   error=(labels[failedCode]||'La lecture des devis Odoo a échoué.')+
    ' Code : '+(/^[a-z0-9_]{3,65}$/.test(failedCode)?failedCode:'erreur_reseau')+
    '. Les filtres restent utilisables ; aucun montant n’est inventé.';
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
      'Commission estimée : '+eur(l.commissionEstimate)+' · Unité et coût historique non vérifiés'):
      'Non estimée : '+(lineReasons[l.reason]||l.reason)));
   list.append(item);
  }
  details.append(list);
  const toOrder=el('p','pipeline-hint','Seuls les documents Odoo sont affichés. Ouvrir Commandes pour le contrôle mensuel détaillé. Aucun devis n’est ajouté ou modifié dans Odoo.');
  details.append(toOrder);wrap.append(details);
  trigger.onclick=()=>{if(expanded.has(o.id))expanded.delete(o.id);else expanded.add(o.id);
   details.hidden=!expanded.has(o.id);trigger.setAttribute('aria-expanded',String(expanded.has(o.id)))};
  return wrap;
 }
 function render(){
  if(!isActive())return;
  const root=host();if(!root)return;root.replaceChildren();
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
  root.append(el('p','pipeline-filter-intro','Inclure dans la liste (coche plusieurs statuts) :'));
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
  root.append(pills);
  if(loading)root.append(el('p','pipeline-hint','Actualisation Odoo en cours…'));
  if(error){const warn=el('p','pipeline-error',error);root.append(warn)}
  if(!data){
   root.append(el('p','pipeline-hint',
    'Les filtres sont prêts. Les compteurs et la liste apparaîtront dès qu’Odoo répondra ; réessaie avec « Actualiser Odoo ».'));
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
  q.oninput=()=>{search=q.value;const r=root.querySelector('.pipeline-result');if(r)drawRows(r)};
  controls.append(selector,q);root.append(controls);
  const result=el('div','pipeline-result');root.append(result);drawRows(result);
  root.append(el('p','pipeline-hint',
   'Périmètre : tous tes devis Odoo non confirmés, même anciens ; commandes confirmées des 365 derniers jours (depuis '+
   when(data.closedWindowFrom)+'). La mention facturée provient du champ invoice_status de la commande, pas d’une preuve de paiement. '+
   'Les commissions utilisent le dernier catalogue Kino disponible, sans validation du coût à la date de chaque vente. Unités, exclusions métier, SPIFF, avoirs et paiement restent à confirmer. Dernière lecture : '+when(data.readAt)+
   '. Catalogue : '+(data.catalogSnapshotAt?when(data.catalogSnapshotAt):'date indisponible')+'.'));
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
