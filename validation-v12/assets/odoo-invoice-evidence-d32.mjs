/** Separate accounting evidence; never allocated to commission or order totals. */
const sourceNumber=x=>x===null||typeof x==='number'&&Number.isFinite(x);
const paymentLabels=Object.freeze({not_paid:'Non payé (Odoo)',in_payment:'Paiement en cours (Odoo)',
 paid:'Indiqué payé dans Odoo',partial:'Paiement partiel (Odoo)',reversed:'Contre-passé (Odoo)',
 invoicing_legacy:'État historique Odoo',blocked:'Bloqué (Odoo)',unknown:'Paiement non renseigné'});
const issueLabels={missing_document_amount:'Montant comptable incomplet',payment_residual_mismatch:'État payé et solde restant incohérents',
 unposted_payment_indicator:'Indication payé sur un document non comptabilisé',missing_payment_state:'Statut de paiement manquant'};
export function normalizeInvoiceEvidence(input,{orderId,company}){
 const o=input?.order;
 if(!input||input.version!=='odoo_invoice_evidence_v1'||input.source_rechecked!==true||
  input.scope!=='seller_linked_invoices_and_direct_reversals_read_only_rechecked'||
  input.payment_semantics!=='account_move_state_payment_state_residual_not_commission_entitlement'||
  input.document_amounts_attributed_to_order!==false||input.commission_payable!==false||
  typeof input.read_at!=='string'||!Number.isFinite(Date.parse(input.read_at))||!o||o.id!==orderId||o.company!==company||
  !['GTA','TR'].includes(company)||typeof o.reference!=='string'||typeof o.invoice_status!=='string'||
  !['draft','sent','sale','done','cancel'].includes(o.state)||typeof o.currency!=='string'||
  !/^[A-Z]{3}$/.test(o.currency)||!sourceNumber(o.amount_ht)||
  !Array.isArray(input.documents)||input.documents.length>60)throw Error('invalid_invoice_evidence');
 const ids=new Set();
 const documents=input.documents.map(d=>{
  if(!d||!Number.isSafeInteger(d.id)||d.id<1||ids.has(d.id)||typeof d.reference!=='string'||
   !['order_invoice_link','direct_reversal'].includes(d.origin)||!['invoice','credit_note'].includes(d.kind)||
   !['draft','posted','cancel'].includes(d.state)||typeof d.payment_state!=='string'||!/^[a-z_]{1,30}$/.test(d.payment_state)||
   typeof d.currency!=='string'||!/^[A-Z]{3}$/.test(d.currency)||
   ![d.amount_ht,d.amount_total,d.amount_residual].every(sourceNumber)||
   d.reverses_id!==null&&(!Number.isSafeInteger(d.reverses_id)||d.reverses_id<1)||
   !Array.isArray(d.issues)||new Set(d.issues).size!==d.issues.length||
   d.issues.some(x=>!Object.hasOwn(issueLabels,x))||
   d.date!==null&&(typeof d.date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(d.date)||
    !Number.isFinite(Date.parse(d.date+'T00:00:00Z'))||new Date(d.date+'T00:00:00Z').toISOString().slice(0,10)!==d.date))
    throw Error('invalid_invoice_evidence');
  ids.add(d.id);
  const issues=[];
  if([d.amount_ht,d.amount_total,d.amount_residual].some(x=>x===null))issues.push('missing_document_amount');
  if(d.payment_state==='paid'&&(d.amount_residual===null||Math.abs(d.amount_residual)>0.000001))issues.push('payment_residual_mismatch');
  if(d.payment_state==='paid'&&d.state!=='posted')issues.push('unposted_payment_indicator');
  if(d.issues.includes('missing_payment_state')&&d.payment_state==='unknown')issues.push('missing_payment_state');
  if(issues.length!==d.issues.length||issues.some(x=>!d.issues.includes(x)))throw Error('invalid_invoice_evidence');
  const paid=d.kind==='invoice'&&d.state==='posted'&&d.payment_state==='paid'&&!issues.length;
  if(d.odoo_paid_indicator!==paid)throw Error('invalid_invoice_evidence');
  return {id:d.id,reference:d.reference.slice(0,120),origin:d.origin,kind:d.kind,state:d.state,
   paymentState:d.payment_state,paymentLabel:Object.hasOwn(paymentLabels,d.payment_state)?paymentLabels[d.payment_state]:
    'Statut Odoo : '+d.payment_state,currency:d.currency,date:d.date,amountHT:d.amount_ht,
   amountTotal:d.amount_total,residual:d.amount_residual,reversesId:d.reverses_id,issues,odooPaidIndicator:paid};
 });
 const invoiceIds=new Set(documents.filter(d=>d.kind==='invoice').map(d=>d.id));
 if(documents.some(d=>d.origin==='direct_reversal'&&(d.kind!=='credit_note'||!invoiceIds.has(d.reversesId)))||
  documents.filter(d=>d.kind==='invoice').length!==input.invoice_count||
  documents.filter(d=>d.kind==='credit_note').length!==input.credit_note_count||
  documents.filter(d=>d.odooPaidIndicator).length!==input.odoo_paid_invoice_count)throw Error('invalid_invoice_evidence');
 return {order:{id:o.id,reference:o.reference.slice(0,120),company,state:o.state,invoiceStatus:o.invoice_status,
  currency:o.currency,amountHT:o.amount_ht},documents,readAt:input.read_at,
  invoiceCount:input.invoice_count,creditNoteCount:input.credit_note_count,paidInvoiceCount:input.odoo_paid_invoice_count,
  amountsAttributedToOrder:false,commissionPayable:false};
}
const el=(tag,cls='',value)=>{const n=document.createElement(tag);if(cls)n.className=cls;
 if(value!==undefined)n.textContent=String(value);return n};
const money=(value,currency)=>value===null?'Non renseigné':new Intl.NumberFormat('fr-FR',{
 style:'currency',currency,maximumFractionDigits:2}).format(value);
export function createInvoiceEvidenceView({request,isAuthenticated}){
 const cache=new Map();let epoch=0;
 const reset=()=>{epoch++;cache.clear()};
 function render(order){
  const panel=el('section','invoice-evidence-panel'),body=el('div','invoice-evidence-body');
  panel.dataset.invoiceOrderId=String(order.id);
  panel.append(el('h4','','Factures et avoirs liés dans Odoo'));
  const button=el('button','','Lire les factures Odoo');button.type='button';
  panel.append(button,body);
  const state=cache.get(order.id)||{data:null,error:'',loading:false,draw:null};cache.set(order.id,state);
  function draw(){
   body.replaceChildren();button.disabled=state.loading||!isAuthenticated();
   button.textContent=state.loading?'Lecture des factures…':state.data?'Actualiser les factures Odoo':'Lire les factures Odoo';
   if(state.error){const p=el('p','pipeline-error',state.error);p.setAttribute('role','alert');body.append(p)}
   if(!state.data){body.append(el('p','pipeline-hint',state.loading?
    'Lecture et seconde vérification des documents comptables…':
    'Lecture séparée des factures liées à cette commande et des avoirs qui les contre-passent.'));return}
   const data=state.data;
   body.append(el('p','pipeline-hint',data.invoiceCount+' facture(s) · '+data.creditNoteCount+
    ' avoir(s) · '+data.paidInvoiceCount+' facture(s) indiquée(s) payée(s) dans Odoo.'));
   if(data.order.state!==order.state||data.order.invoiceStatus!==order.invoiceStatus||data.order.amountHT!==order.amountHT)
    body.append(el('p','pipeline-error','La commande a changé depuis le bilan. Actualise le mois avant de comparer les montants.'));
   if(!data.documents.length)body.append(el('p','pipeline-hint','Aucun document comptable lié à cette commande dans la lecture revérifiée.'));
   for(const d of data.documents){
    const card=el('article','invoice-evidence-document');
    card.append(el('strong','',(d.kind==='credit_note'?'Avoir':'Facture')+' · '+d.reference),
     el('small','',({draft:'Brouillon',posted:'Comptabilisé',cancel:'Annulé'})[d.state]+' · '+d.paymentLabel+
      (d.date?' · '+new Date(d.date+'T12:00:00Z').toLocaleDateString('fr-FR'):'')),
     el('small','',money(d.amountHT,d.currency)+' HT · Total document '+money(d.amountTotal,d.currency)+
      ' · Solde restant '+money(d.residual,d.currency)));
    if(d.reversesId){const original=data.documents.find(x=>x.id===d.reversesId);
     card.append(el('small','',original?'Contre-passe : '+original.reference:'Document contre-passé : ID '+d.reversesId));}
    for(const issue of d.issues)card.append(el('small','pipeline-error',issueLabels[issue]));
    body.append(card);
   }
   body.append(el('p','pipeline-hint','Documents revérifiés le '+new Date(data.readAt).toLocaleString('fr-FR',{
    dateStyle:'short',timeStyle:'short'})+'. Les montants portent sur les documents complets, qui peuvent couvrir plusieurs commandes. '+
    'Ils ne sont pas attribués à cette commande. Un état payé dans Odoo ne valide pas une commission.'));
  }
  state.draw=draw;
  button.onclick=async()=>{
   if(state.loading||!isAuthenticated())return;
   const ticket=epoch;state.loading=true;state.error='';state.data=null;state.draw();
   try{
    const response=await request(order.id);
    if(ticket!==epoch||!isAuthenticated())return;
    state.data=normalizeInvoiceEvidence(response.data||response,{orderId:order.id,company:order.company});
   }catch(error){if(ticket===epoch&&isAuthenticated()){
    const code=typeof error?.message==='string'?error.message:'';
    const labels={odoo_source_changed:'Un document a changé pendant la lecture. Réessaie.',
     order_not_accessible:'Cette commande n’est plus accessible dans le périmètre commercial.',
     odoo_invoice_read_refused:'Odoo a refusé la lecture des factures avec le compte du service.',
     invoices_not_accessible:'Toutes les factures liées n’ont pas pu être vérifiées.',
     invoice_scope_limit:'Trop de documents liés pour cette lecture bornée.',
     invoice_scope_mismatch:'Les documents ne correspondent pas au périmètre attendu.',
     invalid_invoice_evidence:'La réponse comptable est incohérente : lecture suspendue.',
     invalid_session:'Session expirée : reconnecte-toi.',owner_only:'Accès propriétaire requis.'};
    state.error=labels[code]||'La lecture des factures Odoo est indisponible. Réessaie.';
   }}finally{if(ticket===epoch&&isAuthenticated()){state.loading=false;state.draw?.()}}
  };
  draw();return panel;
 }
 return {render,reset};
}
