import {createRequestGuard} from './request-guard.mjs';
import {API_BASE,SUPABASE_PUBLISHABLE_KEY as KEY} from './config.js';
import {catalogLineDetail,renderCatalogCommissions} from './reconciliation.mjs';
import {formatMoney,statusText,lineText,shortDate,monthOf,prevCompleteMonth,assertReport,filteredOrders,deriveStats,isDateRangeValid} from './model.mjs';
const $=x=>document.getElementById(x);
const state={access:null,refresh:null,exp:0,report:null,view:'home',period:prevCompleteMonth(),company:'ALL',orderState:'all',query:'',page:1,expanded:new Set(),loading:false,refreshTimer:null};
const STORE='weneed_v1_ephemeral_session';
const reportRequests=createRequestGuard();
const publicHeaders={'apikey':KEY,'content-type':'application/json'};
const text=(value)=>document.createTextNode(String(value??''));
const node=(tag,cls,textValue)=>{const x=document.createElement(tag);if(cls)x.className=cls;if(textValue!==undefined)x.textContent=String(textValue);return x};
const clear=(el)=>el.replaceChildren();
function setNotice(message,type='info'){$('notice-text').textContent=message;$('notice').className='notice'+(type==='info'?'':` ${type}`)}
function loading(on){state.loading=on;$('loading').classList.toggle('hidden',!on);$('reload').disabled=on}
function getStored(){try{const s=JSON.parse(sessionStorage.getItem(STORE)||'null');return s&&typeof s.access==='string'&&typeof s.refresh==='string'&&Number.isFinite(s.exp)?s:null}catch{return null}}
function saveSession(data){state.access=data.access_token;state.refresh=data.refresh_token;state.exp=Math.floor(Date.now()/1000)+(data.expires_in||3600);try{sessionStorage.setItem(STORE,JSON.stringify({access:state.access,refresh:state.refresh,exp:state.exp}))}catch{}scheduleRefresh()}
function forget(){reportRequests.invalidate();loading(false);state.access=null;state.refresh=null;state.exp=0;state.report=null;state.expanded.clear();if(state.refreshTimer)clearTimeout(state.refreshTimer);try{sessionStorage.removeItem(STORE)}catch{}}
function scheduleRefresh(){if(state.refreshTimer)clearTimeout(state.refreshTimer);if(!state.access||!state.refresh)return;const ms=Math.max(25000,Math.min((state.exp*1000-Date.now()-85000),2147483647));state.refreshTimer=setTimeout(()=>refreshTokens().catch(()=>{}),ms)}
async function authFetch(path,init={}){return fetch(API_BASE+path,{...init,headers:{...publicHeaders,...(init.headers||{})},cache:'no-store',redirect:'error'})}
async function refreshTokens(){if(!state.refresh)throw Error('no_session');const res=await authFetch('/auth/v1/token?grant_type=refresh_token',{method:'POST',body:JSON.stringify({refresh_token:state.refresh})});if(!res.ok){forget();showLogin();throw Error('session_expired')}saveSession(await res.json())}
async function ensureToken(){if(!state.access)throw Error('no_session');if(state.exp*1000<Date.now()+45000)await refreshTokens();return state.access}
async function ownerCheck(){const jwt=await ensureToken();const res=await authFetch('/functions/v1/companion-profile',{headers:{'authorization':`Bearer ${jwt}`}});if(res.status===401||res.status===403)throw Error('owner_only');if(!res.ok)throw Error('profile_unavailable');const data=await res.json();if(data.ok!==true||data.role!=='owner')throw Error('owner_only')}
async function login(email,password){const res=await authFetch('/auth/v1/token?grant_type=password',{method:'POST',body:JSON.stringify({email,password})});if(!res.ok)throw Error('invalid_credentials');const data=await res.json();if(!data.access_token||!data.refresh_token)throw Error('invalid_session');saveSession(data);try{await ownerCheck()}catch(e){forget();throw e}}
async function signOut(){const jwt=state.access;forget();showLogin();if(jwt)try{await authFetch('/auth/v1/logout',{method:'POST',headers:{authorization:`Bearer ${jwt}`}})}catch{}}
function showLogin(){$('login-panel').classList.remove('hidden');$('app-panel').classList.add('hidden');$('bottom-nav').classList.add('hidden');$('logout-top').classList.add('hidden')}
function showApp(){$('login-panel').classList.add('hidden');$('app-panel').classList.remove('hidden');$('bottom-nav').classList.remove('hidden');$('logout-top').classList.remove('hidden');navigate(state.view)}
function readableError(code){return ({owner_only:'Le compte connecté ne dispose pas de l’accès propriétaire.',invalid_credentials:'Identifiants refusés. Vérifie le mot de passe Companion.',invalid_session:'Session incomplète.',session_expired:'Ta session a expiré. Reconnecte-toi.',no_session:'Session absente.',profile_unavailable:'Vérification de l’accès propriétaire indisponible.',invalid_period:'Période incorrecte (maximum 94 jours).',source_record_limit_exceeded:'Trop de commandes ou de lignes pour cette période : choisis une période plus courte.',odoo_unreachable:'Odoo ne répond pas pour le moment.',odoo_auth_failed:'Ta connexion Companion est valide, mais la connexion serveur à Odoo est refusée. Vérifie la configuration Odoo côté Supabase (compte, clé API et identité attendue). Changer le mot de passe Companion ne résoudra pas ce problème.',odoo_not_configured:'Paramètres Odoo manquants côté Supabase.',invalid_odoo_response:'Réponse Odoo inattendue.',unmatched_order_line:'Une ligne Odoo n’a pas pu être rattachée à sa commande.',invalid_report:'Rapport invalide.',incomplete_report:'Rapport incomplet.',unverified_commissions_guard:'Rapport de commissions inattendu ; affichage bloqué par sécurité.',catalog_unavailable:'Catalogue Kino indisponible, Odoo seul reste consultable.',catalog_incomplete:'Capture Kino incomplète.',catalog_invalid:'Produit Kino invalide.',invalid_orders:'Commandes incohérentes.'})[code]||'La lecture a échoué. Réessaie ou consulte les journaux Supabase.'}
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
  state.report=assertReport(report);
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
function navigate(view){if(!['home','orders','commissions','settings'].includes(view))return;state.view=view;const names={home:['ACCUEIL','Vue d’ensemble','Le suivi de ton activité GTA et Trim Rocket.'],orders:['COMMERCIAL','Commandes Odoo','Les ventes et leurs lignes, directement depuis Odoo.'],commissions:['RÉMUNÉRATION','Commissions','Préparation et réconciliation avant Kino.'],settings:['COMPTE','Paramètres','Statut des connexions et sécurité.']};$('page-eyebrow').textContent=names[view][0];$('page-title').textContent=names[view][1];$('page-subtitle').textContent=names[view][2];document.querySelectorAll('.view').forEach(el=>el.classList.toggle('hidden',el.id!==`view-${view}`));document.querySelectorAll('[data-nav]').forEach(el=>el.classList.toggle('active',el.dataset.nav===view));window.scrollTo({top:0,behavior:'instant'});renderViews()}
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
function renderCommissions(){renderCatalogCommissions(state.report,$('commission-review'),{empty,warningInFrench,fmtNumber})}
function renderViews(){renderStats();renderHome();renderOrders();renderCommissions()}
async function boot(){updatePeriod();showLogin();const stored=getStored();if(!stored)return;state.access=stored.access;state.refresh=stored.refresh;state.exp=stored.exp;try{await ownerCheck();scheduleRefresh();showApp();setNotice('Session restaurée. Appuie sur ↻ pour récupérer les commandes.')}catch{forget();showLogin()}}
$('login-form').addEventListener('submit',async ev=>{ev.preventDefault();const email=$('login-email').value.trim(),password=$('login-password').value;const btn=$('login-button');btn.disabled=true;$('login-error').classList.add('hidden');try{await login(email,password);$('login-password').value='';showApp();setNotice('Connexion propriétaire confirmée. Appuie sur ↻ pour charger les commandes.')}catch(err){forget();$('login-error').textContent=readableError(err.message);$('login-error').classList.remove('hidden')}finally{btn.disabled=false;password.length&&($('login-password').value='')}});
$('logout-top').addEventListener('click',signOut);$('logout-bottom').addEventListener('click',signOut);
$('reload').addEventListener('click',loadReport);$('prev-month').addEventListener('click',()=>changeMonth(-1));$('next-month').addEventListener('click',()=>changeMonth(1));
document.querySelectorAll('[data-nav]').forEach(b=>b.addEventListener('click',()=>navigate(b.dataset.nav)));
document.querySelectorAll('[data-company]').forEach(b=>b.addEventListener('click',()=>{state.company=b.dataset.company;state.page=1;document.querySelectorAll('[data-company]').forEach(x=>x.classList.toggle('active',x===b));renderOrders()}));
$('order-search').addEventListener('input',e=>{state.query=e.target.value;state.page=1;renderOrders()});$('status-select').addEventListener('change',e=>{state.orderState=e.target.value;state.page=1;renderOrders()});$('load-more').addEventListener('click',()=>{state.page++;renderOrders()});
boot();

