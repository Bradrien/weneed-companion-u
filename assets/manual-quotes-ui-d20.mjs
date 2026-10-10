import {normalizeQuotes,quoteStats,prepareQuote,quoteStatusLabels} from './manual-quotes-d20.mjs';
const el=(tag,cls='',value)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(value!==undefined)n.textContent=String(value);return n};
const eur=n=>typeof n==='number'&&Number.isFinite(n)?
 new Intl.NumberFormat('fr-FR',{style:'currency',currency:'EUR',maximumFractionDigits:2}).format(n):'Non renseigné';
const STATUS=['en_cours','valide','facture','annule'];
const ERROR_LABELS={duplicate_reference:'Référence déjà présente : choisis une autre référence.',
 unknown_client_id:'Ce client CRM est introuvable.',quote_conflict_reload:'Ce devis a été modifié depuis sa dernière lecture. Recharge la liste avant de reprendre.',
 invalid_reference:'Référence requise (3 caractères minimum, lettres et chiffres).',
 invalid_client_name:'Indique le nom du client.',invalid_company:'Choisis GTA ou TR.',
 invalid_status:'Statut incorrect.',invalid_quote_date:'Date de devis incorrecte.',
 invalid_currency:'Montant incorrect : maximum deux décimales et aucune valeur négative.',
 invalid_amount_ht:'Montant HT incorrect.',invalid_commission_estimate:'Montant de commission incorrect.',
 invalid_expected_decision_at:'Date de décision incorrecte.',text_too_long:'Notes ou produits trop longs.',
 quote_service_unavailable:'Service des devis temporairement indisponible. Rien n’a été enregistré.',
 invalid_session:'Session expirée : reconnecte-toi.'};
export function createManualQuotes({request,isActive,isAuthenticated}){
 let quotes=null,loading=false,saving=false,error='',notice='',editId=null,formOpen=false,epoch=0;
 const root=()=>document.getElementById('manual-quotes-root');
 const empty=()=>({reference:'',client_name:'',quote_date:new Date().toISOString().slice(0,10),company:'GTA',
  status:'en_cours',amount_ht:'',commission_amount:'',expected_decision_at:'',products:'',notes:''});
 let values=empty();
 function reset(){epoch++;quotes=null;loading=false;saving=false;error='';notice='';editId=null;formOpen=false;values=empty();root()?.replaceChildren()}
 async function load(force=false){
  if(!isAuthenticated()||loading||saving)return;
  if(quotes!==null&&!force){render();return}
  const ticket=++epoch;loading=true;error='';notice='';render();
  try{
   const data=await request('GET');
   if(ticket!==epoch||!isAuthenticated())return;
   quotes=normalizeQuotes(data.quotes);
  }catch{
   if(ticket===epoch)error='Impossible de charger les devis manuels. Réessaie.';
  }finally{if(ticket===epoch){loading=false;render()}}
 }
 function startNew(){editId=null;values=empty();formOpen=true;error='';notice='';render()}
 function edit(q){
  editId=q.id;values={reference:q.reference,client_name:q.client_name,quote_date:q.quote_date,
   company:q.company,status:q.status,amount_ht:q.amount_ht===null?'':String(q.amount_ht),
   commission_amount:q.commission_amount===null?'':String(q.commission_amount),
   expected_decision_at:q.expected_decision_at||'',products:q.products||'',notes:q.notes||''};
  formOpen=true;error='';notice='';render();
 }
 function makeField(label,key,opts={}){
  const wrap=el('label','quote-field');wrap.append(el('span','',label));
  let input;
  if(opts.options){
   input=el('select');
   for(const [value,name] of opts.options){const opt=el('option','',name);opt.value=value;input.append(opt)}
   input.value=values[key];
  }else if(opts.multiline){
   input=el('textarea');input.rows=opts.rows||2;input.maxLength=opts.maxLength||400;
   input.value=values[key];
  }else{
   input=el('input');input.type=opts.type||'text';
   input.value=values[key];if(opts.maxLength)input.maxLength=opts.maxLength;
   if(opts.placeholder)input.placeholder=opts.placeholder;
   if(opts.type==='number'){input.min='0';input.step='0.01';input.inputMode='decimal'}
  }
  input.setAttribute('aria-label',label);
  input.addEventListener('input',()=>{values[key]=input.value;error=''});
  input.addEventListener('change',()=>{values[key]=input.value});
  wrap.append(input);return wrap;
 }
 async function submit(event){
  event?.preventDefault();if(saving||!isAuthenticated())return;
  let payload;
  try{payload=prepareQuote(values)}
  catch(e){error=ERROR_LABELS[e.message]||'Vérifie les champs du devis.';render();return}
  const expected=quotes?.find(x=>x.id===editId)?.updated_at;
  if(editId&&!expected){error='Version du devis introuvable : recharge la liste.';render();return}
  const ticket=++epoch;saving=true;error='';notice='';render();
  try{
   const result=await request('POST',{action:editId?'update':'create',quote:payload,
    ...(editId?{id:editId,expected_updated_at:expected}:{})});
   if(ticket!==epoch||!isAuthenticated())return;
   quotes=normalizeQuotes(
    editId?quotes.map(x=>x.id===editId?result.quote:x):[result.quote,...(quotes||[])]);
   notice=editId?'Devis modifié dans Companion. Aucun changement dans Odoo.':
    'Devis ajouté dans Companion. Commission prévisionnelle non acquise.';
   formOpen=false;editId=null;values=empty();
  }catch(e){
   if(ticket!==epoch)return;
   error=ERROR_LABELS[e?.message]||'Enregistrement impossible. Aucune donnée modifiée.';
  }finally{if(ticket===epoch){saving=false;render()}}
 }
 function fieldCard(label,value,sub){
  const card=el('article','quote-stat');
  card.append(el('span','',label),el('strong','',value),el('small','',sub));return card;
 }
 function render(){
  if(!isActive())return;
  const host=root();if(!host)return;host.replaceChildren();
  const header=el('div','quote-heading');
  header.append(el('h3','','Devis commerciaux en cours'),
   el('p','quote-hint','Suivi manuel des propositions non encore commandées. Les devis n’entrent jamais dans les commissions confirmées.'));
  const actions=el('div','quote-header-actions');
  const add=el('button','secondary-button','+ Ajouter un devis');add.type='button';add.disabled=saving;add.onclick=startNew;
  const refresh=el('button','secondary-button','Actualiser');refresh.type='button';refresh.disabled=loading||saving;
  refresh.onclick=()=>load(true);actions.append(add,refresh);header.append(actions);host.append(header);
  if(loading)host.append(el('p','quote-hint','Chargement des devis…'));
  if(notice)host.append(el('p','quote-success',notice));
  if(error)host.append(el('p','quote-error',error));
  if(quotes!==null){
   const s=quoteStats(quotes);
   const summary=el('div','quote-stats');
   summary.append(fieldCard('Devis en cours',String(s.pendingCount),'Non commandés'),
    fieldCard('CA HT potentiel',eur(s.pendingHtKnown?s.pendingHt:null),
     s.pendingHtKnown+'/'+s.pendingCount+' montants renseignés'),
    fieldCard('Commission prévisionnelle',eur(s.forecastKnown?s.forecastCommission:null),
     s.forecastKnown+'/'+s.pendingCount+' estimations manuelles'),
    fieldCard('Validés / Facturés',s.validatedCount+' / '+s.invoicedCount,
     'Statuts déclaratifs, pas de preuve Odoo'));
   host.append(summary);
  }
  if(formOpen){
   const form=el('form','quote-form');
   const header=el('div','quote-form-header');
   header.append(el('h4','',editId?'Modifier le devis':'Nouveau devis'));
   const cancel=el('button','secondary-button','Fermer');cancel.type='button';cancel.disabled=saving;
   cancel.onclick=()=>{formOpen=false;error='';render()};header.append(cancel);form.append(header);
   const fields=el('div','quote-fields');
   fields.append(makeField('Référence unique du devis','reference',{placeholder:'DEV-2026-010',maxLength:75}),
    makeField('Client / boutique','client_name',{placeholder:'Nom commercial',maxLength:160}),
    makeField('Société','company',{options:[['GTA','GTA'],['TR','Trim Rocket']]}),
    makeField('Date du devis','quote_date',{type:'date'}),
    makeField('Statut','status',{options:STATUS.map(s=>[s,quoteStatusLabels[s]])}),
    makeField('Décision attendue (facultatif)','expected_decision_at',{type:'date'}),
    makeField('Montant HT du devis (€)','amount_ht',{type:'number',placeholder:'Montant en EUR'}),
    makeField('Commission prévue (€) — optionnel','commission_amount',{type:'number',placeholder:'Estimation saisie manuellement'}),
    makeField('Produits / quantités proposés','products',{multiline:true,maxLength:450}),
    makeField('Notes de négociation','notes',{multiline:true,maxLength:1200,rows:3}));
   form.append(fields);
   form.append(el('p','quote-hint','Aucun envoi client et aucune création de devis Odoo. La commission est saisie manuellement ; elle ne devient pas acquise lorsque le statut change.'));
   const save=el('button','primary-button',saving?'Enregistrement…':editId?'Enregistrer les modifications':'Ajouter le devis');
   save.type='submit';save.disabled=saving;form.append(save);
   form.addEventListener('submit',submit);host.append(form);
  }
  if(quotes===null)return;
  if(!quotes.length){host.append(el('p','quote-hint','Aucun devis saisi. Appuie sur « Ajouter un devis » pour commencer.'));return}
  const headings=el('div','quote-pipeline');
  const now=new Date().toISOString().slice(0,10);
  for(const status of STATUS){
   const group=quotes.filter(q=>q.status===status);
   const panel=el('details','quote-group');panel.open=status==='en_cours';
   panel.append(el('summary','',quoteStatusLabels[status]+' · '+group.length));
   for(const q of group){
    const row=el('article','quote-row');
    const top=el('div','quote-row-top');
    top.append(el('strong','',q.reference+' · '+q.company),
     el('small','',q.quote_date+' · '+q.client_name));row.append(top);
    row.append(el('p','',eur(q.amount_ht)+' HT · commission prévisionnelle : '+eur(q.commission_amount)));
    if(q.expected_decision_at)row.append(el('small','', 'Décision attendue le '+q.expected_decision_at+
     (status==='en_cours'&&q.expected_decision_at<now?' · À relancer':'')));
    if(q.products)row.append(el('p','quote-products',q.products));
    if(q.notes){const note=el('details','quote-note');note.append(el('summary','','Voir les notes'));note.append(el('p','',q.notes));row.append(note)}
    const editBtn=el('button','secondary-button','Modifier');editBtn.type='button';editBtn.disabled=saving;
    editBtn.onclick=()=>edit(q);row.append(editBtn);panel.append(row);
   }
   headings.append(panel);
  }
  host.append(headings);
 }
 return {load,render,reset};
}
