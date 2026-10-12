import {normalizeSamplePage,normalizeSampleReply,sampleLabels,sampleTransitions} from './sample-model-v2.mjs';
import {normalizeClientList,validClientId} from './clients-model-d14.mjs';
import {localDateTime,dueInstant} from './tasks-d36.mjs';
const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n};
const button=(text,fn,cls='inline-button')=>{const b=el('button',text,cls);b.type='button';b.onclick=fn;return b};
const message=code=>({sample_conflict:'Ce dossier a changé. Actualise avant de le modifier.',invalid_transition:'Ce statut ne correspond plus au dossier.',client_not_found:'Ce client n’existe plus.',idempotency_conflict:'Cet enregistrement a déjà été utilisé.',invalid_products:'Indique les produits et quantités.',invalid_follow_up:'La date de relance est incorrecte.'})[code]||'Lecture ou enregistrement non confirmé. Réessaie.';
const when=x=>x?new Date(x).toLocaleString('fr-FR',{dateStyle:'short',timeStyle:'short'}):'Non prévue';
export function createSamples({request,clientRequest,isAuthenticated,isActive,onClient,onFollowUp}){
 const s={rows:[],total:0,counts:null,checked:null,status:'ACTIVE',query:'',offset:0,clientId:null,clientName:'',loading:false,busy:false,error:'',notice:'',retry:null,epoch:0,session:0,operation:0};
 let host,editor,feedback,summary,list,search,status,scope,scopeAll,newButton,reload,prev,next,clientEpoch=0,searchTimer,clientTimer;
 const currentRow=row=>s.rows.some(x=>x.id===row.id&&x.updated_at===row.updated_at);
 const disabled=()=>s.busy||s.loading||!!s.retry;
 function clearRead(){s.epoch++;s.rows=[];s.total=0;s.counts=null;s.checked=null;s.error='';s.notice='';s.loading=true;render()}
 async function load({afterMutation=false}={}){
  if(!isAuthenticated()||s.busy&&!afterMutation)return;
  const wanted={status:s.status,clientId:s.clientId,offset:s.offset},ticket=++s.epoch;s.loading=true;s.error='';render();
  try{const body=await request('?status='+wanted.status+'&offset='+wanted.offset+'&q='+encodeURIComponent(s.query)+(wanted.clientId?'&client_id='+wanted.clientId:''));
   if(ticket!==s.epoch||!isAuthenticated())return;const page=normalizeSamplePage(body,wanted);s.rows=page.rows;s.total=page.total;s.counts=page.counts;s.checked=page.checked;
  }catch(e){if(ticket===s.epoch)s.error=message(e.message)}finally{if(ticket===s.epoch){s.loading=false;render()}}
 }
 function focusClient(id,name=''){
  if(s.busy||s.retry||id!==null&&!validClientId(id))return false;
  clearTimeout(searchTimer);clearTimeout(clientTimer);clientEpoch++;editor?.replaceChildren();
  s.clientId=id;s.clientName=String(name).slice(0,1000);s.query='';s.offset=0;s.status='ACTIVE';
  if(search)search.value='';if(status)status.value='ACTIVE';clearRead();return true;
 }
 function pending(){editor?.querySelectorAll('input,select,textarea,button').forEach(n=>n.disabled=s.busy||!!s.retry)}
 async function mutate(body){
  if(s.busy||s.loading||s.retry&&s.retry!==body||!isAuthenticated())return;
  const session=s.session,operation=++s.operation,current=()=>session===s.session&&operation===s.operation&&isAuthenticated();
  clientEpoch++;clearTimeout(clientTimer);s.busy=true;s.retry=body;s.error='';s.notice='';pending();render();
  try{const reply=await request('',{method:'POST',body:JSON.stringify(body)});if(!current())return;normalizeSampleReply(reply,body);
   s.retry=null;editor.replaceChildren();s.notice='Dossier enregistré.';s.offset=0;await load({afterMutation:true});
  }catch(e){if(current()){s.error=message(e.message);if(/^[a-z][a-z0-9_]+$/.test(e.message)&&e.message!=='samples_unavailable'){
    s.retry=null;if(['sample_conflict','invalid_transition'].includes(e.message))editor.replaceChildren();
   }}}
  finally{if(current()){s.busy=false;pending();render()}}
 }
 function move(row,value){if(!currentRow(row)||!sampleTransitions[row.status].includes(value))return;
  return mutate({request_id:crypto.randomUUID(),action:'move',sample_id:row.id,expected_version:row.updated_at,payload:{status:value}});
 }
 function field(form,label,type,value='',max){const wrap=el('label',label,'task-field'),input=el(type==='textarea'?'textarea':'input');if(type!=='textarea')input.type=type;
  input.value=value;if(max)input.maxLength=max;wrap.append(input);form.append(wrap);return input;
 }
 function edit(row=null){
  if(disabled()||!isAuthenticated()||row&&!currentRow(row))return;
  clientEpoch++;clearTimeout(clientTimer);editor.replaceChildren();const form=el('form',undefined,'task-editor sample-editor');form.append(el('h3',row?'Modifier les échantillons':'Préparer des échantillons'));
  const initialId=row?.client_id||s.clientId,initialName=row?.client_name||s.clientName;
  const select=el('select');select.setAttribute('aria-label','Client des échantillons');select.required=true;
  select.append(new Option('Choisir un client',''));if(initialId)select.append(new Option(initialName||'Client sélectionné',initialId,true,true));
  if(row){select.disabled=true;form.append(el('p',initialName,'sample-client-name'))}
  else{const query=field(form,'Chercher le client','search','',120),wrap=el('label','Client des échantillons','task-field');wrap.append(select);form.append(wrap);
   const result=el('p','','help');form.append(result);query.oninput=()=>{const ticket=++clientEpoch;clearTimeout(clientTimer);clientTimer=setTimeout(async()=>{
    if(ticket!==clientEpoch||!form.isConnected||!isAuthenticated())return;
    try{const response=await clientRequest('/clients?q='+encodeURIComponent(query.value)+'&limit=20');
     if(ticket!==clientEpoch||!form.isConnected||!isAuthenticated())return;const rows=normalizeClientList(response),value=select.value,label=select.selectedOptions[0]?.text;
     const options=[new Option('Choisir un client','')];for(const c of rows)options.push(new Option(c.name,c.id));
     if(value&&!options.some(o=>o.value===value))options.push(new Option(label||'Client sélectionné',value));select.replaceChildren(...options);select.value=value;
     result.textContent=rows.length+' résultat(s).';
    }catch{if(ticket===clientEpoch)result.textContent='Recherche indisponible. Le client choisi est conservé.'}
   },300)};
  }
  const products=field(form,'Produits et quantités','textarea',row?.products||'',2000);products.required=true;
  const goal=field(form,'Objectif','text',row?.goal||'',1000);
  const due=field(form,'Prochaine relance (heure locale)','datetime-local',localDateTime(row?.follow_up_at||(!row?new Date(Date.now()+7*86400000).toISOString():null)));
  const tracking=field(form,'Référence de suivi du colis','text',row?.tracking||'',500);
  const notes=field(form,'Notes et retour client','textarea',row?.notes||'',5000);
  form.append(el('p','Vérifie les stocks avant l’envoi. Ce dossier ne réserve aucun produit.','help'));
  const save=el('button','Enregistrer les échantillons','primary-button');save.type='submit';form.append(save,button('Fermer le dossier',()=>{clientEpoch++;clearTimeout(clientTimer);editor.replaceChildren()}));
  form.onsubmit=e=>{e.preventDefault();if(!select.value)return;let follow_up_at;try{follow_up_at=dueInstant(due.value)}catch{s.error=message('invalid_follow_up');render();return}
   mutate({request_id:crypto.randomUUID(),action:row?'edit':'create',...(row?{sample_id:row.id,expected_version:row.updated_at}:{}),payload:{...(!row?{client_id:select.value}:{}),products:products.value.trim(),goal:goal.value,notes:notes.value,tracking:tracking.value,follow_up_at}});
  };editor.append(form);products.focus();form.scrollIntoView({behavior:'smooth',block:'start'});
 }
 function render(){
  if(!host)return;scope.textContent=s.clientId?'Client : '+s.clientName:'Tous les clients';scopeAll.hidden=!s.clientId;
  feedback.replaceChildren();if(s.error)feedback.append(el('p',s.error,'error-text'));if(s.notice)feedback.append(el('p',s.notice,'help'));
  if(s.retry&&!s.busy)feedback.append(button('Réessayer le même dossier',()=>mutate(s.retry)));
  summary.replaceChildren();if(s.counts)for(const [label,key]of [['En cours','active'],['À relancer','overdue'],['Commandes signalées','won']]){
   const item=el('div',undefined,'sample-stat');item.append(el('strong',String(s.counts[key])),el('span',label));summary.append(item);
  }
  list.replaceChildren();if(s.loading)list.append(el('p','Lecture des échantillons…','help'));
  if(s.error&&s.rows.length)list.append(el('p','Dernière lecture conservée pour ce filtre.','help'));
  if(!s.rows.length&&!s.loading)list.append(el('p',s.error?'Liste non confirmée pour ce filtre.':'Aucun dossier pour ce filtre.','help'));
  for(const row of s.rows){
   const card=el('article',undefined,'sample-card'),top=el('div',undefined,'sample-card-head');top.append(el('h3',row.client_name),el('span',sampleLabels[row.status],'sample-status'));card.append(top);
   card.append(el('p',row.products,'sample-products'));if(row.goal)card.append(el('p',row.goal,'help'));
   const overdue=sampleTransitions[row.status].length&&row.follow_up_at&&Date.parse(row.follow_up_at)<=Date.now();
   card.append(el('p','Relance : '+when(row.follow_up_at),overdue?'sample-overdue':'help'));
   const details=el('details',undefined,'sample-detail');details.append(el('summary','Notes et suivi'));
   if(row.notes)details.append(el('p',row.notes));if(row.tracking)details.append(el('p','Colis : '+row.tracking));
   if(row.sent_at)details.append(el('p','Envoi signalé le '+when(row.sent_at),'help'));if(row.received_at)details.append(el('p','Réception signalée le '+when(row.received_at),'help'));
   details.append(el('p','Mis à jour le '+when(row.updated_at)+' · informations saisies manuellement','help'));card.append(details);
   const actions=el('div',undefined,'sample-actions');actions.append(button('Modifier',()=>edit(row)),button('Fiche client',()=>onClient?.(row.client_id)));
   if(sampleTransitions[row.status].length&&onFollowUp)actions.append(button('Préparer la relance',()=>onFollowUp(row)));
   const advance={PLANNED:['SENT','Marquer envoyé'],SENT:['RECEIVED','Marquer reçu'],RECEIVED:['FEEDBACK','Marquer retour obtenu']};
   if(advance[row.status])actions.append(button(advance[row.status][1],()=>move(row,advance[row.status][0]),'primary-button'));
   if(sampleTransitions[row.status].length){const more=el('details',undefined,'sample-more');more.append(el('summary','Autres statuts'));const selectStatus=el('select');selectStatus.setAttribute('aria-label','Nouveau statut des échantillons');
    for(const value of sampleTransitions[row.status])selectStatus.append(new Option(sampleLabels[value],value));more.append(selectStatus,button('Appliquer le statut',()=>move(row,selectStatus.value)));actions.append(more);
   }
   actions.querySelectorAll('button,select').forEach(n=>n.disabled=disabled());card.append(actions);list.append(card);
  }
  for(const control of [newButton,reload,prev,next,scopeAll,search,status])control.disabled=disabled()||!isAuthenticated();
  prev.disabled||=s.offset===0;next.disabled||=s.offset+s.rows.length>=s.total||s.offset+50>100000;
 }
 function init(){
  if(host)return;host=document.getElementById('sample-root');if(!host)return;
  const head=el('div',undefined,'section-heading');head.append(el('h2','Échantillons'));newButton=button('Préparer des échantillons',()=>edit(), 'primary-button');reload=button('Actualiser',()=>load());head.append(newButton,reload);
  scope=el('p','','help');scopeAll=button('Tous les clients',()=>{if(focusClient(null))void load()});summary=el('div',undefined,'sample-stats');
  const filters=el('div',undefined,'sample-filters');search=el('input');search.type='search';search.placeholder='Client ou produit';search.setAttribute('aria-label','Rechercher des échantillons');
  status=el('select');status.setAttribute('aria-label','Filtrer les échantillons');for(const [key,label]of [['ACTIVE','En cours'],['OVERDUE','À relancer'],['ALL','Tous les dossiers'],...Object.entries(sampleLabels)])status.append(new Option(label,key));
  search.oninput=()=>{clearTimeout(searchTimer);searchTimer=setTimeout(()=>{if(disabled())return;s.query=search.value;s.offset=0;clearRead();void load()},300)};
  status.onchange=()=>{if(disabled())return;s.status=status.value;s.offset=0;clearRead();void load()};filters.append(search,status);
  editor=el('div',undefined,'sample-editor-root');feedback=el('div');feedback.setAttribute('role','status');feedback.setAttribute('aria-live','polite');list=el('div',undefined,'sample-list');
  const pages=el('div',undefined,'section-heading');prev=button('← Précédent',()=>{s.offset=Math.max(0,s.offset-50);clearRead();void load()});next=button('Suivant →',()=>{s.offset+=50;clearRead();void load()});pages.append(prev,next);
  host.append(head,scope,scopeAll,summary,filters,editor,feedback,list,pages,el('p','Une commande signalée ici ne remplace pas une vente confirmée dans Odoo.','help'));
 }
 async function open(){init();if(!host)return;if(!s.checked||Date.now()-Date.parse(s.checked)>900000||s.error)return load();render()}
 async function draft(id,name){init();if(!host||!focusClient(id,name))return;const session=s.session;await load();if(session===s.session&&s.clientId===id&&isAuthenticated()&&isActive()&&!s.error&&!disabled())edit()}
 function reset(){s.session++;s.operation++;s.epoch++;clientEpoch++;clearTimeout(searchTimer);clearTimeout(clientTimer);Object.assign(s,{rows:[],total:0,counts:null,checked:null,status:'ACTIVE',query:'',offset:0,clientId:null,clientName:'',loading:false,busy:false,error:'',notice:'',retry:null});host?.replaceChildren();host=editor=feedback=summary=list=search=status=scope=scopeAll=newButton=reload=prev=next=null}
 return {open,draft,focusClient,reset,isBusy:disabled};
}
