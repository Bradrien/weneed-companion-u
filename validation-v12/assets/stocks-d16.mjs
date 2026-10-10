import {createRequestGuard} from './request-guard.mjs';
const el=(tag,cls,value)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(value!==undefined)n.textContent=String(value);return n};
const qty=n=>new Intl.NumberFormat('fr-FR',{maximumFractionDigits:3}).format(n);
const date=s=>s?new Date(s).toLocaleString('fr-FR'):'Aucun contrôle terminé';
export function createStocks({request,isActive,isAuthenticated}){
 const $=id=>document.getElementById(id),guard=createRequestGuard();
 let company='ALL',query='',offset=0,data=null,timer=null,searchTimer=null,registration=null,busy=false,pushBusy=false;
 const supported=()=> 'serviceWorker' in navigator&&'PushManager' in window&&'Notification' in window;
 const installed=()=>!(/iPad|iPhone|iPod/.test(navigator.userAgent))||navigator.standalone||matchMedia('(display-mode: standalone)').matches;
 const ready=()=>registration||(registration=navigator.serviceWorker.register('./sw.js',{scope:'./',updateViaCache:'none'}).then(()=>navigator.serviceWorker.ready).catch(e=>{registration=null;throw e}));
 if(supported())ready().catch(()=>{});
 async function pushState(){
  if(!supported()||!installed()){$('stock-push-status').textContent='Sur iPhone : ouvrir ce lien dans Safari, puis Partager → Sur l’écran d’accueil. Ouvrir ensuite l’icône WeNeed.';$('stock-push-enable').disabled=true;return}
  try{const reg=await ready(),sub=await reg.pushManager.getSubscription();
   $('stock-push-status').textContent=sub?'Cet appareil est abonné aux alertes. Utilise « Tester » pour vérifier leur réception.':'Active les notifications pour recevoir les ruptures et retours en stock.';
   $('stock-push-enable').disabled=pushBusy;$('stock-push-test').disabled=!sub||pushBusy;$('stock-push-stop').disabled=!sub||pushBusy;
  }catch{$('stock-push-status').textContent='Notifications indisponibles sur cet appareil.'}
 }
 function draw(){
  const cards=$('stock-summary');cards.replaceChildren();
  for(const row of data.summary||[]){const card=el('article','metric');card.append(el('span','metric-label',row.company+' · références'),el('strong','',row.products),el('small','',row.out_of_stock+' indisponibles'));cards.append(card)}
  $('stock-status').textContent='Dernier contrôle : '+date(data.checked_at)+' · toutes les 5 minutes'+(data.stale?' · Données anciennes : contrôle à vérifier.':'')+(data.last_error?' · Le dernier contrôle a échoué ; les dernières quantités connues sont conservées.':'');
  $('stock-count').textContent=data.total+' référence(s) · '+(data.items.length?`${offset+1}–${offset+data.items.length}`:'0 résultat');
  const list=$('stock-list');list.replaceChildren();
  for(const row of data.items){const card=el('article','settings-card stock-card');const heading=el('div','section-heading');heading.append(el('h3','',row.product_name),el('strong',row.available_quantity<=0?'stock-zero':'green-text',qty(row.available_quantity)+' '+row.unit));
   card.append(heading,el('p','help',row.company+' · '+(row.sku||'Sans référence SKU')),
    el('p','help',(row.quantity_basis==='free_qty'?'Disponible après réservations':'En stock physique (réservations non déduites)')+' · Physique : '+qty(row.on_hand_quantity)+' '+row.unit));list.append(card)}
  if(!data.items.length)list.append(el('p','help','Aucune référence pour cette recherche.'));
  $('stock-prev').disabled=offset===0;$('stock-next').disabled=offset+data.items.length>=data.total;
  const alerts=$('stock-alerts');alerts.replaceChildren();
  for(const row of data.alerts){const card=el('article','settings-card');const kind={out_of_stock:'Rupture',back_in_stock:'Retour en stock',quantity_changed:'Variation'}[row.kind]||'Stock';
   card.append(el('strong','',row.company+' · '+kind+' · '+row.product_name),el('p','help',qty(row.previous_quantity)+' → '+qty(row.current_quantity)+' '+row.unit+' · '+date(row.created_at)));alerts.append(card)}
  if(!data.alerts.length)alerts.append(el('p','help','Aucune rupture ou retour détecté depuis le premier contrôle.'));
 }
 async function load(){
  if(!isAuthenticated())return;
  const ticket=guard.begin();busy=true;$('stock-reload').disabled=true;$('stock-status').textContent='Lecture du dernier contrôle…';
  try{const result=await request('?company='+company+'&q='+encodeURIComponent(query)+'&offset='+offset);if(!guard.isCurrent(ticket))return;data=result.data;draw()}
  catch{if(guard.isCurrent(ticket)){$('stock-status').textContent='Lecture des stocks indisponible. Réessaie dans quelques instants.';if(data)$('stock-status').textContent+=' Les quantités affichées datent du '+date(data.checked_at)+'.'}}
  finally{if(guard.isCurrent(ticket)){busy=false;$('stock-reload').disabled=false}}
 }
 async function activate(){
  if(!supported()||!installed()||pushBusy||!isAuthenticated())return;
  // Request permission directly from this button gesture, before waiting for network calls.
  const permission=Notification.requestPermission();pushBusy=true;
  try{if(await permission!=='granted')throw Error('permission');const [reg,key]=await Promise.all([ready(),request('?action=push-key')]);
   const raw=atob(key.publicKey.replace(/-/g,'+').replace(/_/g,'/'));const bytes=Uint8Array.from(raw,c=>c.charCodeAt(0));
   let sub=await reg.pushManager.getSubscription();if(!sub)sub=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:bytes});
   if(!isAuthenticated())return;await request('?action=subscribe',{method:'POST',body:JSON.stringify(sub.toJSON())});
   $('stock-push-status').textContent='Notifications activées. Appuie sur Tester pour confirmer la réception sur ce téléphone.';
  }catch(e){$('stock-push-status').textContent=e.message==='permission'?'Notifications non autorisées. Tu peux les autoriser dans les réglages du téléphone.':'Activation incomplète : réessaie. Aucun appareil confirmé côté serveur.'}
  finally{pushBusy=false;$('stock-push-enable').disabled=false;let sub=null;try{sub=await (await ready()).pushManager.getSubscription()}catch{}$('stock-push-test').disabled=!sub;$('stock-push-stop').disabled=!sub}
 }
 $('stock-push-enable').addEventListener('click',activate);
 $('stock-push-test').addEventListener('click',async()=>{if(pushBusy||!isAuthenticated())return;pushBusy=true;try{const sub=await (await ready()).pushManager.getSubscription();if(!sub)throw Error();await request('?action=test',{method:'POST',body:JSON.stringify(sub.toJSON())});$('stock-push-status').textContent='Notification de test acceptée par le service du téléphone. Vérifie sa réception.'}catch{$('stock-push-status').textContent='Le test a échoué. Réactive les notifications.'}finally{pushBusy=false}});
 $('stock-push-stop').addEventListener('click',async()=>{if(pushBusy||!isAuthenticated())return;pushBusy=true;try{const sub=await (await ready()).pushManager.getSubscription();if(sub){await request('?action=unsubscribe',{method:'POST',body:JSON.stringify(sub.toJSON())});await sub.unsubscribe()}pushBusy=false;await pushState()}catch{$('stock-push-status').textContent='Désactivation incomplète : réessaie.'}finally{pushBusy=false}});
 $('stock-reload').addEventListener('click',load);
 $('stock-company').addEventListener('change',e=>{company=e.target.value;offset=0;load()});
 $('stock-search').addEventListener('input',e=>{query=e.target.value.slice(0,120);offset=0;clearTimeout(searchTimer);searchTimer=setTimeout(load,300)});
 $('stock-prev').addEventListener('click',()=>{offset=Math.max(0,offset-50);load()});$('stock-next').addEventListener('click',()=>{offset+=50;load()});
 return {open(){load();pushState();if(!timer)timer=setInterval(()=>{if(isActive()&&!busy)load()},60000)},reset(){guard.invalidate();clearInterval(timer);clearTimeout(searchTimer);timer=null;busy=false;data=null;offset=0;query='';company='ALL';$('stock-search').value='';$('stock-company').value='ALL';for(const id of ['stock-list','stock-alerts','stock-summary'])$(id).replaceChildren();$('stock-count').textContent='';$('stock-status').textContent='Connecte-toi pour consulter les stocks.';$('stock-reload').disabled=false}};
}
