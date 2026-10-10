'use strict';
importScripts('search-core.js');
const BASE = 'https://gcirlrghjvumhkekrtmf.supabase.co';
const API_KEY = 'sb_publishable_0JAZ1U4SdNDWmu4b9O1-7g_NWQfqklp'; // public key, not a secret
const KINO_URL = 'https://kinocommission.base44.app/*';
let running = false;
let lastError = '';
let lastStatus = '';

async function setStatus(msg, err='') {
  lastStatus = msg;
  lastError = err;
  await chrome.storage.session.set({bridgeStatus:{message:msg,error:err,at:new Date().toISOString()}});
}
async function getSession() {
  const {session} = await chrome.storage.session.get('session');
  if (!session?.access_token) return null;
  if (Date.now() < (session.expires_at_ms - 90000)) return session;
  if (!session.refresh_token) return null;
  try {
    const response=await fetch(BASE+'/auth/v1/token?grant_type=refresh_token',{
      method:'POST',headers:{'apikey':API_KEY,'content-type':'application/json'},
      body:JSON.stringify({refresh_token:session.refresh_token}),cache:'no-store'
    });
    if(!response.ok) throw new Error('refresh_failed');
    const updated=await response.json();
    const next={access_token:updated.access_token,refresh_token:updated.refresh_token,
      expires_at_ms:Date.now()+(Number(updated.expires_in)||3600)*1000,email:session.email};
    await chrome.storage.session.set({session:next});
    return next;
  } catch {
    await chrome.storage.session.remove('session');
    await setStatus('Session Companion expirée. Reconnecte-toi.', 'auth_expired');
    return null;
  }
}
async function gateway(path, body) {
  const session=await getSession();
  if(!session) throw new Error('companion_signin_required');
  const response=await fetch(BASE+'/functions/v1/kino-bridge'+path,{
    method:body===undefined?'GET':'POST',
    headers:{'apikey':API_KEY,'authorization':'Bearer '+session.access_token,
      'content-type':'application/json'},
    ...(body===undefined?{}:{body:JSON.stringify(body)}),cache:'no-store'
  });
  const data=await response.json().catch(()=>null);
  if(!response.ok || !data?.ok) throw new Error(data?.error || `bridge_http_${response.status}`);
  return data;
}
async function openKinoTab() {
  const tabs=await chrome.tabs.query({url:KINO_URL});
  return tabs.find(t=>t.id&&t.status==='complete') || null;
}
async function inspectTab(tab) {
  return chrome.tabs.sendMessage(tab.id,{type:'KINO_INSPECT'});
}
async function catalogTab(tab) {
  return chrome.tabs.sendMessage(tab.id,{type:'KINO_CATALOG_SNAPSHOT'});
}
async function simulatorTab(tab) {
  return chrome.tabs.sendMessage(tab.id,{type:'KINO_SIMULATOR_PROBE'});
}
async function searchProbeTab(tab,sku){
  return chrome.tabs.sendMessage(tab.id,{type:'KINO_SIMULATOR_SEARCH_PROBE',sku});
}
async function poll() {
  if(running) return;
  running=true;
  try {
    const session=await getSession();
    if(!session) return;
    const tab=await openKinoTab();
    if(!tab) {await setStatus('Ouvre Kino dans Chrome et actualise la page.');return;}
    const isReady=await inspectTab(tab).catch(()=>null);
    if(!isReady?.ok) {await setStatus('Recharge l’onglet Kino pour activer l’extension.');return;}
    const {job}=await gateway('?op=poll',{});
    if(!job) {await setStatus('Connecté. En attente d’une demande de lecture.');return;}
    if(!['inspect','catalog_snapshot','simulator_probe','simulator_search_probe'].includes(job.action)) {
      await gateway('?op=result',{id:job.id,state:'failed',error_code:'unsupported_action'});
      await setStatus('Demande non reconnue.');return;
    }
    if(job.action==='catalog_snapshot') await setStatus('Lecture du catalogue Kino en cours…');
    if(job.action==='simulator_search_probe')await setStatus('Recherche temporaire d’un produit Kino…');
    if(job.action==='simulator_search_probe' && (typeof job.payload?.sku!=='string'|| !/^[A-Za-z0-9][A-Za-z0-9+\/_().-]{0,63}$/.test(job.payload.sku)))throw new Error('invalid_sku');
    const report=job.action==='catalog_snapshot' ?
      await catalogTab(tab).catch(()=>null) :
      job.action==='simulator_probe' ? await simulatorTab(tab).catch(()=>null) :
      job.action==='simulator_search_probe' ? await searchProbeTab(tab,job.payload.sku).catch(()=>null) :
      await inspectTab(tab).catch(()=>null);
    if(report?.ok) {
      // Strictly upload only the requested job's bounded data.
      if(job.action==='catalog_snapshot' && (!report.result?.catalog?.rows?.length ||
           report.result.catalog.rows.length>1500)) throw new Error('invalid_catalog');
      await gateway('?op=result',{id:job.id,state:'completed',result:report.result});
      if(job.action==='catalog_snapshot'){
        const c=report.result.catalog;
        await setStatus('Catalogue reçu : '+c.collected_count+' / '+(c.expected_count||'?')+
          ' produits ('+ (c.status==='complete'?'complet':'partiel')+').'+
          (c.status==='partial'?' Cause : '+(c.diagnostics?.stop_reason||'non déterminée')+'.':'') );
      }else if(job.action==='simulator_probe'){
        await setStatus('Champs du simulateur identifiés et transmis (aucune valeur saisie).');
      }else if(job.action==='simulator_search_probe'){
        await setStatus('Suggestions de recherche transmises. Champ vidé, sans sélectionner de produit.');
      }else await setStatus('Inspection Kino envoyée au Companion.');
    } else {
      await gateway('?op=result',{id:job.id,state:'failed',error_code:report?.error||'tab_unavailable'});
      await setStatus('Lecture Kino impossible : '+(report?.error||'onglet inaccessible'));
    }
  } catch (err) {await setStatus('Connexion au Companion à vérifier.',String(err?.message||'bridge_error').slice(0,60));}
  finally {running=false;}
}
async function signIn(email,password) {
  const response=await fetch(BASE+'/auth/v1/token?grant_type=password',{
    method:'POST',headers:{'apikey':API_KEY,'content-type':'application/json'},
    body:JSON.stringify({email,password}),cache:'no-store'
  });
  if(!response.ok) throw new Error('Identifiants Companion incorrects ou compte non autorisé.');
  const data=await response.json();
  if(!data.access_token || !data.refresh_token) throw new Error('Invalid auth response');
  await chrome.storage.session.set({session:{access_token:data.access_token,
    refresh_token:data.refresh_token,expires_at_ms:Date.now()+(Number(data.expires_in)||3600)*1000,
    email}});
  try {await gateway('');}
  catch(err){await chrome.storage.session.remove('session');throw new Error('Accès propriétaire refusé : '+String(err.message).slice(0,90));}
  await setStatus('Authentifié. En attente d’une demande de lecture.');
  await chrome.alarms.create('pollKino',{periodInMinutes:0.5});
}
chrome.runtime.onMessage.addListener((message,sender,respond)=>{
  if(sender.tab || !message || !['LOGIN','LOGOUT','STATUS','CHECK','INSPECT_LOCAL','CATALOG_LOCAL','SIMULATOR_LOCAL','SEARCH_LOCAL'].includes(message.type)) {
    respond({ok:false,error:'unsupported_message'});return;
  }
  (async()=>{
    if(message.type==='LOGIN'){
      if(typeof message.email!=='string'||typeof message.password!=='string'||message.password.length>512) throw new Error('Identifiants manquants.');
      await signIn(message.email.trim(),message.password);return {ok:true};
    }
    if(message.type==='LOGOUT'){
      await chrome.storage.session.remove('session');await setStatus('Déconnecté.');return {ok:true};
    }
    if(message.type==='CHECK'){await poll();return {ok:true};}
    if(message.type==='CATALOG_LOCAL'){
      const t=await openKinoTab();if(!t)return {ok:false,error:'Onglet Kino introuvable.'};
      const report=await catalogTab(t).catch(()=>null);
      if(!report?.ok)return {ok:false,error:report?.error||'Lecture catalogue impossible.'};
      const c=report.result.catalog;
      return {ok:true,summary:{collected:c.collected_count,expected:c.expected_count,
        complete:c.status==='complete',examples:c.rows.slice(0,2).map(x=>x.sku+' ('+x.company+')'),
        diagnostics:c.diagnostics}};
    }
    if(message.type==='SEARCH_LOCAL'){
      const t=await openKinoTab();if(!t)return {ok:false,error:'Onglet Kino introuvable.'};
      const sku=message.sku===undefined?'AB/I':message.sku;
      if(!KinoSearch.validSku(sku))return {ok:false,error:'SKU invalide (64 caractères maximum).'};
      const r=await searchProbeTab(t,sku).catch(()=>null);
      if(!r?.ok)return {ok:false,error:r?.error||'Recherche non accessible.'};
      const d=r.result.search;
      return {ok:true,summary:{sku:d.query_sku,count:d.candidates.length,
        labels:d.candidates.slice(0,8).map(x=>x.text),restored:true}};
    }
    if(message.type==='SIMULATOR_LOCAL'){
      const t=await openKinoTab();
      if(!t)return {ok:false,error:'Onglet Kino introuvable.'};
      const report=await simulatorTab(t).catch(()=>null);
      if(!report?.ok)return {ok:false,error:report?.error||'Inspection impossible.'};
      const d=report.result.simulator;
      return {ok:true,summary:{count:d.total_visible_controls,
        controls:d.controls.slice(0,8).map(c=>[c.tag,c.placeholder||c.label||c.nearby_text].filter(Boolean).join(' — ')),
        headings:d.headings.slice(0,5)}};
    }
    if(message.type==='INSPECT_LOCAL'){
      const t=await openKinoTab();if(!t) return {ok:false,error:'Onglet Kino introuvable.'};
      const snap=await inspectTab(t).catch(()=>null);
      return snap?.ok?{ok:true,summary:{title:snap.result.page_title,
         headings:snap.result.section_headings,buttons:snap.result.buttons.slice(0,10)}}:{ok:false,error:'Recharge l’onglet Kino.'};
    }
    const {session,bridgeStatus}=await chrome.storage.session.get(['session','bridgeStatus']);
    return {ok:true,authenticated:Boolean(session?.access_token),email:session?.email||'',
      status:bridgeStatus?.message||'Non connecté.',error:bridgeStatus?.error||''};
  })().then(respond,err=>respond({ok:false,error:String(err?.message||err).slice(0,160)}));
  return true;
});
chrome.alarms.onAlarm.addListener(alarm=>{if(alarm.name==='pollKino')void poll();});
chrome.runtime.onInstalled.addListener(()=>{chrome.alarms.create('pollKino',{periodInMinutes:0.5});});
chrome.runtime.onStartup.addListener(()=>{chrome.alarms.create('pollKino',{periodInMinutes:0.5});});
