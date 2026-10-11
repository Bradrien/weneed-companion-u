import {createConnectorStatus} from './connectors-d24.mjs';
import {createTasks} from './tasks-d24.mjs';
import {createArchives} from './archives-d18.mjs';
import {createOdooQuotePipeline} from './odoo-quote-pipeline-d30.mjs?v=invoice-evidence-1';
import {buildOrderLineCommissions,lineCommission} from './order-line-commission-d30.mjs?v=calculation-8';
import {createStrategy} from './strategy-d19.mjs';
import {createStocks} from './stocks-d16.mjs';
import {createRequestGuard} from './request-guard.mjs';
import {createRefreshGate} from './auth-guard.mjs';
import {normalizeClientList,normalizeClientCard,normalizeCrmDashboard,validClientId} from './clients-model-d14.mjs';
import {normalizeClient360,proposePeriodOdooOrders,assessOdooPartnerCandidates} from './client-360-d10.mjs';
import {normalizePartnerHistory,assessPartnerIdentity} from './client-history-d13.mjs';
import {buildCommercialMemory} from './client-memory-d15.mjs';
import {normalizeOdooCandidates} from './client-candidates-d15.mjs';
import {API_BASE,SUPABASE_PUBLISHABLE_KEY as KEY} from './config.js';
import {catalogLineDetail,renderCatalogCommissions,renderReconciliationAudit} from './reconciliation-d7.mjs';
import {renderCommissionScenario} from './commission-scenario-ui-d30.mjs?v=calculation-8';
import {formatMoney,statusText,lineText,shortDate,monthOf,prevCompleteMonth,assertReport,filteredOrders,deriveStats,isDateRangeValid} from './model.mjs';
const $=x=>document.getElementById(x);
const state={access:null,refresh:null,exp:0,report:null,view:(()=>{const v=new URL(location.href).searchParams.get('view');return ['home','orders','clients','commissions','stocks','archives','strategy','tasks','settings'].includes(v)?v:'home'})(),period:prevCompleteMonth(),company:'ALL',orderState:'all',query:'',page:1,expanded:new Set(),loading:false,refreshTimer:null};
const STORE='weneed_v1_ephemeral_session';
const reportRequests=createRequestGuard();
const clientRequests=createRequestGuard();
const dashboardRequests=createRequestGuard();
const odooProbeRequests=createRequestGuard();
const dashboard={data:null,loading:false,error:''};
const clients={rows:null,query:'',selected:null,detail:null,full:null,fullError:'',history:null,historyError:'',historyLoading:false,historyPartner:null,linkCandidate:null,linkSubmitting:false,linkError:'',candidates:null,candidateLoading:false,candidateError:'',candidatePartner:null,loading:false,error:'',timer:null};
const refreshGate=createRefreshGate();
const lineCommissionCache={report:null,index:null};
function commissionIndex(){if(lineCommissionCache.report!==state.report){lineCommissionCache.report=state.report;lineCommissionCache.index=buildOrderLineCommissions(state.report)}return lineCommissionCache.index}
const stocks=createStocks({isActive:()=>state.view==='stocks',isAuthenticated:()=>!!state.access,request:async(suffix,init={})=>{const jwt=await ensureToken();const response=await authFetch('/functions/v1/stock-monitor'+suffix,{...init,headers:{authorization:'Bearer '+jwt}});const body=await response.json();if(!response.ok||!body.ok)throw Error(body.error||'stock_unavailable');return body;}});
const archives=createArchives({briefRequest:async(suffix)=>{
 const jwt=await ensureToken();
 const res=await authFetch('/functions/v1/whatsapp-client-brief'+suffix,{
  headers:{authorization:'Bearer '+jwt}});
 let data;try{data=await res.json()}catch{throw Error('brief_invalid_response')}
 if(!res.ok||data?.ok!==true)throw Error(data?.error||'brief_unavailable');
 return data;
},isAuthenticated:()=>!!state.access,isActive:()=>state.view==='archives',request:async(suffix,init={})=>{const jwt=await ensureToken();const res=await authFetch('/functions/v1/whatsapp-archives'+suffix,{...init,headers:{authorization:'Bearer '+jwt}});const data=await res.json();if(!res.ok||!data.ok)throw Error(data.error||'archive_unavailable');return data;}});
archives.setClientRenderer(()=>{if(state.view==='clients'&&clients.selected)renderClients()});
const odooQuotes=createOdooQuotePipeline({isAuthenticated:()=>!!state.access,
 isActive:()=>state.view==='commissions',
 invoiceEvidenceRequest:async(orderId)=>{
  if(!Number.isSafeInteger(orderId)||orderId<1)throw Error('invalid_order_id');
  const jwt=await ensureToken();
  const response=await authFetch('/functions/v1/odoo-invoice-evidence?order_id='+orderId,
   {headers:{authorization:'Bearer '+jwt}});
  let json;try{json=await response.json()}catch{throw Error('invalid_invoice_evidence')}
  if(!response.ok||json?.ok!==true)throw Error(json?.error||'invoice_evidence_unavailable');
  return json;
 },
 monthlyReportRequest:async(month)=>{
  if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))throw Error('invalid_month');
  const [year,m]=month.split('-').map(Number),from=month+'-01',
   to=new Date(Date.UTC(year,m,0)).toISOString().slice(0,10);
  const jwt=await ensureToken();
  const response=await authFetch('/functions/v1/commission-catalog-review?from='+from+'&to='+to,
   {headers:{authorization:'Bearer '+jwt}});
  let json;try{json=await response.json()}catch{throw Error('invalid_odoo_response')}
  if(!response.ok||json?.ok!==true)throw Error(json?.error||'monthly_odoo_unavailable');
  return json.data;
 },
 request:async(selectedMonth)=>{
  if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(selectedMonth))throw Error('invalid_month');
  const [year,m]=selectedMonth.split('-').map(Number),from=selectedMonth+'-01',
   to=new Date(Date.UTC(year,m,0)).toISOString().slice(0,10);
  const jwt=await ensureToken();
  const response=await authFetch('/functions/v1/odoo-commission-pipeline?from='+from+'&to='+to,
   {headers:{authorization:'Bearer '+jwt}});
  let json;try{json=await response.json()}catch{throw Error('odoo_pipeline_unavailable')}
  if(!response.ok||json?.ok!==true){
   const e=new Error(json?.error||'odoo_pipeline_unavailable');
   if(typeof json?.stage==='string'&&/^[a-z_]{3,40}$/.test(json.stage))e.stage=json.stage;
   throw e;
  }
  return json;
 }
});
const strategy=createStrategy({isAuthenticated:()=>!!state.access,isActive:()=>state.view==='strategy',
 request:async()=>{
  const jwt=await ensureToken();
  const response=await authFetch('/functions/v1/strategy-portfolio',{headers:{authorization:'Bearer '+jwt}});
  let data;try{data=await response.json()}catch{throw Error('strategy_response_invalid')}
  if(!response.ok||data?.ok!==true)throw Error(data?.error||'strategy_unavailable');
  return data.data;
 },
 onClient:async id=>{navigate('clients');await openClient(id);}
});
const tasks=createTasks({isAuthenticated:()=>!!state.access,isActive:()=>state.view==='tasks',clientRequest:companionGet,
 request:async(suffix,init={})=>{const jwt=await ensureToken();const response=await authFetch('/functions/v1/companion-tasks'+suffix,{...init,headers:{authorization:'Bearer '+jwt}});let body;try{body=await response.json()}catch{throw Error('tasks_unavailable')}if(!response.ok||body?.ok!==true)throw Error(body?.error||'tasks_unavailable');return body;},
 onChanged:()=>{dashboard.data=null;dashboard.error='';clients.rows=null;}
});
const connectorStatus=createConnectorStatus({request:companionGet,isAuthenticated:()=>!!state.access});
const publicHeaders={'apikey':KEY,'content-type':'application/json'};
const text=(value)=>document.createTextNode(String(value??''));
const node=(tag,cls,textValue)=>{const x=document.createElement(tag);if(cls)x.className=cls;if(textValue!==undefined)x.textContent=String(textValue);return x};
const clear=(el)=>el.replaceChildren();
function setNotice(message,type='info'){$('notice-text').textContent=message;$('notice').className='notice'+(type==='info'?'':` ${type}`)+(['stocks','archives','strategy','tasks'].includes(state.view)?' hidden':'')}
function loading(on){state.loading=on;$('loading').classList.toggle('hidden',!on);$('reload').disabled=on}
function getStored(){try{const s=JSON.parse(sessionStorage.getItem(STORE)||'null');return s&&typeof s.access==='string'&&typeof s.refresh==='string'&&Number.isFinite(s.exp)?s:null}catch{return null}}
function saveSession(data){state.access=data.access_token;state.refresh=data.refresh_token;state.exp=Math.floor(Date.now()/1000)+(data.expires_in||3600);try{sessionStorage.setItem(STORE,JSON.stringify({access:state.access,refresh:state.refresh,exp:state.exp}))}catch{}scheduleRefresh()}
function forget(){connectorStatus.reset();tasks.reset();odooQuotes.reset();strategy.reset();archives.reset();stocks.reset();refreshGate.invalidate();reportRequests.invalidate();clientRequests.invalidate();dashboardRequests.invalidate();odooProbeRequests.invalidate();$('odoo-probe-status').textContent='Test non lancé.';$('odoo-probe').disabled=false;dashboard.data=null;dashboard.loading=false;dashboard.error='';if(clients.timer)clearTimeout(clients.timer);clients.query='';$('client-search').value='';clients.rows=null;clients.detail=null;clients.full=null;clients.fullError='';clients.history=null;clients.historyPartner=null;clients.historyLoading=false;clients.historyError='';clients.linkCandidate=null;clients.linkSubmitting=false;clients.linkError='';clients.candidates=null;clients.candidateLoading=false;clients.candidateError='';clients.candidatePartner=null;clients.selected=null;clients.error='';clients.loading=false;loading(false);state.access=null;state.refresh=null;state.exp=0;state.report=null;state.expanded.clear();if(state.refreshTimer)clearTimeout(state.refreshTimer);try{sessionStorage.removeItem(STORE)}catch{}}
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
function readableError(code){return ({owner_only:'Le compte connecté ne dispose pas de l’accès propriétaire.',invalid_credentials:'Identifiants refusés. Vérifie le mot de passe Companion.',invalid_session:'Session incomplète.',session_expired:'Ta session a expiré. Reconnecte-toi.',no_session:'Session absente.',profile_unavailable:'Vérification de l’accès propriétaire indisponible.',invalid_period:'Période incorrecte (maximum 94 jours).',odoo_order_state_changed:'Le statut d’une commande a changé pendant la lecture Odoo. Actualise ↻ pour relancer une vérification complète.',odoo_order_status_unverifiable:'Les statuts Odoo n’ont pas pu être revérifiés. Aucun scénario de commissions : réessaie.',source_record_limit_exceeded:'Trop de commandes ou de lignes pour cette période : choisis une période plus courte.',invalid_odoo_configuration:'Configuration de l’accès Odoo invalide côté Supabase.',odoo_unreachable:'Odoo ne répond pas pour le moment.',origin_not_allowed:'Origine du navigateur non autorisée pour la passerelle Odoo.',network_error:'La requête n’atteint pas le serveur (réseau, certificat ou autorisation CORS).',upstream_failure:'La passerelle Odoo a rencontré une erreur serveur inattendue.',request_error:'Échec de la requête de diagnostic.',server_response_error:'La passerelle a renvoyé un code d’erreur non reconnu.',diagnostic_unavailable:'Diagnostic Odoo indisponible.',odoo_http_error:'La passerelle Odoo a refusé la requête HTTP. Code de diagnostic : odoo_http_error.',odoo_remote_error:'Odoo a renvoyé une erreur lors de la lecture. Code de diagnostic : odoo_remote_error.',review_unavailable:'Le rapport n’a pas pu être généré côté serveur. Code : review_unavailable.',odoo_uid_pin_not_configured:'UID Odoo attendu absent de la configuration Supabase.',odoo_pinned_read_rejected:'La clé actuelle n’autorise pas la lecture avec l’UID attendu ; clé, base ou permissions à contrôler.',odoo_credentials_rejected:'Odoo refuse le couple login / base / clé API.',odoo_auth_failed:'Ta connexion Companion est valide, mais la connexion serveur à Odoo est refusée. Vérifie la configuration Odoo côté Supabase (compte, clé API et identité attendue). Changer le mot de passe Companion ne résoudra pas ce problème.',odoo_not_configured:'Paramètres Odoo manquants côté Supabase.',invalid_odoo_response:'Réponse Odoo inattendue.',unmatched_order_line:'Une ligne Odoo n’a pas pu être rattachée à sa commande.',invalid_report:'Rapport invalide.',incomplete_report:'Rapport incomplet.',unverified_commissions_guard:'Rapport de commissions inattendu ; affichage bloqué par sécurité.',report_period_mismatch:'La réponse Odoo concerne une autre période. Aucune donnée affichée : recharge le mois.',catalog_unavailable:'Catalogue Kino indisponible, Odoo seul reste consultable.',catalog_incomplete:'Capture Kino incomplète.',catalog_invalid:'Produit Kino invalide.',invalid_orders:'Commandes incohérentes.'})[code]||'La lecture a échoué. Réessaie ou consulte les journaux Supabase.'}
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
   `${state.report.orders_count} commandes · ${k.matched}/${k.eligible} lignes éligibles rapprochées. Aucune commission validée. Vérifie les statuts Odoo dans l’onglet Commissions.`,usedFallback?'warn':'info');
  renderViews();
 }catch(error){
  if(!reportRequests.isCurrent(request))return;
  state.report=null;$('odoo-state').textContent='Lecture non validée';$('kino-state').textContent='Non vérifié';
  setNotice(readableError(error.message),'error');renderViews();
 }finally{if(reportRequests.isCurrent(request))loading(false)}
}
function changeMonth(delta){reportRequests.invalidate();loading(false);const y=Number(state.period.from.slice(0,4)),m=Number(state.period.from.slice(5,7))-1;state.period=monthOf(new Date(y,m+delta,1));state.report=null;state.page=1;state.expanded.clear();updatePeriod();renderViews();setNotice('Période changée. Appuie sur ↻ pour consulter Odoo.');}
function updatePeriod(){$('period-label').textContent=state.period.label}
function navigate(view){if(!['home','orders','clients','commissions','stocks','archives','strategy','tasks','settings'].includes(view))return;if(view!==state.view)archives.close();state.view=view;document.querySelector('.month-toolbar').classList.toggle('hidden',['stocks','archives','strategy','tasks'].includes(view));$('notice').classList.toggle('hidden',['stocks','archives','strategy','tasks'].includes(view));const names={tasks:['ACTIONS','Tâches et rappels','Créer, reporter et terminer tes actions commerciales.'],strategy:['PILOTAGE','Stratégie clients','Panier moyen, TR/GTA, rythme d’achat et plans d’action.'],archives:['WHATSAPP','Archives clients','Vos conversations archivées, avec les vocaux originaux.'],stocks:['DISPONIBILITÉ','Stocks','Stocks TR / GTA et alertes sur ton téléphone.'],home:['ACCUEIL','Vue d’ensemble','Le suivi de ton activité GTA et Trim Rocket.'],orders:['COMMERCIAL','Commandes Odoo','Les ventes et leurs lignes, directement depuis Odoo.'],clients:['CRM PRIVÉ','Clients','Contacts, tâches et historique commercial en lecture seule.'],commissions:['RÉMUNÉRATION','Commissions','Devis Odoo, commandes confirmées et facturation : gains potentiels.'],settings:['COMPTE','Paramètres','Statut des connexions et sécurité.']};$('page-eyebrow').textContent=names[view][0];$('page-title').textContent=names[view][1];$('page-subtitle').textContent=names[view][2];document.querySelectorAll('.view').forEach(el=>el.classList.toggle('hidden',el.id!==`view-${view}`));document.querySelectorAll('[data-nav]').forEach(el=>el.classList.toggle('active',el.dataset.nav===view));window.scrollTo({top:0,behavior:'instant'});renderViews();if(view==='settings')connectorStatus.open();if(view==='tasks')tasks.open();if(view==='stocks')stocks.open();if(view==='archives')archives.open();if(view==='strategy')strategy.open();if(view==='commissions')odooQuotes.load();if(view==='clients'&&clients.rows===null&&!clients.loading&&!clients.selected)loadClients();if(view==='home'&&dashboard.data===null&&!dashboard.loading&&!dashboard.error)loadDashboard()}
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
 const right=node('div','detail-value');right.append(node('span','',formatMoney(l.line_ht,order.currency||'EUR')),node('span','detail-kind',lineText(l.kind)));
 const estimate=lineCommission(commissionIndex(),order.id,l.id);
 const sourceStatus=l.catalog_match?.status;
 const specific={missing_sku:'SKU absent dans Odoo',not_found:'SKU Odoo absent du catalogue Kino',
  ambiguous_sku:'Plusieurs correspondances Kino possibles',
  catalog_invalid_price:'Coût ou prix Kino non exploitable',
  not_applicable:'Ligne non éligible au calcul'}[sourceStatus];
 const commText=estimate.status==='simulated'?'Commission estimée : '+formatMoney(estimate.commission,'EUR'):
   estimate.status==='excluded'?'Commission à vérifier : '+(specific||estimate.reason):
   'Commission non disponible : '+estimate.reason;
 const comm=node('div','order-line-commission'+(estimate.status==='simulated'?' estimated':' pending'),commText);
 left.append(comm);
 if(estimate.status==='simulated')left.append(node('small','order-commission-flag',
   'Simulation Kino · coût par unité supposé · non acquise et non facturée'));
 row.append(left,right);detail.append(row)}
 const foot=node('div','detail-footer');
 foot.append(node('div','',`Total Odoo : ${formatMoney(order.amount_ht,order.currency||'EUR')} · Somme des lignes : ${formatMoney(order.line_sum_ht,order.currency||'EUR')}`));
 const matched=commissionIndex()?.orders?.get(order.id);
 foot.append(node('div','',`Écart : ${formatMoney(order.amount_difference,order.currency||'EUR')} · `+
  (matched&&matched.simulatedLines>0?`Commission simulée partielle : ${formatMoney(matched.amount,'EUR')} · ${matched.simulatedLines} ligne(s), ${matched.excludedLines} exclue(s)`:
  'Commission non calculable sur ces lignes')));
 detail.append(foot);outer.append(detail)}
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
function renderCommissions(){renderCommissionScenario(state.report,$('commission-scenario'),{onOpenOrder:openAuditOrder});renderCatalogCommissions(state.report,$('commission-review'),{empty,warningInFrench,fmtNumber});renderReconciliationAudit(state.report,$('commission-audit'),{empty,fmtNumber,onOpenOrder:openAuditOrder})}


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
 archives.close();
 const ticket=clientRequests.begin();
 clients.selected=clientId;clients.detail=null;clients.full=null;clients.fullError='';clients.history=null;clients.historyPartner=null;clients.historyLoading=false;clients.historyError='';clients.linkCandidate=null;clients.linkSubmitting=false;clients.linkError='';clients.candidates=null;clients.candidateLoading=false;clients.candidateError='';clients.candidatePartner=null;clients.error='';clients.loading=true;renderClients();
 try{
  const [card,full]=await Promise.allSettled([
   companionGet('/clients/'+encodeURIComponent(clientId)+'/card'),
   companionGet('/clients/'+encodeURIComponent(clientId)+'?event_limit=20&conversation_limit=12')
  ]);
  if(!clientRequests.isCurrent(ticket))return;
  if(card.status!=='fulfilled')throw Error('card_unavailable');
  clients.detail=normalizeClientCard(card.value,clientId);
  if(full.status==='fulfilled'){
   try{clients.full=normalizeClient360(full.value,clientId)}
   catch{clients.fullError='Le dossier commercial détaillé est temporairement indisponible.'}
  }else clients.fullError='Le dossier commercial détaillé est temporairement indisponible.';
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

function client360Section(full,error,crmName){
 const section=node('section','client-section client-360');
 section.append(node('h3','','Dossier commercial · sources croisées'));
 section.append(node('p','client-provenance',
  'Informations issues du CRM privé, des conversations et des pièces identifiées. Les paiements évoqués dans un e-mail ne constituent pas une preuve comptable.'));
 if(error)section.append(node('p','client-source-warning',error));
 if(!full){section.append(empty('Aucun détail commercial supplémentaire disponible.'));return section}
 const add=(heading,rows)=>{
  const sub=node('div','client-360-sub');
  sub.append(node('h4','',heading));
  if(!rows.length)sub.append(node('p','client-quiet','Aucun élément identifié dans cette source.'));
  for(const [name,desc] of rows.slice(0,30)){
   const entry=node('div','client-360-entry');
   entry.append(node('strong','',name||'Sans titre'));
   if(desc)entry.append(node('small','',desc));
   sub.append(entry);
  }
  section.append(sub);
 };
 add('Conversations par source',full.conversations.map(c=>[
  [c.source||'Source inconnue',c.title||'Conversation'].join(' · '),
  c.updatedAt?'Dernière activité : '+shortDate(c.updatedAt):'Date non disponible'
 ]));
 add('Factures, avoirs et références identifiées',full.businessObjects.map(o=>[
  [o.type||'Document',o.reference||'Référence inconnue'].join(' · '),
  [o.status?'Statut CRM : '+o.status:'',o.amount!==null&&o.currency?
    formatMoney(o.amount,o.currency):'',
   o.observedAt?'Observation : '+shortDate(o.observedAt):''].filter(Boolean).join(' · ')+
  ' · Source CRM, à vérifier dans Odoo'
 ]));
 add('Faits extraits des échanges',full.facts.filter(f=>f.text).map(f=>[
  [f.type||'Fait',f.status||'À confirmer'].join(' · '),
  f.text+' · Extrait d’échange, non vérifié par la comptabilité'
 ]));
 if(full.staleTasks.length)add('Anciennes pistes à réexaminer (non confirmées)',
  full.staleTasks.map(t=>[t.title,[t.description,t.reason].filter(Boolean).join(' · ')]));
 return section;
}

function historyBounds(){
 const today=new Date();
 const to=today.toISOString().slice(0,10);
 const from=new Date(Date.UTC(today.getUTCFullYear()-3,today.getUTCMonth(),1)).toISOString().slice(0,10);
 return {from,to};
}
async function loadPartnerHistory(partnerId,clientId){
 if(!state.access||!clients.selected||clients.selected!==clientId||
   !Number.isSafeInteger(partnerId)||partnerId<=0||clients.historyLoading)return;
 const ticket=clientRequests.begin();
 clients.historyPartner=partnerId;clients.history=null;clients.historyError='';clients.historyLoading=true;
 renderClients();
 try{
  const {from,to}=historyBounds();
  const jwt=await ensureToken();
  const path='/functions/v1/client-odoo-history?partner_id='+partnerId+
   '&from='+encodeURIComponent(from)+'&to='+encodeURIComponent(to);
  const res=await authFetch(path,{headers:{authorization:'Bearer '+jwt}});
  let body;try{body=await res.json()}catch{throw Error('invalid_response')}
  if(!res.ok||body?.ok!==true)throw Error(body?.error||'history_unavailable');
  const data=normalizePartnerHistory(body.data,partnerId);
  if(!clientRequests.isCurrent(ticket)||clients.selected!==clientId||
      clients.historyPartner!==partnerId)return;
  clients.history=data;
 }catch(error){
  if(!clientRequests.isCurrent(ticket)||clients.selected!==clientId)return;
  const codes={history_limit_exceeded:'Historique trop volumineux pour une seule consultation.',
   odoo_order_state_changed:'Une commande a changé de statut. Réessaie.',
   odoo_order_status_unverifiable:'Impossible de revérifier les statuts. Réessaie.',
   odoo_auth_failed:'Identifiants du connecteur Odoo à vérifier.',
   invalid_partner_history:'Historique reçu incohérent ; aucun montant n’est affiché.'};
  clients.historyError=codes[error?.message]||'Historique Odoo indisponible pour le moment.';
 }finally{
  if(clientRequests.isCurrent(ticket)&&clients.selected===clientId){
   clients.historyLoading=false;renderClients();
  }
 }
}
async function loadOdooCandidates(clientId){
 if(!state.access||clients.selected!==clientId||clients.candidateLoading)return;
 const ticket=clientRequests.begin();
 clients.candidates=null;clients.candidateError='';clients.candidatePartner=null;clients.candidateLoading=true;
 renderClients();
 try{
  const jwt=await ensureToken();
  const res=await authFetch('/functions/v1/client-odoo-link?client_id='+encodeURIComponent(clientId),{
   headers:{authorization:'Bearer '+jwt}
  });
  const data=await res.json();
  if(!res.ok||data?.ok!==true)throw Error(data?.error||'candidate_discovery_unavailable');
  const normalized=normalizeOdooCandidates(data.data,clientId);
  if(!clientRequests.isCurrent(ticket)||clients.selected!==clientId)return;
  clients.candidates=normalized;
 }catch(e){
  if(!clientRequests.isCurrent(ticket)||clients.selected!==clientId)return;
  clients.candidateError='Recherche Odoo indisponible. Aucune liaison créée. Tu peux réessayer ou consulter le rapport mensuel.';
 }finally{
  if(clientRequests.isCurrent(ticket)&&clients.selected===clientId){
   clients.candidateLoading=false;renderClients();
  }
 }
}
function clientCandidateDiscovery(){
 const section=node('div','client-candidate-discovery');
 section.append(node('h4','','Rechercher le partenaire Odoo · correspondances à vérifier'));
 section.append(node('p','client-provenance',
  'Recherche par nom strictement identique parmi les commandes de ton compte Odoo. Résultat partiel, jamais un lien automatique.'));
 if(clients.candidateLoading){
  section.append(node('p','client-quiet','Recherche des candidats dans Odoo…'));return section;
 }
 if(clients.candidateError)section.append(node('p','client-source-warning',clients.candidateError));
 if(!clients.candidates){
  const button=node('button','secondary-button','Rechercher dans mes commandes Odoo');
  button.type='button';button.addEventListener('click',()=>loadOdooCandidates(clients.selected));
  section.append(button);return section;
 }
 const matches=clients.candidates.candidates;
 if(!matches.length)section.append(node('p','client-quiet',
  'Aucun nom strictement identique trouvé dans les commandes interrogées. Ce résultat ne prouve pas l’absence de client Odoo.'));
 for(const candidate of matches){
  const item=node('div','client-candidate');
  item.append(node('strong','','Partenaire #'+candidate.partnerId+' · '+candidate.name));
  item.append(node('small','',candidate.exampleCount+' commande(s) repérée(s) dans l’échantillon · non vérifié'));
  const button=node('button','secondary-button',
   clients.candidatePartner===candidate.partnerId?'Masquer le dossier':'Examiner ce partenaire');
  button.type='button';
  button.addEventListener('click',()=>{
   clients.candidatePartner=clients.candidatePartner===candidate.partnerId?null:candidate.partnerId;
   clients.history=null;clients.historyPartner=null;clients.linkCandidate=null;renderClients();
  });
  item.append(button);
  if(clients.candidatePartner===candidate.partnerId)item.append(clientHistoryPanel(candidate.partnerId));
  section.append(item);
 }
 return section;
}

async function changeOdooLink(action,partnerId,clientId){
 if(!state.access||clients.selected!==clientId||clients.linkSubmitting||!validClientId(clientId))return;
 const ticket=clientRequests.begin();
 clients.linkSubmitting=true;clients.linkError='';renderClients();
 try{
  const jwt=await ensureToken();
  const res=await authFetch('/functions/v1/client-odoo-link',{
   method:'POST',headers:{authorization:'Bearer '+jwt},
   body:JSON.stringify({action,client_id:clientId,partner_id:partnerId,
    confirmation:action==='confirm'?'CONFIRMER_LIAISON':'REVOQUER_LIAISON'})
  });
  let value;try{value=await res.json()}catch{throw Error('invalid_response')}
  if(!res.ok||!value?.ok)throw Error(value?.error||'link_unavailable');
  const card=await companionGet('/clients/'+encodeURIComponent(clientId)+'/card');
  if(!clientRequests.isCurrent(ticket)||clients.selected!==clientId)return;
  clients.detail=normalizeClientCard(card,clientId);
  clients.linkCandidate=null;clients.linkError='';
  if(action==='revoke'){clients.history=null;clients.historyPartner=null;}
 }catch(e){
  if(!clientRequests.isCurrent(ticket)||clients.selected!==clientId)return;
  const labels={
   partner_name_mismatch:'Le nom officiel Odoo ne correspond pas au nom du CRM.',
   contact_evidence_not_confirmed:'Aucun e-mail ou téléphone identique : rattachement refusé.',
   partner_contact_unavailable:'Odoo ne fournit pas assez de coordonnées pour valider ce lien.',
   no_salesperson_order_for_partner:'Aucune commande autorisée ne relie ce partenaire à ton compte Odoo.',
   existing_client_or_partner_link:'Cette fiche CRM ou ce partenaire Odoo est déjà lié à un autre compte.',
   link_conflict_or_insert_failed:'Conflit avec un rattachement existant : vérifie les autres fiches.',
   link_lookup_failed:'Impossible de vérifier l’existence d’autres liaisons.',
   active_link_not_found:'Cette association n’est plus active.',
   odoo_auth_failed:'Connexion Odoo indisponible lors de la confirmation.'
  };
  clients.linkError=labels[e?.message]||'Opération impossible : aucun nouveau lien enregistré.';
 }finally{
  if(clientRequests.isCurrent(ticket)&&clients.selected===clientId){
   clients.linkSubmitting=false;renderClients();
  }
 }
}
function clientMemoryPanel(card,full,history){
 const digest=buildCommercialMemory(card,full,history);
 const section=node('section','client-section client-memory-digest');
 section.append(node('h3','','Mémoire commerciale sourcée'));
 section.append(node('p','client-provenance',
  'Synthèse factuelle recalculée à l’ouverture. Provenance indiquée pour chaque catégorie ; aucun paiement déduit des messages.'));
 if(digest.odooBacked){
  section.append(node('p','client-link-confirmed',
   'Historique Odoo associé au partenaire validé : '+
   digest.orders.confirmed+' commandes confirmées · '+digest.orders.cancelled+' annulées · dernier achat confirmé '+
   (digest.orders.lastConfirmed?shortDate(digest.orders.lastConfirmed):'non disponible')+'.'));
  if(digest.orders.confirmedTotal)
   section.append(node('p','client-provenance',
    'Montants HT des commandes confirmées : GTA '+formatMoney(digest.orders.confirmedTotal.GTA,'EUR')+
    ' · TR '+formatMoney(digest.orders.confirmedTotal.TR,'EUR')+
    '. Période couverte : '+shortDate(digest.period.from)+' → '+shortDate(digest.period.to)+'.'));
 }else section.append(node('p','client-source-warning',
  'Aucun historique Odoo exploitable associé à une liaison propriétaire validée. Les chiffres ne sont pas extrapolés.'));
 const append=(heading,entries)=>{
  const sub=node('div','client-memory-sub');sub.append(node('h4','',heading));
  if(!entries.length)sub.append(node('p','client-quiet','Aucun élément disponible dans les sources chargées.'));
  for(const [title,detail]of entries.slice(0,12)){
   const part=node('div','client-memory-entry');
   part.append(node('strong','',title));
   if(detail)part.append(node('small','',detail));
   sub.append(part);
  }
  section.append(sub);
 };
 append('Actions en cours · CRM',digest.tasks.map(t=>[t.title,
  [t.description,t.dueAt?'Échéance : '+shortDate(t.dueAt):'',t.source].filter(Boolean).join(' · ')]));
 append('Derniers événements datés · Odoo / échanges CRM',digest.timeline.slice(0,10).map(e=>[
  shortDate(e.date)+' · '+e.title,
  [e.status==='confirmed_order'?'Commande confirmée':
   e.status==='cancelled_order'?'Commande annulée':'Échange, non vérifié',
   e.source==='odoo'&&e.amount!==null&&e.currency?formatMoney(e.amount,e.currency):'',
   e.source==='odoo'?e.ref:e.detail].filter(Boolean).join(' · ')
 ]));
 append('Références documentaires · CRM non rapproché',digest.business.slice(0,8).map(o=>[
  o.kind+' · '+o.ref,[o.status,
  o.amount!==null&&o.currency?formatMoney(o.amount,o.currency):'',
  o.source].filter(Boolean).join(' · ')
 ]));
 append('Pistes et faits extraits · non vérifiés',
  [...digest.openLoops.map(x=>[x.title,x.description+' · '+x.source]),
   ...digest.facts.map(x=>[x.title,x.source])].slice(0,10));
 section.append(node('p','client-source-warning',digest.certainty));
 return section;
}

function clientHistoryPanel(partnerId){
 const box=node('div','client-history-panel');
 box.append(node('h4','','Historique des commandes · partenaire Odoo #'+partnerId));
 box.append(node('p','client-provenance',
  'Lecture des trois dernières années, limitée aux commandes de ton compte commercial GTA/TR. '+
  (clients.detail?.odooPartnerLink?.partnerId===partnerId?
   'Lien CRM ↔ partenaire Odoo confirmé par le propriétaire.':
   'Correspondance CRM ↔ Odoo non encore validée.')+
  ' Aucun montant de commission calculé.'));
 if(clients.historyPartner===partnerId&&clients.historyLoading){
  box.append(node('p','client-quiet','Consultation de l’historique Odoo en cours…'));
  return box;
 }
 if(clients.historyPartner===partnerId&&clients.historyError){
  box.append(node('p','client-source-warning',clients.historyError));
 }
 const h=clients.historyPartner===partnerId?clients.history:null;
 if(!h){
  const btn=node('button','secondary-button','Consulter les commandes sur 3 ans');
  btn.type='button';btn.addEventListener('click',()=>loadPartnerHistory(partnerId,clients.selected));
  box.append(btn);
  return box;
 }
 const summary=node('p','client-history-summary',
  h.orders.length+' commande(s) · '+h.statuses.confirmed+' confirmée(s) · '+
  h.statuses.cancelled+' annulée(s) · '+h.statuses.other+' autres · vérifié le '+
  new Date(h.checkedAt).toLocaleString('fr-FR',{dateStyle:'short',timeStyle:'short'}));
 box.append(summary);
 if(h.totals)box.append(node('p','client-provenance',
  'Ventes HT confirmées dans cet historique : GTA '+formatMoney(h.totals.GTA,'EUR')+
  ' · TR '+formatMoney(h.totals.TR,'EUR')+'. Ni encaissements ni commissions.'));
 else box.append(node('p','client-source-warning',
  'Total HT non affiché : certaines commandes ont une devise ou un montant manquant.'));
 if(h.partner){
  if(h.partnerDiagnostic==='partial'||h.partnerDiagnostic==='name_only')
   box.append(node('p','client-source-warning',
    h.partnerDiagnostic==='name_only'?
    'Odoo ne fournit que le nom du partenaire. Les champs de contact sont indisponibles : la correspondance CRM reste à vérifier.':
    'Odoo ne fournit qu’une partie des coordonnées du partenaire. Les champs manquants ne permettent pas de conclure.'));
  const evidence=assessPartnerIdentity(clients.detail?.profile,clients.detail?.contacts,h.partner);
  const section=node('div','client-partner-evidence');
  section.append(node('strong','','Contrôle d’identité CRM ↔ partenaire Odoo #'+partnerId));
  const fields=[
   ['Nom Odoo',h.partner.name||'Non renseigné'],
   ['E-mail Odoo',h.partner.email||'Non renseigné'],
   ['Téléphone Odoo',h.partner.phone||h.partner.mobile||'Non renseigné'],
   ['Adresse Odoo',[h.partner.street,h.partner.zip,h.partner.city].filter(Boolean).join(', ')||'Non renseignée']
  ];
  for(const [label,value] of fields)section.append(node('p','',label+' : '+value));
  section.append(node('p','client-provenance',
   'Concordances : nom '+(evidence?.nameMatch?'identique':'non confirmé')+
   ' · e-mail '+(evidence?.emailMatch?'identique':'non confirmé')+
   ' · téléphone '+(evidence?.phoneMatch?'identique':'non confirmé')+'.'));
  if(h.partner.parentOdooId)section.append(node('p','client-source-warning',
   'Ce partenaire dépend d’un compte Odoo parent #'+h.partner.parentOdooId+
   '. Ne pas regrouper sans contrôler cette relation.'));
  section.append(node('p','client-source-warning',
   clients.detail?.odooPartnerLink?.partnerId===partnerId?
    'Coordonnées concordantes avec le lien confirmé par le propriétaire. Les paiements restent indépendants et non vérifiés.':
    'Comparaison indicative uniquement. Le lien entre le CRM et Odoo reste NON VALIDÉ. Aucune fiche fusionnée.'));
  if(!clients.detail?.odooPartnerLink&&evidence?.nameMatch&&(evidence.emailMatch||evidence.phoneMatch)){
   const linkBox=node('div','client-link-action');
   linkBox.append(node('p','client-provenance',
    'Candidat compatible : la liaison reste non validée tant que tu n’as pas confirmé. Le serveur reverra les données Odoo et CRM avant l’enregistrement.'));
   if(clients.linkError)linkBox.append(node('p','client-source-warning',clients.linkError));
   const button=node('button','secondary-button',
    clients.linkCandidate===partnerId?'Confirmer le rattachement permanent à #'+partnerId:
    'Vérifier ce candidat pour rattachement');
   button.type='button';button.disabled=clients.linkSubmitting;
   button.addEventListener('click',()=>{
    if(clients.linkCandidate!==partnerId){clients.linkCandidate=partnerId;renderClients();return;}
    changeOdooLink('confirm',partnerId,clients.selected);
   });
   linkBox.append(button);section.append(linkBox);
  }
  box.append(section);
 }else{
  const diagnostics={
   not_visible:'Odoo ne renvoie aucune fiche pour cet identifiant. Le compte partenaire est peut-être masqué par les droits de lecture.',
   odoo_partner_read_rejected:'Odoo refuse la lecture de la fiche partenaire, y compris les champs minimaux. Vérifie les droits du compte API sur les contacts.',
   no_accessible_orders:'La recherche n’a trouvé aucune commande accessible : la fiche partenaire n’a pas été consultée.',
   legacy_unknown:'La fiche partenaire n’a pas pu être lue. Relance la vérification dans la dernière préversion.'
  };
  box.append(node('p','client-source-warning',
   diagnostics[h.partnerDiagnostic]||'Fiche partenaire indisponible. Historique des commandes conservé, identité à vérifier séparément.'));
 }
 if(!h.orders.length){box.append(node('p','client-quiet','Aucune commande trouvée pour cet identifiant dans la période.'));return box}
 const byYear=new Map();
 for(const row of h.orders){
  const year=row.date.slice(0,4);
  if(!byYear.has(year))byYear.set(year,[]);
  byYear.get(year).push(row);
 }
 for(const [year,orders] of byYear){
  const group=node('details','client-history-year');
  if(byYear.size===1||year===h.orders[0].date.slice(0,4))group.open=true;
  group.append(node('summary','',year+' · '+orders.length+' commande(s)'));
  for(const row of orders){
   const item=node('article','client-history-order');
   item.append(node('strong','',row.reference+' · '+row.company+' · '+statusText(row.state)));
   item.append(node('small','',
    [shortDate(row.date),row.amount!==null&&row.currency?formatMoney(row.amount,row.currency):'Montant absent'].join(' · ')));
   group.append(item);
  }
  box.append(group);
 }
 return box;
}

function clientPeriodOrders(name){
 const section=node('section','client-section client-odoo');
 section.append(node('h3','','Commandes Odoo · historique client'));
 const verifiedLink=clients.detail?.odooPartnerLink;
 if(!verifiedLink)section.append(clientCandidateDiscovery());
 if(verifiedLink){
  section.append(node('p','client-link-confirmed',
   'Lien confirmé par le propriétaire · partenaire Odoo #'+verifiedLink.partnerId+
   ' · enregistré le '+shortDate(verifiedLink.confirmedAt)));
  section.append(clientHistoryPanel(verifiedLink.partnerId));
  const revoke=node('button','client-link-revoke',
   clients.linkCandidate===-verifiedLink.partnerId?
   'Confirmer la désactivation du lien #'+verifiedLink.partnerId:
   'Désactiver cette liaison');
  revoke.type='button';revoke.disabled=clients.linkSubmitting;
  revoke.addEventListener('click',()=>{
   if(clients.linkCandidate!==-verifiedLink.partnerId){clients.linkCandidate=-verifiedLink.partnerId;renderClients();return;}
   changeOdooLink('revoke',verifiedLink.partnerId,clients.selected);
  });
  section.append(revoke);
  if(clients.linkError)section.append(node('p','client-source-warning',clients.linkError));
 }
 const report=state.report;
 if(!report){
  section.append(node('p','client-source-warning',
   'Aucune période Odoo chargée. Appuie sur ↻ pour consulter les commandes du mois sélectionné.'));
  return section;
 }
 section.append(node('p','client-provenance',
  verifiedLink?
  'Commandes du mois proposées par nom : ne pas fusionner les éventuels autres partenaires Odoo avec le compte confirmé #'+verifiedLink.partnerId+'.':
  'Correspondances proposées uniquement à partir du nom strictement identique. Aucun identifiant partenaire Odoo n’est encore vérifié pour cette fiche. Vérifier avant de fusionner les historiques.'));
 const rows=proposePeriodOdooOrders(name,report);
 const identity=assessOdooPartnerCandidates(rows);
 if(identity.conflicting)section.append(node('p','client-source-warning',
  'Attention : plusieurs identifiants partenaires Odoo correspondent à ce nom ('+
  identity.distinctPartnerIds.join(', ')+'). Ne pas fusionner ces comptes sans vérification.'));
 if(identity.missingPartnerIds)section.append(node('p','client-source-warning',
  identity.missingPartnerIds+' commande(s) sans identifiant partenaire Odoo exploitable.'));
 if(!rows.length){
  section.append(node('p','client-quiet','Aucune correspondance exacte dans les commandes chargées de ce mois. Cela ne signifie pas qu’il n’existe pas d’autres commandes.'));
  return section;
 }
 for(const o of rows){
  const entry=node('article','client-odoo-order');
  entry.append(node('strong','',o.reference+' · '+o.company));
  entry.append(node('small','',
   [shortDate(o.date),statusText(o.state),
    o.amount!==null&&o.currency?formatMoney(o.amount,o.currency):'',
    o.partnerOdooId!==null?'Partenaire Odoo #'+o.partnerOdooId:'Identité Odoo non renseignée'].filter(Boolean).join(' · ')));
  const btn=node('button','audit-order-link','Voir la commande dans Companion');
  btn.type='button';btn.addEventListener('click',()=>openAuditOrder(o));
  entry.append(btn);section.append(entry);
 }
 if(verifiedLink&&identity.distinctPartnerIds.some(id=>id!==verifiedLink.partnerId))
  section.append(node('p','client-source-warning',
   'Attention : une commande portant ce nom appartient à un autre identifiant Odoo que le partenaire lié. Aucun regroupement automatique.'));
 if(!verifiedLink&&!identity.conflicting&&identity.missingPartnerIds===0&&identity.distinctPartnerIds.length===1)
  section.append(clientHistoryPanel(identity.distinctPartnerIds[0]));
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
  back.type='button';back.addEventListener('click',()=>{archives.close();clientRequests.invalidate();clients.selected=null;clients.detail=null;clients.full=null;clients.fullError='';clients.history=null;clients.historyPartner=null;clients.historyLoading=false;clients.historyError='';clients.linkCandidate=null;clients.linkSubmitting=false;clients.linkError='';clients.candidates=null;clients.candidateLoading=false;clients.candidateError='';clients.candidatePartner=null;clients.loading=false;clients.error='';renderClients()});
  details.append(back);
  if(clients.loading){details.append(empty('Chargement de la fiche client…'));return}
  if(clients.error){details.append(empty(clients.error));return}
  const d=clients.detail;if(!d){details.append(empty('Fiche non disponible.'));return}
  const header=node('div','client-profile');
  header.append(node('strong','',d.profile.name),node('span','',[d.profile.status,d.profile.address,d.profile.country].filter(Boolean).join(' · ')||'CRM propriétaire'));
  details.append(header);
  details.append(clientPeriodOrders(d.profile.name));
  details.append(clientMemoryPanel(d,clients.full,clients.history));
  if(d.memory)details.append(clientSection('Mémoire commerciale · synthèse automatique non vérifiée',[
   ['Synthèse conservée dans sa langue d’origine',d.memory],
   ['Fiabilité','Les mentions « payé », « confirmed paid » ou équivalentes proviennent des échanges, pas d’une vérification des encaissements.']
  ]));
  details.append(clientSection('Actions en cours',d.attention.tasks.map(t=>[t.title,[t.description,t.dueAt?'Échéance : '+shortDate(t.dueAt):''].filter(Boolean).join(' · ')])));
  details.append(clientSection('Contacts',d.contacts.map(c=>[c.name,[c.role,...c.channels.map(x=>x.type+': '+x.value)].filter(Boolean).join(' · ')])));
  details.append(client360Section(clients.full,clients.fullError,d.profile.name));
  archives.renderClient(details,clients.selected);
  const toStrategy=node('button','secondary-button','Voir la stratégie commerciale de ce client');
  toStrategy.type='button';toStrategy.addEventListener('click',()=>{
    strategy.focus(clients.selected);navigate('strategy');
  });details.append(toStrategy);
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

function renderViews(){tasks.render();odooQuotes.render();strategy.render();archives.render();renderStats();renderHome();renderOrders();renderCommissions();renderClients();renderDashboard()}
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

