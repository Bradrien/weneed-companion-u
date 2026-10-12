import {createRequestGuard} from './request-guard.mjs';
import {normalizeStockSnapshot} from './stock-model-d34.mjs';
const el=(tag,cls,value)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(value!==undefined)n.textContent=String(value);return n};
const qty=n=>new Intl.NumberFormat('fr-FR',{maximumFractionDigits:3}).format(n);
const date=s=>s?new Date(s).toLocaleString('fr-FR'):'Aucun contrôle terminé';
export function createStocks({request,isActive,isAuthenticated}){
 const $=id=>document.getElementById(id),guard=createRequestGuard();
 let company='ALL',query='',offset=0,data=null,timer=null,searchTimer=null,registration=null,busy=false,pushBusy=false,session=0;
 const expanded=new Set(),watchBusy=new Set(),watchNotes=new Map();
 let pushRevision=0;
 const productKey=row=>row.company+':'+row.id;
 const supported=()=> 'serviceWorker' in navigator&&'PushManager' in window&&'Notification' in window;
 const installed=()=>!(/iPad|iPhone|iPod/.test(navigator.userAgent))||navigator.standalone||matchMedia('(display-mode: standalone)').matches;
 const ready=()=>registration||(registration=navigator.serviceWorker.register('./sw.js',{scope:'./',updateViaCache:'none'}).then(()=>navigator.serviceWorker.ready).catch(e=>{registration=null;throw e}));
 const current=ticket=>ticket===session&&isAuthenticated();
 if(supported())ready().catch(()=>{});
 function pushButtons(sub=false){
  const usable=isAuthenticated()&&supported()&&installed();
  $('stock-push-enable').disabled=!usable||pushBusy;
  $('stock-push-test').disabled=!usable||!sub||pushBusy;$('stock-push-stop').disabled=!usable||!sub||pushBusy;
  $('stock-push-scope').disabled=!usable||pushBusy;
 }
 async function pushState(){
  const ticket=session,revision=pushRevision;
  if(!isAuthenticated())return;
  if(!supported()||!installed()){
   $('stock-push-status').textContent='Sur iPhone : ouvrir ce lien dans Safari, puis Partager → Sur l’écran d’accueil. Ouvrir ensuite l’icône WeNeed.';pushButtons();return;
  }
  try{
   const reg=await ready(),sub=await reg.pushManager.getSubscription();if(!current(ticket)||pushBusy||revision!==pushRevision)return;
   let active=false;
   if(sub){const result=await request('?action=push-status',{method:'POST',body:JSON.stringify(sub.toJSON())});if(!current(ticket)||pushBusy||revision!==pushRevision)return;
    if(typeof result.data?.active!=='boolean'||typeof result.data?.notify_all!=='boolean')throw Error('invalid_push_status');
    active=result.data.active;$('stock-push-scope').value=result.data.notify_all?'all':'selected';}
   $('stock-push-status').textContent=active?($('stock-push-scope').value==='all'?'Toutes les références sont notifiées sur cet appareil.':'Retours en stock des références suivies uniquement, sur cet appareil.')+' Utilise « Tester » pour vérifier la réception.':'Active les notifications pour recevoir les retours des références suivies.';pushButtons(active);
  }catch{if(current(ticket)&&!pushBusy&&revision===pushRevision){$('stock-push-status').textContent='Notifications indisponibles sur cet appareil.';pushButtons()}}
 }
 function pageButtons(){
  $('stock-prev').disabled=busy||!data||offset===0;
  $('stock-next').disabled=busy||!data||offset+data.items.length>=data.total||offset+50>10000;
 }
 function clearRows(){for(const id of ['stock-list','stock-alerts','stock-summary'])$(id).replaceChildren();$('stock-count').textContent='';pageButtons()}
 function draw(){
  const cards=$('stock-summary');cards.replaceChildren();
  for(const row of data.summary){const card=el('article','metric');card.append(el('span','metric-label',row.company+' · catalogue complet'),el('strong','',row.products),el('small','',row.outOfStock+' indisponibles'));cards.append(card)}
  const stale=data.stale||!data.checkedAt||Date.now()-Date.parse(data.checkedAt)>720000;
  $('stock-status').textContent='Dernier contrôle Odoo : '+date(data.checkedAt)+' · toutes les '+data.interval+' minutes'+(stale?' · Données anciennes : contrôle à vérifier.':'')+(data.lastError?' · Le dernier contrôle a échoué ; les dernières quantités connues sont conservées.':'');
  $('stock-count').textContent=(company==='ALL'?'TR et GTA':company)+' · '+data.total+' référence(s)'+(query?' pour « '+query+' »':'')+' · '+(data.items.length?`${offset+1}–${offset+data.items.length}`:'0 résultat');
  const list=$('stock-list');list.replaceChildren();
  for(const row of data.items){const key=productKey(row),card=el('details','settings-card stock-card');card.dataset.product=key;card.open=expanded.has(key);
   const summary=el('summary'),heading=el('div','section-heading');heading.append(el('h3','',row.name),el('strong',row.available<=0?'stock-zero':'green-text',qty(row.available)+' '+row.unit));
   summary.append(heading,el('p','help',row.company+' · '+(row.sku||'Sans référence SKU')),
    el('p','help',(row.basis==='free_qty'?'Disponible après réservations':'En stock physique (réservations non déduites)')+' · Physique : '+qty(row.onHand)+' '+row.unit),
    el('span','stock-open-label',row.watching?'✓ Retour en stock suivi · Gérer →':'Alerte de retour en stock →'));
   const actions=el('div','stock-watch-actions'),button=el('button','secondary-button stock-watch-button',row.watching?'Désactiver cette alerte':'M’avertir du retour en stock');
   button.type='button';button.disabled=watchBusy.size>0||pushBusy;button.setAttribute('aria-pressed',String(row.watching));
   button.addEventListener('click',()=>toggleWatch(row));
   const note=el('p','help',watchBusy.has(key)?'Enregistrement…':watchNotes.get(key)||(row.watching?'Suivi enregistré. La prochaine transition de zéro (ou moins) à une quantité disponible positive déclenchera une alerte.':row.available>0?'Déjà disponible : l’alerte concernera le prochain retour après une rupture.':'Choisis cette référence pour recevoir son prochain retour en stock.'));
   note.setAttribute('role','status');note.setAttribute('aria-live','polite');actions.append(button,note);card.append(summary,actions);
   card.addEventListener('toggle',()=>{if(card.isConnected){if(card.open)expanded.add(key);else expanded.delete(key)}});list.append(card)}
  if(!data.items.length)list.append(el('p','help','Aucune référence pour cette recherche.'));
  pageButtons();const alerts=$('stock-alerts');alerts.replaceChildren();
  alerts.append(el('p','help','Dernières alertes '+(company==='ALL'?'TR et GTA':company)+' · indépendantes de la recherche produit.'));
  for(const row of data.alerts){const card=el('article','settings-card');const kind={out_of_stock:'Rupture',back_in_stock:'Retour en stock',quantity_changed:'Variation'}[row.kind];
   card.append(el('strong','',row.company+' · '+kind+' · '+row.name),el('p','help',qty(row.previous)+' → '+qty(row.current)+' '+row.unit+' · '+date(row.at)));alerts.append(card)}
  if(!data.alerts.length)alerts.append(el('p','help','Aucune rupture ou retour détecté depuis le premier contrôle.'));
 }
 async function load(){
  if(!isAuthenticated()||busy)return;
  const ticket=guard.begin(),scope={company,query,offset};busy=true;$('stock-reload').disabled=true;pageButtons();$('stock-status').textContent='Lecture du dernier contrôle…';
  try{
   const result=await request('?company='+scope.company+'&q='+encodeURIComponent(scope.query)+'&offset='+scope.offset);
   if(!guard.isCurrent(ticket)||!isAuthenticated())return;data=normalizeStockSnapshot(result.data,scope);draw();
  }catch{if(guard.isCurrent(ticket)){
   $('stock-status').textContent='Lecture des stocks indisponible. Réessaie dans quelques instants.';
   if(data)$('stock-status').textContent+=' Dernière lecture conservée pour ce filtre ; quantités contrôlées le '+date(data.checkedAt)+'.';
  }}finally{if(guard.isCurrent(ticket)){busy=false;$('stock-reload').disabled=false;pageButtons()}}
 }
 function changeFilter(){guard.invalidate();busy=false;data=null;offset=0;clearRows();$('stock-reload').disabled=false;$('stock-status').textContent='Recherche en cours…'}
 async function finishPush(ticket){
  if(!current(ticket))return;pushBusy=false;
  let sub=null;try{sub=await (await ready()).pushManager.getSubscription()}catch{}
  if(current(ticket))pushButtons(sub);
 }
 async function activate(notifyAll=$('stock-push-scope').value==='all'){
  if(!supported()||!installed()||pushBusy||!isAuthenticated())return false;
  // Keep the permission request in the explicit button gesture.
  const ticket=session,permission=Notification.requestPermission();pushRevision++;pushBusy=true;pushButtons();
  try{
   const granted=await permission;if(!current(ticket))return;if(granted!=='granted')throw Error('permission');
   const [reg,key]=await Promise.all([ready(),request('?action=push-key')]);if(!current(ticket))return;
   const raw=atob(key.publicKey.replace(/-/g,'+').replace(/_/g,'/')),bytes=Uint8Array.from(raw,c=>c.charCodeAt(0));
   let sub=await reg.pushManager.getSubscription();if(!current(ticket))return;
   if(!sub)sub=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:bytes});if(!current(ticket))return;
   await request('?action=subscribe',{method:'POST',body:JSON.stringify({...sub.toJSON(),notify_all:notifyAll})});if(!current(ticket))return false;
   $('stock-push-scope').value=notifyAll?'all':'selected';
   $('stock-push-status').textContent='Notifications activées · '+(notifyAll?'toutes les références.':'retours des références suivies uniquement.')+' Appuie sur Tester pour confirmer la réception sur ce téléphone.';
   return true;
  }catch(e){if(current(ticket))$('stock-push-status').textContent=e.message==='permission'?'Notifications non autorisées. Tu peux les autoriser dans les réglages du téléphone.':'Activation incomplète : réessaie. Aucun appareil confirmé côté serveur.'}
  finally{await finishPush(ticket)}
  return false;
 }
 async function toggleWatch(row){
  if(!isAuthenticated()||watchBusy.size||pushBusy)return;
  const ticket=session,key=productKey(row),watching=!row.watching;let refresh=false;watchBusy.add(key);expanded.add(key);watchNotes.delete(key);
  // activate() requests permission synchronously from this explicit user gesture.
  const device=watching&&supported()&&installed()?activate(false):Promise.resolve(false);
  draw();
  try{
   const activated=await device;if(!current(ticket))return;
   if(watching&&supported()&&installed()&&!activated)throw Error('push_activation_failed');
   const result=await request('?action=watch',{method:'POST',body:JSON.stringify({company:row.company,product_id:row.id,watching})});if(!current(ticket))return;
   if(result.data?.company!==row.company||result.data?.product_id!==row.id||result.data?.watching!==watching)throw Error('watch_confirmation_failed');
   guard.invalidate();busy=false;$('stock-reload').disabled=false;
   refresh=true;
   for(const item of data?.items||[])if(productKey(item)===key)item.watching=watching;
   watchNotes.set(key,watching?(activated?'Alerte activée pour cette référence. Sur cet appareil : références suivies uniquement.':'Suivi enregistré. Active les notifications sur cet appareil pour recevoir l’alerte.'):('Alerte désactivée pour cette référence.'+($('stock-push-scope').value==='all'?' Le mode « Toutes les références » reste actif sur cet appareil.':'')));
   if(watching&&!activated){$('stock-notification-options').open=true;pushState()}
  }catch(e){if(current(ticket))watchNotes.set(key,e.message==='push_activation_failed'?'Notifications non activées : vérifie les autorisations de cet appareil.':'Enregistrement non confirmé. Réessaie ; aucune activation annoncée.');}
  finally{if(current(ticket)){watchBusy.delete(key);if(data)draw();if(refresh&&isActive())load()}}
 }
 async function pushAction(action){
  if(pushBusy||!isAuthenticated()||!supported()||!installed())return;const ticket=session;pushRevision++;pushBusy=true;pushButtons();
  try{
   const sub=await (await ready()).pushManager.getSubscription();if(!current(ticket))return;if(!sub)throw Error();
   await request('?action='+action,{method:'POST',body:JSON.stringify(sub.toJSON())});if(!current(ticket))return;
   if(action==='unsubscribe'){
    await sub.unsubscribe();if(!current(ticket))return;$('stock-push-status').textContent='Notifications désactivées sur cet appareil.';
   }else $('stock-push-status').textContent='Notification de test acceptée par le service du téléphone. Vérifie sa réception.';
  }catch{if(current(ticket))$('stock-push-status').textContent=action==='unsubscribe'?'Désactivation incomplète : réessaie.':'Le test a échoué. Réactive les notifications.'}
  finally{await finishPush(ticket)}
 }
 $('stock-push-enable').addEventListener('click',()=>activate());
 $('stock-push-test').addEventListener('click',()=>pushAction('test'));
 $('stock-push-stop').addEventListener('click',()=>pushAction('unsubscribe'));
 $('stock-reload').addEventListener('click',()=>{clearTimeout(searchTimer);load()});
 $('stock-company').addEventListener('change',e=>{company=e.target.value;clearTimeout(searchTimer);changeFilter();load()});
 $('stock-search').addEventListener('input',e=>{query=e.target.value.slice(0,120);clearTimeout(searchTimer);changeFilter();searchTimer=setTimeout(load,300)});
 $('stock-prev').addEventListener('click',()=>{if(busy||!data||offset===0)return;offset=Math.max(0,offset-50);data=null;clearRows();load()});
 $('stock-next').addEventListener('click',()=>{if(busy||!data||offset+data.items.length>=data.total||offset+50>10000)return;offset+=50;data=null;clearRows();load()});
 return {open(){load();pushState();if(!timer)timer=setInterval(()=>{if(isActive()&&!busy)load()},60000)},reset(){
  session++;guard.invalidate();clearInterval(timer);clearTimeout(searchTimer);timer=null;busy=false;pushBusy=false;data=null;offset=0;query='';company='ALL';
  expanded.clear();watchBusy.clear();watchNotes.clear();$('stock-push-scope').value='selected';$('stock-push-scope').disabled=true;
  $('stock-search').value='';$('stock-company').value='ALL';clearRows();$('stock-status').textContent='Connecte-toi pour consulter les stocks.';$('stock-reload').disabled=false;
  $('stock-push-status').textContent='Connecte-toi pour gérer les notifications.';for(const id of ['stock-push-enable','stock-push-test','stock-push-stop'])$(id).disabled=true;
 }};
}
