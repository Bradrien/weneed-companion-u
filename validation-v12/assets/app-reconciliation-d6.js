import {createRequestGuard} from './request-guard.mjs';
import {createRefreshGate} from './auth-guard.mjs';
import {normalizeClientList,normalizeClientCard,normalizeCrmDashboard,validClientId} from './clients-model.mjs';
import {API_BASE,SUPABASE_PUBLISHABLE_KEY as KEY} from './config.js';
import {catalogLineDetail,renderCatalogCommissions,renderReconciliationAudit} from './reconciliation-d6.mjs';
import {formatMoney,statusText,lineText,shortDate,monthOf,prevCompleteMonth,assertReport,filteredOrders,deriveStats,isDateRangeValid} from './model.mjs';
const $=x=>document.getElementById(x);
const state={access:null,refresh:null,exp:0,report:null,view:'home',period:prevCompleteMonth(),company:'ALL',orderState:'all',query:'',page:1,expanded:new Set(),loading:false,refreshTimer:null};
const STORE='weneed_v1_ephemeral_session';
const reportRequests=createRequestGuard();
const clientRequests=createRequestGuard();
const dashboardRequests=createRequestGuard();
const odooProbeRequests=createRequestGuard();
const dashboard={data:null,loading:false,error:''};
const clients={rows:null,query:'',selected:null,detail:null,loading:false,error:'',timer:null};
const refreshGate=createRefreshGate();
const publicHeaders={'apikey':KEY,'content-type':'application/json'};
const text=(value)=>document.createTextNode(String(value??''));
const node=(tag,cls,textValue)=>{const x=document.createElement(tag);if(cls)x.className=cls;if(textValue!==undefined)x.textContent=String(textValue);return x};
const clear=(el)=>el.replaceChildren();
function setNotice(message,type='info'){$('notice-text').textContent=message;$('notice').className='notice'+(type==='info'?'':` ${type}`)}
function loading(on){state.loading=on;$('loading').classList.toggle('hidden',!on);$('reload').disabled=on}
function getStored(){try{const s=JSON.parse(sessionStorage.getItem(STORE)||'null');return s&&typeof s.access==='string'&&typeof s.refresh==='string'&&Number.isFinite(s.exp)?s:null}catch{return null}}
function saveSession(data){state.access=data.access_token;state.refresh=data.refresh_token;state.exp=Math.floor(Date.now()/1000)+(data.expires_in||3600);try{sessionStorage.setItem(STORE,JSON.stringify({access:state.access,refresh:state.refresh,exp:state.exp}))}catch{}scheduleRefresh()}
function forget(){refreshGate.invalidate();reportRequests.invalidate();clientRequests.invalidate();dashboardRequests.invalidate();odooProbeRequests.invalidate();$('odoo-probe-status').textContent='Test non lancé.';$('odoo-probe').disabled=false;dashboard.data=null;dashboard.loading=false;dashboard.error='';if(clients.timer)clearTimeout(clients.timer);clients.query='';$('client-search').value='';clients.rows=null;clients.detail=null;clients.selected=null;clients.error='';clients.loading=false;loading(false);state.access=null;state.refresh=null;state.exp=0;state.report=null;state.expanded.clear();if(state.refreshTimer)clearTimeout(state.refreshTimer);try{sessionStorage.removeItem(STORE)}catch{}}
function scheduleRefresh(){if(state.refreshTimer)clearTimeout(state.refreshTimer);if(!state.access||!state.refresh)return;const ms=Math.max(25000,Math.min((state.exp*1000-Date.now()-85000),2147483647));state.refreshTimer=setTimeout(()=>refreshTokens().catch(()=>{}),ms)}
async function authFetch(path,init={}){return fetch(API_BASE+path,{...init,headers:{...publicHeaders,...(init.headers||{})},cache:'no-store',redirect:'error'})}
async function refreshTokens(){
 if(!state.refresh)throw Error('no_session');
 return refreshGate.run(async isCurrent=>{
  const token=state.refresh;
  if(!token)throw Error('no_session');
  const res=await authFetch('/auth/v1/token?grant_type=refresh_token',{method:'POST',body:JSON.stringify({refresh_token:token})});
  if(!isCurrent())throw Error('session_changed');
  if(!res.ok){forget();showLogin();throw Error('session_expired')}
  const data=await res.json();
  if(!isCurrent())throw Error('session_changed');
  if(!data?.access_token||!data?.refresh_token)throw Error('invalid_session');
  saveSession(data);
 });
}
async function ensureToken(){if(!state.access)throw Error('no_session');if(state.exp*1000<Date.now()+45000)await refreshTokens();if(!state.access)throw Error('no_session');return state.access}
async function ownerCheck(){const jwt=await ensureToken();const res=await authFetch('/functions/v1/companion-profile',{headers:{'authorization':`Bearer ${jwt}`}});if(res.status===401||res.status===403)throw Error('owner_only');if(!res.ok)throw Error('profile_unavailable');const data=await res.json();if(data.ok!==true||data.role!=='owner')throw Error('owner_only')}
async function login(email,password){forget();const res=await authFetch('/auth/v1/token?grant_type=password',{method:'POST',body:JSON.stringify({email,password})});if(!res.ok)throw Error('invalid_credentials');const data=await res.json();if(!data.access_token||!data.refresh_token)throw Error('invalid_session');saveSession(data);try{await ownerCheck()}catch(e){forget();throw e}}
async function signOut(){const jwt=state.access;forget();showLogin();if(jwt)try{await authFetch('/auth/v1/logout',{method:'POST',headers:{authorization:`Bearer ${jwt}`}})}catch{}}
async function checkOdooReadAccess(){
 if(!state.access)return;
 const ticket=odooProbeRequests.begin();
 const button=$('odoo-probe'),status=$('odoo-probe-status');
 let phase='ping';
 button.disabled=true;status.textContent='Vérification de l’authentification Odoo…';
 async function check(resource){
  const jwt=await ensureToken();
  const response=await authFetch('/functions/v1/odoo-read?resource='+encodeURIComponent(resource),
   {headers:{authorization:`Bearer ${jwt}`}});
  let data;try{data=await response.json()}catch{throw Object.assign(Error('invalid_odoo_response'),{httpStatus:response.status})}
  if(!response.ok||data?.ok!==true){
   const safeCode=typeof data?.error==='string'&&/^[a-z][a-z0-9_]{2,60}$/.test(data.error)
    ?data.error:'server_response_error';
   throw Object.assign(Error(safeCode),{httpStatus:response.status});
  }
  return data.data;
 }
 try{
  const auth=await check('ping');
  if(!odooProbeRequests.isCurrent(ticket))return;
  if(auth?.connected!==true||auth?.mode!=='read_only')throw Error('invalid_odoo_response');
  phase='orders_probe';
  status.textContent='Authentification Odoo validée. Vérification des droits de lecture…';
  const result=await check('orders_probe');
  if(!odooProbeRequests.isCurrent(ticket))return;
  if(result?.readable!==true||result?.returned_order_data!==false)throw Error('invalid_odoo_response');
  $('odoo-state').textContent='Accès lecture validé';
  status.textContent='Connexion Odoo opérationnelle : authentification et autorisation de lecture validées, sans récupération du contenu des commandes.';
 }catch(error){
  if(!odooProbeRequests.isCurrent(ticket))return;
  $('odoo-state').textContent='Vérification échouée';
  const raw=error instanceof Error?error.message:'';
  const code=/^[a-z][a-z0-9_]{2,60}$/.test(raw)?raw:
   /fetch|network|load failed/i.test(raw)?'network_error':'request_error';
  const http=Number.isInteger(error?.httpStatus)?' · HTTP '+error.httpStatus:'';
  const initial='Diagnostic Odoo ['+phase+' · '+code+http+'] : '+readableError(code);
  status.textContent=initial;
  if(phase==='ping'&&code==='odoo_credentials_rejected'){
   status.textContent=initial+' Vérification complémentaire avec l’UID Odoo attendu…';
   try{
    const probe=await check('credential_probe');
    if(!odooProbeRequests.isCurrent(ticket))return;
    if(probe?.pinned_credentials_accepted!==true||probe?.returned_order_data!==false)
     throw Error('invalid_odoo_response');
    status.textContent=initial+' La clé fonctionne avec l’UID attendu : le login Odoo configuré est probablement incorrect.';
   }catch(probeError){
    if(!odooProbeRequests.isCurrent(ticket))return;
    const rawProbe=probeError instanceof Error?probeError.message:'';
    const probeCode=/^[a-z][a-z0-9_]{2,60}$/.test(rawProbe)?rawProbe:'request_error';
    const httpProbe=Number.isInteger(probeError?.httpStatus)?' · HTTP '+probeError.httpStatus:'';
    status.textContent=initial+' Test UID direct ['+probeCode+httpProbe+'] : '+readableError(probeCode);
   }
  }
 }finally{if(odooProbeRequests.isCurrent(ticket))button.disabled=false}
}
function showLogin(){$('login-panel').classList.remove('hidden');$('app-panel').classList.add('hidden');$('bottom-nav').classList.add('hidden');$('logout-top').classList.add('hidden')}
function showApp(){$('login-panel').classList.add('hidden');$('app-panel').classList.remove('hidden');$('bottom-nav').classList.remove('hidden');$('logout-top').classList.remove('hidden');navigate(state.view)}
function readableError(code){return ({owner_only:'Le compte connecté ne dispose pas de l’accès propriétaire.',invalid_credentials:'Identifiants refusés. Vérifie le mot de passe Companion.',invalid_session:'Session incomplète.',session_expired:'Ta session a expiré. Reconnecte-toi.',no_session:'Session absente.',profile_unavailable:'Vérification de l’accès propriétaire indisponible.',invalid_period:'Période incorrecte (maximum 94 jours).',source_record_limit_exceeded:'Trop de commandes ou de lignes pour cette période : choisis une période plus courte.',invalid_odoo_configuration:'Configuration de l’accès Odoo invalide côté Supabase.',odoo_unreachable:'Odoo ne répond pas pour le moment.',origin_not_allowed:'Origine du navigateur non autorisée pour la passerelle Odoo.',network_error:'La requête n’atteint pas le serveur (réseau, certificat ou autorisation CORS).',upstream_failure:'La passerelle Odoo a rencontré une erreur serveur inattendue.',request_error:'Échec de la requête de diagnostic.',server_response_error:'La passerelle a renvoyé un code d’erreur non reconnu.',diagnostic_unavailable:'Diagnostic Odoo indisponible.',odoo_http_error:'La passerelle Odoo a refusé la requête HTTP. Code de diagnostic : odoo_http_error.',odoo_remote_error:'Odoo a renvoyé une erreur lors de la lecture. Code de diagnostic : odoo_remote_error.',review_unavailable:'Le rapport n’a pas pu être généré côté serveur. Code : review_unavailable.',odoo_uid_pin_not_configured:'UID Odoo attendu absent de la configuration Supabase.',odoo_pinned_read_rejected:'La clé actuelle n’autorise pas la lecture avec l’UID attendu ; clé, base ou permissions à contrôler.',odoo_credentials_rejected:'Odoo refuse le couple login / base / clé API.',odoo_auth_failed:'Ta connexion Companion est valide, mais la connexion serveur à Odoo est refusée. Vérifie la configuration Odoo côté Supabase (compte, clé API et identité attendue). Changer le mot de passe Companion ne résoudra pas ce problème.',odoo_not_configured:'Paramètres Odoo manquants côté Supabase.',invalid_odoo_response:'Réponse Odoo inattendue.',unmatched_order_line:'Une ligne Odoo n’a pas pu être rattachée à sa commande.',invalid_report:'Rapport invalide.',incomplete_report:'Rapport incomplet.',unverified_commissions_guard:'Rapport de commissions inattendu ; affichage bloqué par sécurité.',report_period_mismatch:'La réponse Odoo concerne une autre période. Aucune donnée affichée : recharge le mois.',catalog_unavailable:'Catalogue Kino indisponible, Odoo seul reste consultable.',catalog_incomplete:'Capture Kino incomplète.',catalog_invalid:'Produit Kino invalide.',invalid_orders:'Commandes incohérentes.'})[code]||'La lecture a échoué. Réessaie ou consulte les journaux Supabase.'}
async function loadReport(){
 if(!state.access||state.loading)return;
 const {from,to}=state.period;
 if(!isDateRangeValid(from,to)){setNotice('Choisis une période de moins de 94 jours.','error');return}
 const request=reportRequests.begin();
 loading(true);setNotice('Consultation et rapprochement des commandes Odoo en lecture seule…');
 try{
  const jwt=await ensureToken();
  const suffix=`?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
  async function reportFrom(route){
   const response=await authFetch(`/functions/v1/${route}${suffix}`,{headers:{authorization:`Bearer ${jwt}`}});
   let data;try{data=await response.json()}catch{throw Error('invalid_odoo_response')}
   if(!response.ok||data.ok!==true)throw Error(data.error||('http_'+response.status));
   return data.data;
  }
  let report,usedFallback=false;
  try{report=await reportFrom('commission-catalog-review')}
  catch(error){
   // Only catalog/pipeline failures fall back; never downgrade an access denial.
   if(!['catalog_unavailable','catalog_incomplete','catalog_invalid','review_unavailable'].includes(error.message))throw error;
   report=await reportFrom('commission-review');usedFallback=true;
  }
  if(!reportRequests.isCurrent(request))return;
  state.report=assertReport(report,{from,to});
  state.page=1;state.expanded.clear();
  $('odoo-state').textContent='Lecture validée';
  const k=state.report.catalog_matching;
  $('kino-state').textContent=k?`Catalogue ${state.report.catalog_snapshot.products_total} produits · Rapproché`:'Rapprochement non disponible';
  setNotice(usedFallback?
   `${state.report.orders_count} commandes examinées. Catalogue Kino temporairement indisponible ; aucune commission calculée.`:
   `${state.report.orders_count} commandes · ${k.matched}/${k.eligible} lignes éligibles retrouvées dans Kino. Aucun montant de commission calculé.`,usedFallback?'warn':'info');
  renderViews();
 }catch(error){
  if(!reportRequests.isCurrent(request))return;
  state.report=null;$('odoo-state').textContent='Lecture non validée';$('kino-state').textContent='Non vérifié';
  setNotice(readableError(error.message),'error');renderViews();
 }finally{if(reportRequests.isCurrent(request))loading(false)}
}
function changeMonth(delta){reportRequests.invalidate();loading(false);const y=Number(state.period.from.slice(0,4)),m=Number(state.period.from.slice(5,7))-1;state.period=monthOf(new Date(y,m+delta,1));state.report=null;state.page=1;state.expanded.clear();updatePeriod();renderViews();setNotice('Période changée. Appuie sur ↻ pour consulter Odoo.');}
function updatePeriod(){$('period-label').textContent=state.period.label}
function navigate(view){if(!['home','orders','clients','commissions','settings'].includes(view))return;state.view=view;const names={home:['ACCUEIL','Vue d’ensemble','Le suivi de ton activité GTA et Trim Rocket.'],orders:['COMMERCIAL','Commandes Odoo','Les ventes et leurs lignes, directement depuis Odoo.'],clients:['CRM PRIVÉ','Clients','Contacts, tâches et historique commercial en lecture seule.'],commissions:['RÉMUNÉRATION','Commissions','Préparation et réconciliation avant Kino.'],settings:['COMPTE','Paramètres','Statut des connexions et sécurité.']};$('page-eyebrow').textContent=names[view][0];$('page-title').textContent=names[view][1];$('page-subtitle').textContent=names[view][2];document.querySelectorAll('.view').forEach(el=>el.classList.toggle('hidden',el.id!==`view-${view}`));document.querySelectorAll('[data-nav]').forEach(el=>el.classList.toggle('active',el.dataset.nav===view));window.scrollTo({top:0,behavior:'instant'});renderViews();if(view==='clients'&&clients.rows===null&&!clients.loading&&!clients.selected)loadClients();if(view==='home'&&dashboard.data===null&&!dashboard.loading&&!dashboard.error)loadDashboard()}
function metric(label,value,sub,{dark=false,small=false}={}){const el=node('article','metric'+(dark?' dark':''));el.append(node('span','metric-label',label),node('strong',small?'small':'',value),node('small','',sub));return el}
function renderStats(){const list=state.report?.orders||[],stats=deriveStats(list);const grid=$('metrics');clear(grid);grid.append(metric('Commandes GTA/TR',state.report?String(stats.visible):'—','Sur la période'),metric('Commandes confirmées',state.report?String(stats.confirmed):'—','Statuts sale et done'),metric('Montant HT confirmé',state.report&&stats.sourceAmount!==null?formatMoney(stats.sourceAmount,stats.sourceCurrency):'—','Chiffre d’affaires, pas commission',{small:true}),metric('Commissions', 'À vérifier','Attente des règles Kino',{dark:true,small:true}));
 const c=$('commission-facts');clear(c);c.append(metric('GTA • confirmées',state.report?String(list.filter(o=>o.company==='GTA'&&['sale','done'].includes(o.state)).length):'—','Calcul en attente'),metric('TR • confirmées',state.report?String(list.filter(o=>o.company==='TR'&&['sale','done'].includes(o.state)).length):'—','Calcul en attente'),metric('À exclure',state.report?String(stats.excluded):'—','Annulées, brouillons et autres'),metric('Commissions validées','—','Rapprochement Kino requis',{dark:true,small:true}));
}
function orderCard(order){const outer=node('article','order-card');const btn=node('button','order-button');btn.type='button';btn.setAttribute('aria-expanded',state.expanded.has(String(order.id))?'true':'false');btn.setAttribute('aria-label',`Voir les lignes de ${order.reference||'commande'}`);
 const left=node('div');const top=node('div','order-topline');top.append(node('span','reference',order.reference||'Sans référence'),node('span','company-chip'+(order.company==='TR'?' tr':''),order.company));left.append(top,node('span','order-customer',order.client||'Client non renseigné'),node('span','order-meta',shortDate(order.date)+' · '+(order.salesperson||'Commercial indisponible')));
 const right=node('div','order-value');right.append(node('strong','',formatMoney(order.amount_ht,order.currency||'EUR')));let suffix=statusText(order.state);const b=node('small','',suffix+(order.issues?.length?' · À contrôler':''));right.append(b);btn.append(left,right);outer.append(btn);
 if(state.expanded.has(String(order.id))){const detail=node('div','order-details');const flagrow=node('div');for(const flag of (order.issues||[]))flagrow.append(node('span','flag',flagLabel(flag)));detail.append(flagrow);if(!order.lines.length)detail.append(node('div','empty','Aucune ligne retournée pour cette commande.'));
 for(const l of order.lines){const row=node('div','detail-row');const left=node('div');left.append(node('div','detail-product',l.product_name||'Produit non renseigné'),node('div','detail-sub',(l.sku||'Sans SKU')+' · Quantité : '+fmtNumber(l.quantity)+' · PU : '+formatMoney(l.unit_price,order.currency||'EUR')+' · Remise : '+fmtNumber(l.discount_pct)+' %'));
 const cd=catalogLineDetail(l.catalog_match);
 if(cd)left.append(node('div','detail-match'+(l.catalog_match?.status==='matched'?' success':' warn'),cd));
 const right=node('div','detail-value');right.append(node('span','',formatMoney(l.line_ht,order.currency||'EUR')),node('span','detail-kind',lineText(l.kind)));row.append(left,right);detail.append(row)}
 const foot=node('div','detail-footer');foot.append(node('div','',`Total Odoo : ${formatMoney(order.amount_ht,order.currency||'EUR')} · Somme des lignes : ${formatMoney(order.line_sum_ht,order.currency||'EUR')}`),node('div','',`Écart : ${formatMoney(order.amount_difference,order.currency||'EUR')} · Commission : non calculée`));detail.append(foot);outer.append(detail)}
 btn.addEventListener('click',()=>{const key=String(order.id);if(state.expanded.has(key))state.expanded.delete(key);else state.expanded.add(key);renderViews()});return outer}
function flagLabel(k){return({unconfirmed_or_cancelled:'Commande non confirmée',confirmed_zero_ht_review:'HT confirmé à zéro',incomplete_source_amount:'Montant incomplet',lines_total_mismatch:'Écart de total HT',manual_line_review:'Ligne à vérifier',sample_policy_to_confirm:'Échantillon à vérifier',missing_client:'Client manquant',catalog_match_review:'SKU absent ou ambigu dans Kino',catalog_zero_price_review:'Coût/prix Kino à 0 €'})[k]||'Contrôle nécessaire'}
function fmtNumber(v){return typeof v==='number'&&Number.isFinite(v)?new Intl.NumberFormat('fr-FR',{maximumFractionDigits:2}).format(v):'—'}
function renderHome(){const rec=$('recent-orders');clear(rec);const review=$('review-cues');clear(review);if(!state.report){rec.append(empty('Pas encore de données. Appuie sur ↻ dans la barre de période pour lancer la lecture.'));review.append(empty('Aucun contrôle possible avant la lecture Odoo.'));return}
 const orders=state.report.orders.slice().sort((a,b)=>String(b.date).localeCompare(String(a.date))).slice(0,5);if(!orders.length)rec.append(empty('Aucune commande GTA/TR sur cette période.'));else for(const o of orders)rec.append(orderCard(o));
 const alerts=state.report.orders.filter(o=>(o.issues||[]).length).slice(0,4);if(!alerts.length)review.append(empty('Aucune anomalie signalée par les contrôles automatiques.'));else for(const a of alerts)review.append(cue(a.reference||'Commande',`${a.company} · ${a.issues.map(flagLabel).join(', ')}`));}
function cue(title,subtitle){const e=node('div','review-item');const left=node('div');left.append(node('h3','',title),node('span','',subtitle));e.append(left,node('span','','›'));return e}
function empty(msg){return node('div','empty',msg)}
function renderOrders(){const list=$('orders-list');clear(list);const subset=filteredOrders(state.report,{company:state.company,state:state.orderState,query:state.query});$('orders-count').textContent=state.report?`${subset.length} commande(s) trouvée(s)`:'Aucun rapport chargé';if(!state.report){list.append(empty('Charge une période avec le bouton ↻ pour consulter les commandes.'));$('load-more').classList.add('hidden');return}
 if(!subset.length)list.append(empty('Aucune commande correspondant à ces filtres.'));
 for(const o of subset.slice(0,15*state.page))list.append(orderCard(o));$('load-more').classList.toggle('hidden',subset.length<=15*state.page)}
function warningInFrench(v){return ({
 'Kino rules have not been verified: NO commission calculation':'Règles Kino non vérifiées : aucun calcul de commission',
 'Source order totals are not commissions owed':'Les montants Odoo ne sont pas des commissions acquises',
 'All orders filtered to authenticated Odoo salesperson':'Commandes filtrées sur le commercial Odoo authentifié',
 'Missing product SKU mappings require review':'Références SKU manquantes : vérification nécessaire',
 'Mixed source currencies: gross total disabled':'Plusieurs devises détectées : total HT global désactivé',
 'Some confirmed Odoo SKUs are absent from the Kino catalog':'Références Odoo absentes du catalogue Kino',
 'Some confirmed products lack an Odoo SKU':'Certaines lignes Odoo n’ont pas de SKU',
 'Matched Kino products include zero catalogue prices or costs':'Des coûts ou prix du catalogue Kino sont à zéro'
 })[v]||'Contrôle supplémentaire nécessaire';}
function openAuditOrder(order){
 if(!order?.reference||!state.report)return;
 state.company='ALL';state.orderState='all';state.query=order.reference;state.page=1;
 state.expanded=new Set([String(order.id)]);
 $('order-search').value=order.reference;
 $('status-select').value='all';
 document.querySelectorAll('[data-company]').forEach(button=>button.classList.toggle('active',button.dataset.company==='ALL'));
 navigate('orders');
}
function renderCommissions(){renderCatalogCommissions(state.report,$('commission-review'),{empty,warningInFrench,fmtNumber});renderReconciliationAudit(state.report,$('commission-audit'),{empty,fmtNumber,onOpenOrder:openAuditOrder})}


async function loadDashboard(){
 if(!state.access)return;
 const ticket=dashboardRequests.begin();
 dashboard.loading=true;dashboard.error='';renderDashboard();
 try{
  const response=await companionGet('/dashboard?attention_limit=5&activity_limit=5');
  if(!dashboardRequests.isCurrent(ticket))return;
  dashboard.data=normalizeCrmDashboard(response);
 }catch(error){
  if(!dashboardRequests.isCurrent(ticket))return;
  dashboard.data=null;dashboard.error='Résumé CRM indisponible. Les commandes Odoo restent accessibles séparément.';
 }finally{if(dashboardRequests.isCurrent(ticket)){dashboard.loading=false;renderDashboard()}}
}
function renderDashboard(){
 const stats=$('crm-stats'),attention=$('crm-attention');if(!stats||!attention)return;
 clear(stats);clear(attention);
 if(dashboard.loading){attention.append(empty('Chargement du suivi CRM…'));return}
 if(dashboard.error){attention.append(empty(dashboard.error));return}
 const d=dashboard.data;
 if(!d){attention.append(empty('Résumé CRM non chargé.'));return}
 stats.append(metric('Clients CRM',String(d.clients),'Fiches existantes'),
  metric('À suivre',String(d.attentionCount),'Clients nécessitant une action'),
  metric('Tâches actives',String(d.tasks),'Actions en cours'),
  metric('En retard',String(d.overdue),'Actions à examiner',{dark:true}));
 if(!d.attention.length&&!d.unassigned.length){attention.append(empty('Aucun élément prioritaire dans le CRM.'));return}
 for(const client of d.attention.slice(0,5)){
  const btn=node('button','client-row');btn.type='button';
  btn.append(node('span','client-name',client.name),node('span','client-mini',`${client.openTasks} tâche(s) · ${client.overdueTasks} en retard`));
  btn.addEventListener('click',()=>{clients.selected=client.id;navigate('clients');openClient(client.id)});
  attention.append(btn);
 }
 for(const task of d.unassigned.slice(0,3)){
  const item=node('div','review-item');
  item.append(node('span','',task.title||'Tâche à examiner'),node('strong','',task.dueAt?shortDate(task.dueAt):'Sans échéance'));
  attention.append(item);
 }
}

async function companionGet(path){
 const jwt=await ensureToken();
 const response=await authFetch('/functions/v1/companion-api'+path,{headers:{authorization:`Bearer ${jwt}`}});
 let body;try{body=await response.json()}catch{throw Error('invalid_client_response')}
 if(!response.ok||body?.ok!==true)throw Error(body?.error||'crm_unavailable');
 return body.data;
}
async function loadClients(){
 if(!state.access)return;
 const ticket=clientRequests.begin();
 clients.loading=true;clients.error='';renderClients();
 try{
  const data=await companionGet('/clients?limit=20&q='+encodeURIComponent(clients.query));
  if(!clientRequests.isCurrent(ticket))return;
  clients.rows=normalizeClientList(data);
 }catch(error){
  if(!clientRequests.isCurrent(ticket))return;
  clients.rows=null;clients.error='Impossible de charger la liste des clients. Réessaie.';
 }finally{if(clientRequests.isCurrent(ticket)){clients.loading=false;renderClients()}}
}
async function openClient(clientId){
 if(!validClientId(clientId)||!state.access)return;
 const ticket=clientRequests.begin();
 clients.selected=clientId;clients.detail=null;clients.error='';clients.loading=true;renderClients();
 try{
  const data=await companionGet('/clients/'+encodeURIComponent(clientId)+'/card');
  if(!clientRequests.isCurrent(ticket))return;
  clients.detail=normalizeClientCard(data,clientId);
 }catch(error){
  if(!clientRequests.isCurrent(ticket))return;
  clients.error='Impossible de charger la fiche client. Retourne à la liste et réessaie.';
 }finally{if(clientRequests.isCurrent(ticket)){clients.loading=false;renderClients()}}
}
function clientSection(title,items){
 const section=node('section','client-section');
 section.append(node('h3','',title));
 if(!items.length)section.append(node('p','','Aucune information vérifiée pour cette section.'));
 for(const [heading,sub] of items){
  const line=node('article');
  line.append(node('strong','',heading||'Information sans titre'));
  if(sub)line.append(node('small','',sub));
  section.append(line);
 }
 return section;
}
function renderClients(){
 const listing=$('clients-list'),details=$('client-detail'),filters=$('clients-filter');
 if(!listing||!details||!filters)return;
 clear(listing);clear(details);
 const inDetail=Boolean(clients.selected);
 listing.classList.toggle('hidden',inDetail);
 details.classList.toggle('hidden',!inDetail);
 filters.classList.toggle('hidden',inDetail);
 const count=$('clients-count');
 if(inDetail){
  count.textContent='';
  const back=node('button','secondary-button','← Retour aux clients');
  back.type='button';back.addEventListener('click',()=>{clientRequests.invalidate();clients.selected=null;clients.detail=null;clients.loading=false;clients.error='';renderClients()});
  details.append(back);
  if(clients.loading){details.append(empty('Chargement de la fiche client…'));return}
  if(clients.error){details.append(empty(clients.error));return}
  const d=clients.detail;if(!d){details.append(empty('Fiche non disponible.'));return}
  const header=node('div','client-profile');
  header.append(node('strong','',d.profile.name),node('span','',[d.profile.status,d.profile.address,d.profile.country].filter(Boolean).join(' · ')||'CRM propriétaire'));
  details.append(header);
  if(d.memory)details.append(clientSection('Mémoire commerciale',[['Synthèse',d.memory]]));
  details.append(clientSection('Actions en cours',d.attention.tasks.map(t=>[t.title,[t.description,t.dueAt?'Échéance : '+shortDate(t.dueAt):''].filter(Boolean).join(' · ')])));
  details.append(clientSection('Contacts',d.contacts.map(c=>[c.name,[c.role,...c.channels.map(x=>x.type+': '+x.value)].filter(Boolean).join(' · ')])));
  details.append(clientSection('Activité récente',d.activity.map(e=>[[e.source,e.type,shortDate(e.when)].filter(Boolean).join(' · '),e.body])));
  if(d.profile.notes)details.append(clientSection('Notes client',[['Notes',d.profile.notes]]));
  return;
 }
 if(clients.loading){count.textContent='Recherche en cours…';listing.append(empty('Lecture du CRM privé…'));return}
 if(clients.error){count.textContent='Connexion CRM indisponible';listing.append(empty(clients.error));const retry=node('button','secondary-button','Réessayer');retry.type='button';retry.addEventListener('click',loadClients);listing.append(retry);return}
 if(clients.rows===null){count.textContent='Recherche non chargée';listing.append(empty('Ouvre cette rubrique pour consulter le CRM.'));return}
 count.textContent=`${clients.rows.length} client(s) affiché(s) · 20 résultats maximum`;
 if(!clients.rows.length){listing.append(empty('Aucun client trouvé pour cette recherche.'));return}
 for(const c of clients.rows){
  const button=node('button','client-row');button.type='button';
  button.append(node('span','client-name',c.name));
  if(c.summary)button.append(node('span','client-sub',c.summary));
  button.append(node('span','client-mini',`${c.openTasks} tâche(s) · ${c.overdueTasks} en retard`));
  button.addEventListener('click',()=>openClient(c.id));
  listing.append(button);
 }
}

function renderViews(){renderStats();renderHome();renderOrders();renderCommissions();renderClients();renderDashboard()}
async function boot(){
 updatePeriod();showLogin();
 const stored=getStored();if(!stored)return;
 state.access=stored.access;state.refresh=stored.refresh;state.exp=stored.exp;
 const session=refreshGate.current();
 try{
  await ownerCheck();
  if(!refreshGate.isCurrent(session))return;
  scheduleRefresh();showApp();setNotice('Session restaurée. Appuie sur ↻ pour récupérer les commandes.');
 }catch{if(refreshGate.isCurrent(session)){forget();showLogin()}}
}
$('login-form').addEventListener('submit',async ev=>{ev.preventDefault();const email=$('login-email').value.trim(),password=$('login-password').value;const btn=$('login-button');btn.disabled=true;$('login-error').classList.add('hidden');try{await login(email,password);$('login-password').value='';showApp();setNotice('Connexion propriétaire confirmée. Appuie sur ↻ pour charger les commandes.')}catch(err){forget();$('login-error').textContent=readableError(err.message);$('login-error').classList.remove('hidden')}finally{btn.disabled=false;password.length&&($('login-password').value='')}});
$('logout-top').addEventListener('click',signOut);$('logout-bottom').addEventListener('click',signOut);
$('odoo-probe').addEventListener('click',checkOdooReadAccess);
$('reload').addEventListener('click',loadReport);$('reload-crm').addEventListener('click',loadDashboard);$('prev-month').addEventListener('click',()=>changeMonth(-1));$('next-month').addEventListener('click',()=>changeMonth(1));
document.querySelectorAll('[data-nav]').forEach(b=>b.addEventListener('click',()=>navigate(b.dataset.nav)));
document.querySelectorAll('[data-company]').forEach(b=>b.addEventListener('click',()=>{state.company=b.dataset.company;state.page=1;document.querySelectorAll('[data-company]').forEach(x=>x.classList.toggle('active',x===b));renderOrders()}));
$('client-search').addEventListener('input',e=>{
 clients.query=e.target.value.slice(0,120);
 clientRequests.invalidate();clients.rows=null;clients.error='';clients.loading=false;
 if(clients.timer)clearTimeout(clients.timer);
 renderClients();
 clients.timer=setTimeout(()=>{clients.timer=null;if(state.view==='clients'&&state.access)loadClients()},350);
});
$('order-search').addEventListener('input',e=>{state.query=e.target.value;state.page=1;renderOrders()});$('status-select').addEventListener('change',e=>{state.orderState=e.target.value;state.page=1;renderOrders()});$('load-more').addEventListener('click',()=>{state.page++;renderOrders()});
boot();

