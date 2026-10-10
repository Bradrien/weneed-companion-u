import {normalizeWhatsappBrief,normalizeWhatsappOverview,whatsappTopicLabel} from './whatsapp-brief-model.mjs';
const el=(tag,cls='',text)=>{const n=document.createElement(tag);n.className=cls;if(text!==undefined)n.textContent=String(text);return n};
const date=v=>{const d=new Date(v);return Number.isFinite(d.getTime())?d.toLocaleString('fr-FR',{dateStyle:'medium',timeStyle:'short'}):'Date inconnue'};
const params=o=>new URLSearchParams(Object.entries(o).filter(([,v])=>v!==null&&v!==undefined&&v!=='')).toString();
export function createArchives({request,briefRequest,isAuthenticated,isActive}){
 let epoch=0,board=null,selection=null,query='',client=null,rows=[],next=null,busy=false,error='',summary=null,clients=[],filter='',statusFilter='all',audio=[];
 let briefEpoch=0,briefClientId=null,brief=null,briefBusy=false,briefError='',clientRenderer=null,overview=null,overviewBusy=false,overviewError='';
 const root=()=>document.getElementById('archive-root');
 const stopAudio=()=>{for(const a of audio){a.pause();a.removeAttribute('src');a.load()}audio=[]};
 const reset=()=>{briefEpoch++;briefClientId=null;brief=null;briefBusy=false;briefError='';overview=null;overviewBusy=false;overviewError='';epoch++;stopAudio();board=null;selection=null;client=null;rows=[];next=null;busy=false;error='';summary=null;clients=[];query='';filter='';root()?.replaceChildren()};
 async function readMessages(append=false){
  if(busy||!isAuthenticated())return;
  const ticket=++epoch;busy=true;error='';if(!append){stopAudio();rows=[];next=null}render();
  try{
   const scope=client?{client_id:client}:{batch_id:selection.batch_id,chat_pk:selection.chat_pk};
   const data=await request('?'+params({action:'messages',...scope,q:query,cursor:append?next:null}));
   if(ticket!==epoch)return;rows=append?rows.concat(data.messages):data.messages;next=data.next_cursor;
  }catch{if(ticket===epoch)error='Impossible de charger ces échanges. Réessaie.'}
  finally{if(ticket===epoch){busy=false;render()}}
 }
 async function open(){
  if(!isAuthenticated())return;
  void loadOverviewBrief();
  client=null;selection=null;query='';stopAudio();const ticket=++epoch;busy=true;error='';render();
  try{const [a,b]=await Promise.all([request('?action=summary'),request('?action=conversations')]);if(ticket!==epoch)return;summary=a;board=b.conversations;clients=b.clients}
  catch{if(ticket===epoch)error='Les archives sont temporairement indisponibles.'}
  finally{if(ticket===epoch){busy=false;render()}}
 }
 function openClient(id){epoch++;stopAudio();client=id;selection=null;query='';rows=[];next=null;busy=false;error='';return readMessages()}
 function pick(c){epoch++;stopAudio();selection=c;client=null;query='';rows=[];next=null;busy=false;error='';readMessages()}
 function render(){stopAudio();const host=root();if(host&&isActive())renderInto(host)}
 
 async function loadOverviewBrief(){
  if(overviewBusy||!isAuthenticated())return;
  overviewBusy=true;overviewError='';render();
  try{
   const response=await briefRequest('?mode=overview');
   if(!isAuthenticated())return;
   overview=normalizeWhatsappOverview(response.data);
  }catch{overviewError='Aperçu des échanges indisponible pour le moment.'}
  finally{overviewBusy=false;render()}
 }
 async function loadClientBrief(id){
  if(!id||!isAuthenticated()||briefClientId===id&&(brief||briefBusy||briefError))return;
  const ticket=++briefEpoch;briefClientId=id;brief=null;briefBusy=true;briefError='';
  try{
   const response=await briefRequest('?client_id='+encodeURIComponent(id));
   if(ticket!==briefEpoch||!isAuthenticated())return;
   brief=normalizeWhatsappBrief(response.data,id);
  }catch{
   if(ticket===briefEpoch)briefError='Aperçu des échanges indisponible ; historique original toujours consultable.';
  }finally{
   if(ticket===briefEpoch){briefBusy=false;clientRenderer?.()}
  }
 }
 const archiveBriefItem=(x,topic)=>{
  const entry=el('article','wa-brief-entry');
  const heading=(topic&&x.category?whatsappTopicLabel[x.category]+' · ':'')+
    (x.direction==='outgoing'?'Envoyé':'Reçu')+' · '+date(x.at);
  entry.append(el('strong','',heading),el('p','archive-text',x.excerpt),
   el('small','','Archive #'+x.chatPk+' · message #'+x.messagePk));
  return entry;
 };
 function renderBrief(id){
  const panel=el('div','wa-brief-panel');
  panel.append(el('h4','','Vue rapide · WhatsApp'),
   el('p','help','Analyse textuelle par mots-clés, sans interprétation automatique des accords ou paiements. Sources datées, aucun vocal ajouté ici.'));
  if(briefClientId!==id||briefBusy){
   panel.append(el('p','help','Chargement de la vue rapide…'));return panel;
  }
  if(briefError){panel.append(el('p','help',briefError));return panel}
  if(!brief||brief.status!=='available'){
   panel.append(el('p','help','Aucun texte historique approuvé et relié avec certitude à cette fiche.'));return panel;
  }
  panel.append(el('p','help',
    brief.coverage.messageCount+' textes vérifiés · '+brief.coverage.conversationCount+
    ' conversation(s) · dernier message '+date(brief.coverage.lastAt)));
  for(const [heading,items,topic] of [
   ['Derniers échanges',brief.recent,false],
   ['Moments commerciaux à relire',brief.highlights,true]
  ]){
   const group=el('details','wa-brief-group');group.open=!topic;
   group.append(el('summary','',heading+' · '+items.length));
   if(!items.length)group.append(el('p','help','Aucun passage identifié.'));
   for(const x of items)group.append(archiveBriefItem(x,topic));
   panel.append(group);
  }
  return panel;
 }
 function renderOverviewBrief(){
  const panel=el('details','wa-brief-overview');
  panel.append(el('summary','','Activité WhatsApp · '+(overview?overview.length+' clients':'vue rapide')));
  if(overviewBusy)panel.append(el('p','help','Lecture des derniers échanges…'));
  if(overviewError)panel.append(el('p','help',overviewError));
  if(overview){
   panel.append(el('p','help','Dernier message par client vérifié. Ouvre une fiche pour examiner les moments commerciaux ; les 188 conversations non vérifiées sont exclues.'));
   for(const row of overview.slice(0,15)){
    const btn=el('button','wa-brief-client');btn.type='button';
    btn.append(el('strong','',row.clientName),el('small','',row.textCount+' textes · '+date(row.lastAt)));
    if(row.lastMessage)btn.append(el('span','',row.lastMessage.excerpt));
    btn.onclick=()=>{void openClient(row.clientId);void loadClientBrief(row.clientId)};
    panel.append(btn);
   }
  }
  return panel;
 }

 function renderClient(host,id){
  const section=el('section','client-section archive-section');section.append(el('h3','','Archives WhatsApp · textes et vocaux'));
  if(briefClientId!==id)void loadClientBrief(id);
  section.append(renderBrief(id));
  if(client!==id){const button=el('button','secondary-button','Consulter les échanges archivés');button.type='button';button.onclick=()=>openClient(id);section.append(button,el('p','help','Historique depuis septembre 2025. Les conversations rattachées apparaissent ici.'));host.append(section);return;}
  renderMessages(section);host.append(section);
 }
 function renderInto(host){host.replaceChildren();
  const head=el('section','settings-card');head.append(el('h2','','Vos archives WhatsApp'));
  const refresh=el('button','inline-button','Actualiser les archives');refresh.type='button';refresh.disabled=busy;refresh.onclick=open;head.append(refresh);
  if(summary)head.append(el('p','',`${summary.messages.toLocaleString('fr-FR')} messages · ${summary.audio_available.toLocaleString('fr-FR')} / ${summary.audio.toLocaleString('fr-FR')} vocaux disponibles`),el('p','help',`${summary.linked_conversations} conversations rattachées · ${summary.needs_review} à vérifier · ${summary.transcribed} vocaux transcrits`));
  head.append(el('p','help','Les transcriptions automatiques peuvent contenir des erreurs. Le vocal original reste la référence.'));
  host.append(head);
  host.append(renderOverviewBrief());
  if(selection||client){
   const back=el('button','secondary-button','← Toutes les conversations');back.type='button';back.onclick=()=>{epoch++;stopAudio();selection=null;client=null;rows=[];busy=false;error='';render()};host.append(back);
   host.append(el('h2','archive-title',selection?.display_name||'Conversations du client'));
   if(selection&&!selection.client_id){
    const link=el('section','settings-card');link.append(el('h3','','Rattacher à une fiche client'),el('p','help','Choisissez la fiche après avoir vérifié le nom, le numéro et les échanges.'));
    const select=el('select');select.setAttribute('aria-label','Fiche client à rattacher');const none=el('option','','Choisir un client');none.value='';select.append(none);
    for(const c of clients){const o=el('option','',c.canonical_name);o.value=c.id;select.append(o)}
    const button=el('button','secondary-button','Rattacher cette conversation');button.type='button';button.disabled=true;select.onchange=()=>{button.disabled=!select.value};
    const status=el('p','help');status.setAttribute('role','status');
    button.onclick=async()=>{button.disabled=true;const ticket=epoch,c=selection;status.textContent='Rattachement en cours…';try{await request('',{method:'POST',body:JSON.stringify({action:'link',batch_id:c.batch_id,chat_pk:c.chat_pk,client_id:select.value})});if(ticket!==epoch)return;c.client_id=select.value;c.link_state='manual';summary=null;status.textContent='Conversation rattachée.';select.disabled=true}catch{if(ticket===epoch){status.textContent='Le rattachement a échoué. Actualisez les archives.';button.disabled=false}}};
    link.append(select,button,status);host.append(link);
   }
   const section=el('section','archive-section');renderMessages(section);host.append(section);return;
  }
  if(busy)host.append(el('p','help','Chargement des archives…'));
  if(error){host.append(el('p','error-text',error));const b=el('button','secondary-button','Réessayer');b.onclick=open;host.append(b)}
  if(!board)return;
  const form=el('form','filter-panel');const search=el('input');search.type='search';search.placeholder='Nom ou numéro de conversation…';search.value=filter;search.setAttribute('aria-label','Rechercher une conversation');
  const select=el('select');select.setAttribute('aria-label','Rattachement');for(const [value,label] of [['all','Toutes les conversations'],['linked','Rattachées aux clients'],['review','À vérifier']]){const option=el('option','',label);option.value=value;select.append(option)}select.value=statusFilter;
  const listing=el('div','stack');const count=el('p','help');
  function list(){listing.replaceChildren();const q=filter.trim().toLowerCase();const matches=board.filter(c=>(statusFilter==='all'||(statusFilter==='linked'?!!c.client_id:!c.client_id))&&(!q||(c.display_name+' '+(c.phone_e164||'')).toLowerCase().includes(q)));count.textContent=`${matches.length} conversation(s)`;
   for(const c of matches){const b=el('button','client-row');b.type='button';b.append(el('span','client-name',c.display_name),el('span','client-sub',`${c.message_count} messages · ${c.audio_count} vocaux · ${c.client_id?'Fiche client rattachée':'À vérifier'}`),el('span','client-mini',`${c.phone_e164||''} · ${date(c.last_message_at)}`));b.onclick=()=>pick(c);listing.append(b)}
  }
  search.oninput=()=>{filter=search.value;list()};select.onchange=()=>{statusFilter=select.value;list()};form.onsubmit=e=>e.preventDefault();form.append(search,select);host.append(form,count,listing);list();
 }
 function renderMessages(host){
  const form=el('form','archive-search');const input=el('input');input.type='search';input.value=query;input.maxLength=120;input.placeholder='Rechercher dans les textes et transcriptions…';input.setAttribute('aria-label','Rechercher dans les échanges');
  const search=el('button','secondary-button','Rechercher');search.type='submit';search.disabled=busy;
  form.onsubmit=e=>{e.preventDefault();query=input.value.trim();readMessages()};form.append(input,search);host.append(form,el('p','help','Messages du plus récent au plus ancien. Les anciens échanges ne créent pas de tâches actuelles.'));
  if(busy)host.append(el('p','help','Lecture des échanges…'));
  if(error){host.append(el('p','error-text',error));const retry=el('button','secondary-button','Réessayer');retry.type='button';retry.onclick=()=>readMessages();host.append(retry)}
  if(!busy&&!error&&!rows.length)host.append(el('p','help','Aucun échange archivé rattaché à cette fiche ou correspondant à cette recherche.'));
  for(const m of rows){
   const card=el('article','archive-message'+(m.is_outbound?' outbound':''));card.append(el('p','archive-message-meta',`${m.is_outbound?'Vous':'Contact'} · ${date(m.occurred_at)} · ${m.display_name}`));
   if(m.text_body)card.append(el('p','archive-text',m.text_body));
   if(m.audio_id){
    const seconds=Number(m.duration_seconds)||0;card.append(el('p','help',`Vocal · ${Math.floor(seconds/60)} min ${Math.round(seconds%60)} s`));
    if(m.archive_status==='verified'){
     const b=el('button','inline-button','Écouter le vocal original');b.type='button';const status=el('span','help');status.setAttribute('role','status');
     b.onclick=async()=>{const ticket=epoch;b.disabled=true;status.textContent='Ouverture du vocal…';try{const result=await request('?'+params({action:'audio',audio_id:m.audio_id}));if(ticket!==epoch||!b.isConnected)return;const url=new URL(result.url);if(url.origin!=='https://gcirlrghjvumhkekrtmf.supabase.co'||!url.pathname.startsWith('/storage/v1/object/sign/whatsapp-history-audio/'))throw Error('invalid_audio_url');
      const player=el('audio','archive-player');player.controls=true;player.preload='none';player.src=url.href;player.setAttribute('aria-label','Vocal du '+date(m.occurred_at));player.onerror=()=>{status.textContent='Lecture impossible ou lien expiré. Réouvrez le vocal.';b.disabled=false};audio.push(player);b.after(player);status.textContent='';player.play().catch(()=>{});
     }catch{if(ticket===epoch){status.textContent='Le vocal ne peut pas être ouvert. Réessayez.';b.disabled=false}}};card.append(b,status);
    }else card.append(el('p','help','Le fichier vocal est en cours de transfert.'));
    if(m.transcription_status==='done'&&m.transcript_text)card.append(el('p','archive-transcript-label','Transcription automatique · à vérifier'),el('p','archive-text',m.transcript_text));
    else card.append(el('p','help',m.transcription_status==='processing'?'Transcription du lot de validation en cours…':m.transcription_status==='error'?'Transcription non aboutie ; vocal original conservé.':'Vocal conservé · hors du lot transcrit pour le moment.'));
   }
   host.append(card);
  }
  if(next){const more=el('button','secondary-button','Afficher les messages précédents');more.type='button';more.disabled=busy;more.onclick=()=>readMessages(true);host.append(more)}
 }
 return {open,reset,render,renderClient,close(){epoch++;busy=false;stopAudio();client=null;selection=null;rows=[];next=null;root()?.replaceChildren()},setClientRenderer(fn){clientRenderer=fn;const original=render;render=()=>{original();if(client)fn()}}};
}
