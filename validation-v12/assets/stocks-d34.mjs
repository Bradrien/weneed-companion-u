import {createRequestGuard} from './request-guard.mjs';
import {normalizeStockSnapshot} from './stock-model-d34.mjs';
const el=(tag,cls,value)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(value!==undefined)n.textContent=String(value);return n};
const qty=n=>new Intl.NumberFormat('fr-FR',{maximumFractionDigits:3}).format(n);
const date=s=>s?new Date(s).toLocaleString('fr-FR'):'Aucun contrôle terminé';
export function createStocks({request,isActive,isAuthenticated}){
 const $=id=>document.getElementById(id),guard=createRequestGuard();
 let company='ALL',query='',offset=0,data=null,timer=null,searchTimer=null,registration=null,busy=false,pushBusy=false,session=0;
 const supported=()=> 'serviceWorker' in navigator&&'PushManager' in window&&'Notification' in window;
 const installed=()=>!(/iPad|iPhone|iPod/.test(navigator.userAgent))||navigator.standalone||matchMedia('(display-mode: standalone)').matches;
 const ready=()=>registration||(registration=navigator.serviceWorker.register('./sw.js',{scope:'./',updateViaCache:'none'}).then(()=>navigator.serviceWorker.ready).catch(e=>{registration=null;throw e}));
 const current=ticket=>ticket===session&&isAuthenticated();
 if(supported())ready().catch(()=>{});
 function pushButtons(sub=false){
  const usable=isAuthenticated()&&supported()&&installed();
  $('stock-push-enable').disabled=!usable||pushBusy;
  $('stock-push-test').disabled=!usable||!sub||pushBusy;$('stock-push-stop').disabled=!usable||!sub||pushBusy;
 }
 async function pushState(){
  const ticket=session;
  if(!isAuthenticated())return;
  if(!supported()||!installed()){
   $('stock-push-status').textContent='Sur iPhone : ouvrir ce lien dans Safari, puis Partager → Sur l’écran d’accueil. Ouvrir ensuite l’icône WeNeed.';pushButtons();return;
  }
  try{
   const reg=await ready(),sub=await reg.pushManager.getSubscription();if(!current(ticket)||pushBusy)return;
   $('stock-push-status').textContent=sub?'Un abonnement existe sur cet appareil. Utilise « Tester » pour vérifier son enregistrement et la réception.':'Active les notifications pour recevoir les ruptures et retours en stock.';pushButtons(sub);
  }catch{if(current(ticket)&&!pushBusy){$('stock-push-status').textContent='Notifications indisponibles sur cet appareil.';pushButtons()}}
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
  for(const row of data.items){const card=el('article','settings-card stock-card');const heading=el('div','section-heading');heading.append(el('h3','',row.name),el('strong',row.available<=0?'stock-zero':'green-text',qty(row.available)+' '+row.unit));
   card.append(heading,el('p','help',row.company+' · '+(row.sku||'Sans référence SKU')),
    el('p','help',(row.basis==='free_qty'?'Disponible après réservations':'En stock physique (réservations non déduites)')+' · Physique : '+qty(row.onHand)+' '+row.unit));list.append(card)}
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
 async function activate(){
  if(!supported()||!installed()||pushBusy||!isAuthenticated())return;
  // Keep the permission request in the explicit button gesture.
  const ticket=session,permission=Notification.requestPermission();pushBusy=true;pushButtons();
  try{
   const granted=await permission;if(!current(ticket))return;if(granted!=='granted')throw Error('permission');
   const [reg,key]=await Promise.all([ready(),request('?action=push-key')]);if(!current(ticket))return;
   const raw=atob(key.publicKey.replace(/-/g,'+').replace(/_/g,'/')),bytes=Uint8Array.from(raw,c=>c.charCodeAt(0));
   let sub=await reg.pushManager.getSubscription();if(!current(ticket))return;
   if(!sub)sub=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:bytes});if(!current(ticket))return;
   await request('?action=subscribe',{method:'POST',body:JSON.stringify(sub.toJSON())});if(!current(ticket))return;
   $('stock-push-status').textContent='Notifications activées. Appuie sur Tester pour confirmer la réception sur ce téléphone.';
  }catch(e){if(current(ticket))$('stock-push-status').textContent=e.message==='permission'?'Notifications non autorisées. Tu peux les autoriser dans les réglages du téléphone.':'Activation incomplète : réessaie. Aucun appareil confirmé côté serveur.'}
  finally{await finishPush(ticket)}
 }
 async function pushAction(action){
  if(pushBusy||!isAuthenticated()||!supported()||!installed())return;const ticket=session;pushBusy=true;pushButtons();
  try{
   const sub=await (await ready()).pushManager.getSubscription();if(!current(ticket))return;if(!sub)throw Error();
   await request('?action='+action,{method:'POST',body:JSON.stringify(sub.toJSON())});if(!current(ticket))return;
   if(action==='unsubscribe'){
    await sub.unsubscribe();if(!current(ticket))return;$('stock-push-status').textContent='Notifications désactivées sur cet appareil.';
   }else $('stock-push-status').textContent='Notification de test acceptée par le service du téléphone. Vérifie sa réception.';
  }catch{if(current(ticket))$('stock-push-status').textContent=action==='unsubscribe'?'Désactivation incomplète : réessaie.':'Le test a échoué. Réactive les notifications.'}
  finally{await finishPush(ticket)}
 }
 $('stock-push-enable').addEventListener('click',activate);
 $('stock-push-test').addEventListener('click',()=>pushAction('test'));
 $('stock-push-stop').addEventListener('click',()=>pushAction('unsubscribe'));
 $('stock-reload').addEventListener('click',()=>{clearTimeout(searchTimer);load()});
 $('stock-company').addEventListener('change',e=>{company=e.target.value;clearTimeout(searchTimer);changeFilter();load()});
 $('stock-search').addEventListener('input',e=>{query=e.target.value.slice(0,120);clearTimeout(searchTimer);changeFilter();searchTimer=setTimeout(load,300)});
 $('stock-prev').addEventListener('click',()=>{if(busy||!data||offset===0)return;offset=Math.max(0,offset-50);data=null;clearRows();load()});
 $('stock-next').addEventListener('click',()=>{if(busy||!data||offset+data.items.length>=data.total||offset+50>10000)return;offset+=50;data=null;clearRows();load()});
 return {open(){load();pushState();if(!timer)timer=setInterval(()=>{if(isActive()&&!busy)load()},60000)},reset(){
  session++;guard.invalidate();clearInterval(timer);clearTimeout(searchTimer);timer=null;busy=false;pushBusy=false;data=null;offset=0;query='';company='ALL';
  $('stock-search').value='';$('stock-company').value='ALL';clearRows();$('stock-status').textContent='Connecte-toi pour consulter les stocks.';$('stock-reload').disabled=false;
  $('stock-push-status').textContent='Connecte-toi pour gérer les notifications.';for(const id of ['stock-push-enable','stock-push-test','stock-push-stop'])$(id).disabled=true;
 }};
}
