import {normalizeTaskPage,normalizeTaskMutationReply} from './task-model-d36.mjs';
import {normalizeClientList,validClientId} from './clients-model-d14.mjs';
const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n};
const button=(text,fn,cls='inline-button')=>{const b=el('button',text,cls);b.type='button';b.addEventListener('click',fn);return b};
const errorText=code=>({task_conflict:'Cette tâche a changé entretemps. Actualise avant de la modifier.',merge_conflict:'Une des tâches a changé. Actualise avant de fusionner.',task_duplicate:'Une autre tâche identique existe. Ta modification n’a pas été appliquée ; utilise Doublon… pour les regrouper.',merge_client_mismatch:'Les deux tâches doivent appartenir au même client.',client_not_found:'Le client sélectionné n’existe plus.',idempotency_conflict:'Cet enregistrement a déjà été utilisé pour une autre action.',invalid_transition:'Cette action ne correspond plus au statut de la tâche.',tasks_unavailable:'Le service des tâches ne répond pas. Réessaie.',invalid_due_at:'L’échéance est incorrecte.',invalid_title:'Indique un titre de 240 caractères maximum.'})[code]||'Enregistrement non confirmé. Tu peux réessayer la même action.';
export function localDateTime(iso){if(!iso)return '';const d=new Date(iso);if(!Number.isFinite(d.getTime()))return '';return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16)}
export function dueInstant(local){return local?new Date(local).toISOString():null}
export function createTasks({request,clientRequest,isAuthenticated,isActive,onChanged}){
 const s={rows:[],total:0,offset:0,status:'OPEN',query:'',clientId:null,clientName:'',loading:false,error:'',notice:'',checked:null,epoch:0,session:0,operation:0,busy:false,retry:null};
 let root,editor,feedback,list,summary,scopeNote,scopeButton,searchControl,statusControl,clientEpoch=0,searchTimer=null,clientTimer=null;
 async function load({afterMutation=false}={}){
  if(!isAuthenticated()||s.busy&&!afterMutation)return;
  const scope={status:s.status,clientId:s.clientId,offset:s.offset};
  const ticket=++s.epoch;s.loading=true;s.error='';render();
  try{const body=await request('?status='+scope.status+'&q='+encodeURIComponent(s.query)+'&offset='+scope.offset+(scope.clientId?'&client_id='+encodeURIComponent(scope.clientId):''));
   if(ticket!==s.epoch||!isAuthenticated())return;
   const page=normalizeTaskPage(body,scope);s.rows=page.rows;s.total=page.total;s.checked=page.checked;
  }catch(e){if(ticket===s.epoch)s.error=errorText(e.message)}
  finally{if(ticket===s.epoch){s.loading=false;render()}}
 }
 function clearRead(){s.epoch++;s.rows=[];s.total=0;s.checked=null;s.error='';s.notice='';s.loading=true;render()}
 function focusClient(id,name=''){
  if(s.busy||s.retry||id!==null&&!validClientId(id))return false;
  clearTimeout(searchTimer);clearTimeout(clientTimer);clientEpoch++;editor?.replaceChildren();
  s.clientId=id;s.clientName=typeof name==='string'?name.slice(0,1000):'';s.query='';s.offset=0;s.status='OPEN';
  if(searchControl)searchControl.value='';if(statusControl)statusControl.value='OPEN';clearRead();return true;
 }
 function pending(disabled){editor?.querySelectorAll('input,select,textarea,button').forEach(n=>n.disabled=disabled)}
 async function mutate(body){
  if(s.busy||s.loading||s.retry&&s.retry!==body||!isAuthenticated())return;
  const session=s.session,operation=++s.operation,current=()=>session===s.session&&operation===s.operation&&isAuthenticated();
  clientEpoch++;clearTimeout(clientTimer);
  s.busy=true;s.error='';s.notice='';s.retry=body;pending(true);render();
  try{const response=await request('',{method:'POST',body:JSON.stringify(body)});
   if(!current())return;const result=normalizeTaskMutationReply(response,body);
   s.retry=null;clientEpoch++;clearTimeout(clientTimer);editor.replaceChildren();
   s.notice=result.existing_suggestion_approved?'La suggestion existante a été confirmée avec les informations saisies et envoyée à Rappels.':result.duplicate?'Une tâche identique existe déjà. Aucune nouvelle tâche ni modification n’a été ajoutée.':'Enregistré. Le statut Rappels ci-dessous indique la progression de la synchronisation.';
   if(s.clientId&&Object.hasOwn(body.payload||{},'client_id')&&body.payload.client_id!==s.clientId)s.notice+=' La tâche appartient à un autre périmètre ; affiche les tâches de tous les clients pour la retrouver.';
   onChanged?.();await load({afterMutation:true});
  }catch(e){if(current()){s.error=errorText(e.message);if(/^[a-z][a-z0-9_]+$/.test(e.message)&&e.message!=='tasks_unavailable'){s.retry=null;if(['task_conflict','merge_conflict'].includes(e.message))editor.replaceChildren();}}}
  finally{if(current()){s.busy=false;pending(!!s.retry);render()}}
 }
 const currentRow=row=>s.rows.some(t=>t.id===row.id&&t.updated_at===row.updated_at);
 function action(row,verb,payload={}){if(!currentRow(row))return;return mutate({request_id:crypto.randomUUID(),action:verb,task_id:row.id,expected_version:row.updated_at,payload})}
 function field(form,label,type,value='',max){const box=el('label',label,'task-field');const input=el(type==='textarea'?'textarea':'input');if(type!=='textarea')input.type=type;input.value=value;if(max)input.maxLength=max;box.append(input);form.append(box);return input}
 function edit(row=null,draft=null){
  if(s.busy||s.retry||s.loading||!isAuthenticated()||row&&!currentRow(row))return;
  clearTimeout(clientTimer);clientEpoch++;editor.replaceChildren();const form=el('form',undefined,'task-editor');form.append(el('h3',row?'Modifier la tâche':'Nouvelle tâche'));
  const title=field(form,'Action à réaliser','text',row?.title||String(draft?.title||'').slice(0,240),240);title.required=true;
  const description=field(form,'Contexte','textarea',row?.description||String(draft?.description||'').slice(0,5000),5000);
  const due=field(form,'Échéance (heure locale)','datetime-local',localDateTime(row?.due_at));
  const search=field(form,'Chercher un client (facultatif)','search','',120);
  const label=el('label','Client','task-field'),select=el('select');select.setAttribute('aria-label','Client');select.append(new Option('Sans client',''));
  const initialId=row?row.client_id:s.clientId,initialName=row?row.client_name:s.clientName;
  if(initialId)select.append(new Option(initialName||'Client sélectionné',initialId,true,true));
  label.append(select);form.append(label);
  const clientStatus=el('p','','help');form.append(clientStatus);
  search.addEventListener('input',()=>{const ticket=++clientEpoch;clearTimeout(clientTimer);clientTimer=setTimeout(async()=>{
   if(ticket!==clientEpoch||!isAuthenticated()||!form.isConnected)return;
   try{const response=await clientRequest('/clients?q='+encodeURIComponent(search.value)+'&limit=20');if(ticket!==clientEpoch||!isAuthenticated()||!form.isConnected)return;const rows=normalizeClientList(response);
    const current=select.value,currentLabel=select.selectedOptions[0]?.text,options=[new Option('Sans client','')];
    if(initialId)options.push(new Option(initialName||'Client sélectionné',initialId));
    for(const c of rows)if(c.id!==initialId)options.push(new Option(c.name,c.id));
    if(current&&!options.some(o=>o.value===current))options.push(new Option(currentLabel||'Client sélectionné',current));select.replaceChildren(...options);if(options.some(o=>o.value===current))select.value=current;
    clientStatus.textContent=rows.length+' résultat(s). Sélectionne le client souhaité.';
   }catch{if(ticket===clientEpoch)clientStatus.textContent='Recherche indisponible. Le client actuel est conservé.'}
  },300)});
  const save=el('button','Enregistrer','primary-button');save.type='submit';form.append(save,button('Fermer',()=>{clearTimeout(clientTimer);clientEpoch++;editor.replaceChildren()}));
  form.addEventListener('submit',ev=>{ev.preventDefault();let due_at;try{due_at=dueInstant(due.value)}catch{clientStatus.textContent='Échéance incorrecte.';return}
   mutate({request_id:crypto.randomUUID(),action:row?'edit':'create',...(row?{task_id:row.id,expected_version:row.updated_at}:{}),payload:{title:title.value.trim(),description:description.value||null,due_at,client_id:select.value||null}});
  });editor.append(form);title.focus();
 }
 function merge(row){
  if(s.busy||s.retry||s.loading||!isAuthenticated()||!currentRow(row))return;clearTimeout(clientTimer);clientEpoch++;editor.replaceChildren();
  const peers=s.rows.filter(t=>t.id!==row.id&&t.status==='OPEN'&&!t.is_suggested&&t.client_id===row.client_id);
  const box=el('div',undefined,'task-editor');box.append(el('h3','Regrouper un doublon'),el('p','La tâche « '+row.title+' » sera archivée au profit de celle que tu conserves. Son historique reste en base.','help'));
  const select=el('select');select.setAttribute('aria-label','Tâche à conserver');select.append(new Option('Choisir la tâche à conserver',''));
  for(const t of peers)select.append(new Option(t.title,t.id));box.append(select);
  box.append(button('Conserver la tâche choisie et fusionner',()=>{const target=peers.find(t=>t.id===select.value);if(target)action(row,'merge',{target_id:target.id,target_version:target.updated_at})}),button('Fermer',()=>editor.replaceChildren()));
  if(!peers.length)box.append(el('p','Aucune autre tâche de ce client dans cette page.','help'));editor.append(box);
 }
 function syncText(t){
  if(t.reminder_sync_status==='SYNCED')return (t.reminder_action==='DELETE'?'Rappels : clôture synchronisée':'Rappels : synchronisé')+(t.reminder_synced_at?' le '+new Date(t.reminder_synced_at).toLocaleString('fr-FR'):'');
  if(t.reminder_sync_status==='PENDING')return 'Rappels : en attente du Mac';if(t.reminder_sync_status==='ERROR')return 'Rappels : erreur, reprise nécessaire';
  if(t.status!=='OPEN')return 'Rappels : aucun rappel à clôturer';if(t.is_suggested)return 'Suggestion : confirmer pour l’envoyer à Rappels';
  const reason={historical_backfill:'échange historique',legacy_extractor:'ancienne extraction',confidence_below_0_90:'fiabilité à confirmer',
   missing_source_event:'source manquante',missing_event_time:'date de source manquante',not_commercially_linked:'rattachement commercial non vérifié'}[t.reminder_reason];
  return 'Rappels : non envoyé'+(reason?' · '+reason:' (tâche issue d’une ancienne extraction ou non éligible)');
 }
 function render(){
  if(!root)return;
  scopeNote.textContent=s.clientId?'Tâches du client : '+(s.clientName||'client sélectionné'):'Tâches de tous les clients et actions sans client.';
  scopeButton.hidden=!s.clientId;scopeButton.disabled=s.busy||!!s.retry||s.loading;
  feedback.replaceChildren();feedback.setAttribute('role','status');feedback.setAttribute('aria-live','polite');
  if(s.error)feedback.append(el('p',s.error,'error-text'));
  if(s.notice)feedback.append(el('p',s.notice,'notice'));
  if(s.retry&&!s.busy)feedback.append(button('Réessayer le même enregistrement',()=>mutate(s.retry)));
  summary.textContent=s.loading?'Chargement des tâches…':s.rows.length+' affichée(s) sur '+s.total+(s.checked?' · Lecture du '+new Date(s.checked).toLocaleString('fr-FR'):'');
  if(s.error&&s.rows.length)summary.textContent+=' · Dernière lecture conservée';
  list.replaceChildren();
  if(!s.rows.length&&!s.loading)list.append(el('p',s.error?'Liste non confirmée pour ce filtre. Actualise pour reprendre.':'Aucune tâche pour ce filtre.','help'));
  for(const t of s.rows){const card=el('article',undefined,'task-card');card.append(el('h3',t.title),el('p',t.client_name||'Sans client','help'));
   if(t.description)card.append(el('p',t.description,'task-context'));
   card.append(el('p',(t.due_at?'Échéance : '+new Date(t.due_at).toLocaleString('fr-FR'):'Sans échéance')+' · '+({OPEN:'À faire',DONE:'Terminée',CANCELLED:'Annulée'}[t.status]||t.status),'help'),el('p',syncText(t),'help'));
   const controls=el('div',undefined,'task-actions');
   if(t.status==='OPEN'){
    controls.append(button('Modifier / reporter',()=>edit(t)));
    if(t.is_suggested)controls.append(button('Confirmer cette suggestion',()=>action(t,'approve')));
    controls.append(button('Terminer',()=>action(t,'complete')),button('Annuler la tâche',()=>action(t,'cancel')),button('Doublon…',()=>merge(t)));
   }if(t.reminder_sync_status==='ERROR')controls.append(button('Réessayer Rappels',()=>action(t,'resync')));card.append(controls);controls.querySelectorAll('button').forEach(b=>b.disabled=s.busy||!!s.retry||s.loading);list.append(card);
  }
  root.querySelectorAll('[data-task-page]').forEach(b=>b.disabled=s.busy||!!s.retry||s.loading||(b.dataset.taskPage==='prev'?s.offset===0:s.offset+s.rows.length>=s.total||s.offset+200>100000));
  root.querySelector('[data-task-new]').disabled=!isAuthenticated()||s.busy||!!s.retry||s.loading;root.querySelector('[data-task-reload]').disabled=!isAuthenticated()||s.busy||!!s.retry||s.loading;root.querySelectorAll('.filter-panel input,.filter-panel select').forEach(n=>n.disabled=!isAuthenticated()||s.busy||!!s.retry);
 }
 function init(){
  root=document.getElementById('tasks-root');if(!root)return;
  const head=el('div',undefined,'section-heading');const add=button('Nouvelle tâche',()=>edit(),'secondary-button');add.dataset.taskNew='';const refresh=button('Actualiser ↻',()=>load());refresh.dataset.taskReload='';head.append(add,refresh);
  const filters=el('div',undefined,'filter-panel');const search=el('input');search.type='search';search.placeholder='Action ou client…';search.maxLength=120;search.setAttribute('aria-label','Rechercher une tâche');
  searchControl=search;search.addEventListener('input',()=>{clearTimeout(searchTimer);s.query=search.value;s.offset=0;clearRead();searchTimer=setTimeout(()=>load(),300)});
  const select=el('select');select.setAttribute('aria-label','Statut des tâches');for(const [v,t] of [['OPEN','À faire'],['DONE','Terminées'],['CANCELLED','Annulées'],['ALL','Tous les statuts']])select.append(new Option(t,v));
  statusControl=select;select.addEventListener('change',()=>{clearTimeout(searchTimer);s.status=select.value;s.offset=0;clearRead();load()});filters.append(search,select);
  feedback=el('div');editor=el('div');summary=el('p','','help');list=el('div',undefined,'stack');
  const pages=el('div',undefined,'task-actions');for(const [dir,label,delta] of [['prev','← Précédentes',-200],['next','Suivantes →',200]]){const b=button(label,()=>{if(s.busy||s.retry||s.loading||dir==='prev'&&s.offset===0||dir==='next'&&(s.offset+s.rows.length>=s.total||s.offset+200>100000))return;s.offset=Math.max(0,s.offset+delta);clearRead();load()});b.dataset.taskPage=dir;pages.append(b)}
  scopeNote=el('p','','help');scopeButton=button('Voir les tâches de tous les clients',()=>{if(focusClient(null))load()},'secondary-button');
  root.append(head,scopeNote,scopeButton,filters,feedback,editor,summary,list,pages,el('p','Rappels Apple se synchronise lorsque ton Mac est allumé et connecté. Les modifications de titre et d’échéance se font ici ; les tâches terminées dans Rappels remontent au Companion.','help'));render();
 }
 init();
 async function draft(template){
  const session=s.session,client=s.clientId;
  if(s.busy||s.retry||!client)return false;
  await load();
  if(session!==s.session||client!==s.clientId||!isAuthenticated()||!isActive()||s.error||s.busy||s.retry||s.loading)return false;
  edit(null,template);return true;
 }
 return {open:()=>load(),render,focusClient,focusList(query=''){if(!focusClient(null))return false;s.query=String(query).slice(0,120);if(searchControl)searchControl.value=s.query;return true},draft,isBusy:()=>s.busy||!!s.retry,reset(){
  s.session++;s.operation++;s.epoch++;clientEpoch++;clearTimeout(searchTimer);clearTimeout(clientTimer);s.rows=[];s.total=0;s.offset=0;s.query='';s.status='OPEN';s.clientId=null;s.clientName='';
  s.error='';s.notice='';s.checked=null;s.retry=null;s.busy=false;s.loading=false;editor?.replaceChildren();if(searchControl)searchControl.value='';if(statusControl)statusControl.value='OPEN';render();
 },forClient(id,name=''){if(focusClient(id,name))return load()}};
}
