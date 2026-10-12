import {normalizeMonthlyCredits,filterMonthlyCredits,proposedBalanceWithCredits} from './monthly-credit-model-d38.mjs?v=v1-1';
import {odooRecordUrl} from './odoo-links-d33.mjs';
const el=(tag,text,cls='')=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n};
const money=(n,currency='EUR')=>typeof n==='number'&&Number.isFinite(n)?new Intl.NumberFormat('fr-FR',{style:'currency',currency}).format(n):'Montant absent';
const reasonText={not_eligible:'Livraison ou échantillon hors base de commission',conflicting_original_invoice_reference:'La référence de note contredit le lien natif de facture',multiple_original_invoice_references:'Plusieurs factures citées : affectation à établir',ambiguous_original_invoice_reference:'Référence de facture non unique',original_invoice_reference_not_accessible:'Facture citée non accessible dans le périmètre',not_product_line:'Section ou note hors produit',multiple_sale_lines:'Plusieurs lignes de vente liées : répartition à établir',
 missing_original_invoice_link:'Facture d’origine non liée ou inaccessible',original_invoice_scope_mismatch:'Périmètre de facture d’origine incohérent',
 ambiguous_original_invoice_lines:'Plusieurs lignes de facture d’origine correspondent',missing_original_invoice_line:'Ligne de facture d’origine non identifiée',
 credit_amount_unverified:'Montant de l’avoir absent',credit_line_total_mismatch:'Total de l’avoir différent de ses lignes',credit_not_posted:'Avoir non comptabilisé',
 not_eur:'Devise hors calcul EUR',original_sale_not_accessible:'Ligne de vente d’origine non accessible au commercial',
 original_sale_scope_mismatch:'Vente d’origine hors périmètre confirmé',product_identity_mismatch:'Produit différent de la vente d’origine',
 unit_identity_unverified:'Unité de retour différente ou non vérifiée',invalid_refund_amount:'Quantité, prix ou remise inutilisable',
 return_quantity_exceeds_sale:'Quantité retournée du mois supérieure à la vente',refund_price_mismatch:'Montant remboursé différent du prix net d’origine',
 missing_odoo_sku:'SKU Odoo absent',catalog_unavailable:'Catalogue Kino indisponible',ambiguous_sku:'SKU Kino ambigu',missing_kino_match:'SKU absent de Kino',
 invalid_kino_cost_or_tier:'Coût ou catégorie Kino inutilisable',unverified_unit_scale:'Coût par gramme ou sachet non établi',invalid_calculation:'Calcul non vérifiable'};
const link=(model,id,label)=>{const a=el('a',label,'commission-source-link');a.href=odooRecordUrl(model,id);a.target='_blank';a.rel='noopener noreferrer';return a};
export function createMonthlyCredits({request,isAuthenticated,onUpdated}){
 let data=null,loading=false,error='',selectedMonth=null,epoch=0;
 function reset(){epoch++;data=null;loading=false;error='';selectedMonth=null}
 async function open(month){
  if(loading||!isAuthenticated()||typeof request!=='function')return;
  const ticket=++epoch;selectedMonth=month;data=null;error='';loading=true;onUpdated?.();
  try{const response=await request(month);if(ticket!==epoch||!isAuthenticated())return;data=normalizeMonthlyCredits(response,month)}
  catch(e){if(ticket===epoch){error=e?.message==='odoo_source_changed'?
   'Une source Odoo a changé pendant la lecture. Relance le rapprochement.':
   'Le rapprochement des avoirs est indisponible. Les déductions enregistrées restent séparées ; aucune estimation d’avoir n’est ajoutée.'}}
  finally{if(ticket===epoch){loading=false;onUpdated?.()}}
 }
 function render({month,company,query,recorded=null,confirmed=null,sourceFresh=false,pipelineReadAt=null,catalogSnapshotAt=null}){
  const panel=el('section',undefined,'monthly-credit-panel');
  panel.append(el('h3','Rapprocher les avoirs Odoo du mois'),el('p',
   'Avoirs attribués à ton commercial Odoo, selon la date de l’avoir. La ligne de vente d’origine peut appartenir à un autre mois.','commission-month-detail'));
  const button=el('button',loading?'Lecture Odoo…':'Lire les avoirs du mois','secondary-button');button.type='button';
  button.disabled=loading||!isAuthenticated()||typeof request!=='function';button.onclick=()=>open(month);panel.append(button);
  if(loading){panel.append(el('p','Vérification des avoirs, lignes et liens d’origine…','commission-month-detail'));return panel}
  if(error){panel.append(el('p',error,'pipeline-error'));return panel}
  if(!data||selectedMonth!==month){panel.append(el('p','La lecture se lance à la demande.','commission-month-detail'));return panel}
  const now=Date.now(),stamp=Date.parse(data.readAt),fresh=Number.isFinite(stamp)&&stamp<=now+300000&&now-stamp<=900000;
  const documents=filterMonthlyCredits(data,{company,query});
  panel.append(el('p',documents.length+' avoir(s) dans cette sélection, sur '+data.documents.length+' lu(s). '+
   'Lecture du '+new Date(data.readAt).toLocaleString('fr-FR')+'.'+(fresh?'':' Dernière lecture ancienne : relance Odoo.'),'commission-month-detail'));
  const balance=proposedBalanceWithCredits(confirmed,recorded,data,{month,company,query,sourceFresh,pipelineReadAt,catalogSnapshotAt});
  const proposal=el('div',undefined,'monthly-credit-net');
  proposal.append(el('span','Simulation du solde avec les avoirs rapprochés'),el('strong',balance.available?money(balance.netCents/100):'Non calculé'));
  if(balance.available)proposal.append(el('small','Base confirmée estimée '+money(balance.grossCents/100)+' − déductions enregistrées '+money(balance.registeredCents/100)+' − avoirs rapprochés estimés '+money(balance.candidateCents/100)+'.'),
   el('small','Simulation partielle : '+balance.unresolvedLines+' ligne(s) d’avoir à rapprocher, '+balance.skippedCandidates+' estimation(s) non ajoutée(s) car une déduction est déjà renseignée pour la commande.'+(balance.basePartial?' La base de ventes comporte aussi des estimations manquantes ou partielles.':'')));
  else proposal.append(el('small',balance.reason==='search_scope'?'Efface la recherche pour comparer le mois complet.':balance.reason==='catalog_snapshot_mismatch'?'Les ventes et avoirs utilisent deux captures Kino différentes. Relis le bilan puis les avoirs.':'Relis le bilan et les déductions avant de comparer leurs montants.'));
  panel.append(proposal);
  if(!documents.length)panel.append(el('p',data.documents.length?
   'Aucun avoir lu ne correspond aux filtres actuels.':'Aucun avoir attribué à ton commercial dans ce mois et ce périmètre. Les retours non documentés par un avoir ne sont pas couverts.','commission-month-detail'));
  for(const d of documents){
   const card=el('article',undefined,'monthly-credit-document');
   card.append(el('h4',d.reference+' · '+d.company),el('p',[d.client,d.date,({posted:'Comptabilisé',draft:'Brouillon',cancel:'Annulé'}[d.state])].join(' · '),'commission-month-detail'),
    el('p','Montant de l’avoir : '+money(d.amount_ht,d.currency)+' HT.','commission-month-detail'),link('account.move',d.id,'Ouvrir l’avoir dans Odoo'));
   if(d.original_invoice)card.append(el('p','Facture d’origine : '+d.original_invoice.reference+(d.original_invoice.link_kind==='native_reversal'?' · lien natif Odoo':' · référence exacte citée dans la note de l’avoir'),'commission-month-detail'),link('account.move',d.original_invoice.id,'Ouvrir la facture d’origine'));
   else if(d.explicit_invoice_references.length)card.append(el('p','Facture(s) citée(s) : '+d.explicit_invoice_references.join(', '),'commission-month-detail'));
   if(d.original_invoice?.lines?.length){
    const originalDetails=el('details');originalDetails.append(el('summary','Comparer les lignes de la facture d’origine'));
    originalDetails.append(el('p','Facture entière du '+d.original_invoice.date+' : '+money(d.original_invoice.amount_ht,d.original_invoice.currency)+' HT. Ces montants ne sont pas des commissions.','commission-month-detail'));
    for(const o of d.original_invoice.lines)originalDetails.append(el('p',(o.product||'Ligne sans libellé')+(o.sku?' · '+o.sku:' · SKU absent')+' · '+(o.quantity??'—')+' '+o.unit+' · '+money(o.subtotal_ht,d.original_invoice.currency)+' HT · '+o.sale_link_count+' lien(s) vers des lignes de vente.','commission-month-detail'));
    card.append(originalDetails);
   }
   if(d.origin_reference||d.external_reference)card.append(el('p','Références Odoo : '+[d.origin_reference,d.external_reference].filter(Boolean).join(' · '),'commission-month-detail'));
   if(d.note)card.append(el('p','Note de l’avoir : '+d.note,'commission-month-detail'));
   for(const l of d.lines){
    const line=el('section',undefined,'monthly-credit-line');line.append(el('strong',(l.product||'Ligne sans libellé')+(l.sku?' · '+l.sku:'')),
     el('p',(l.quantity??'Quantité absente')+' '+l.unit+' · '+money(l.subtotal_ht,d.currency)+' HT','commission-month-detail'));
    if(l.original){
     const o=l.original;line.append(el('p','Vente d’origine : '+o.reference+' · '+o.date+' · ligne '+o.line_id+'.','commission-month-detail'),
      link('sale.order',o.order_id,'Ouvrir la commande d’origine'));
     const matching=recorded?.deductions.filter(r=>r.month===month&&r.company===d.company&&r.reference===o.reference)||[];
     if(matching.length)line.append(el('p','Une déduction Excel est déjà renseignée pour cette commande et ce mois. Vérifie la pièce avant d’ajouter un retrait.','commission-month-detail'));
    }
    if(l.listing_identity||l.listing_match)line.append(el('small','Libellé rapproché'+(l.listing_match?' · '+l.listing_match.catalog_sku:''),'v1-compact-matching'));
    if(l.deduction_estimate_cents!==null&&fresh){
     line.append(el('p','Commission à retirer estimée : −'+money(l.deduction_estimate_cents/100),'monthly-credit-estimate'));
     const details=el('details');details.append(el('summary','Voir le calcul de la déduction'));
     const c=l.original_calculation,o=l.original;
     details.append(el('p','Estimation de la ligne de vente : '+money(c.commission)+'. Quantité retournée '+l.quantity+' / quantité vendue '+o.quantity+
      '. Déduction arrondie au centime : '+money(l.deduction_estimate_cents/100)+'.','commission-month-detail'),
      el('p','Coût Kino actuel rapproché : '+money(l.effective_unit_cost_eur)+' par unité Odoo · catégorie '+l.kino_tier+
       '. Capture : '+(data.catalogSnapshotAt?new Date(data.catalogSnapshotAt).toLocaleString('fr-FR'):'non renseignée')+'. SPIFF exclu ; coût historique à vérifier.','commission-month-detail'));
     line.append(details);
    }else line.append(el('p',fresh?'Déduction à rapprocher : '+(reasonText[l.reason]||'Source non exploitable'):
     'Estimation suspendue : lecture ancienne à actualiser.','commission-month-detail'));
    card.append(line);
   }
   panel.append(card);
  }
  panel.append(el('p','La simulation avec les avoirs rapprochés reste distincte du solde fondé sur les déductions enregistrées. Chaque pièce, coût historique et doublon doit être rapproché pour établir le montant final.','commission-month-detail'));
  return panel;
 }
 return {reset,open,render};
}
