'use strict';
const $=id=>document.getElementById(id);
function info(s){$('info').textContent=String(s||'');}
async function send(data) {return chrome.runtime.sendMessage(data);}
async function refresh(){
  const status=await send({type:'STATUS'});
  $('login').hidden=Boolean(status.authenticated);
  $('signed').hidden=!status.authenticated;
  info(status.status || status.error || 'Non connecté.');
}
$('login').addEventListener('submit',async ev=>{
  ev.preventDefault();
  $('connect').disabled=true;
  info('Connexion au Companion…');
  const email=$('email').value.trim(),pass=$('password').value;
  $('password').value='';
  try{const r=await send({type:'LOGIN',email,password:pass});
    info(r.ok?'Connexion réussie.':r.error);
    if(r.ok) await refresh();
  }catch{info('Impossible de joindre le Companion.');}
  finally{$('connect').disabled=false;}
});
$('check').addEventListener('click',async()=>{
  info('Vérification…');
  const r=await send({type:'CHECK'});
  if(!r.ok)info(r.error);
  else await refresh();
});
$('inspect').addEventListener('click',async()=>{
  const r=await send({type:'INSPECT_LOCAL'});
  info(r.ok?'Page Kino accessible : '+r.summary.title+'\nSections : '+r.summary.headings.join(', '):r.error);
});
$('catalog').addEventListener('click',async()=>{
  $('catalog').disabled=true;
  info('Lecture du catalogue en cours… Kino peut afficher progressivement les produits.');
  try{
    const r=await send({type:'CATALOG_LOCAL'});
    info(r.ok?'Catalogue local : '+r.summary.collected+' / '+(r.summary.expected||'?')+
      ' produits, '+(r.summary.complete?'complet':'partiel')+'\nExemples : '+
      r.summary.examples.join(', ')+
      (r.summary.complete?'':'\nDiagnostic : '+(r.summary.diagnostics?.stop_reason||'inconnu')+
        (r.summary.diagnostics?.last_button?'\nBouton : '+r.summary.diagnostics.last_button:'')+
        (r.summary.diagnostics?.pagination_labels?.length?'\nBoutons candidats : '+r.summary.diagnostics.pagination_labels.join(' | '):''))+
      '\nAucun transfert demandé.':r.error);
  }catch{info('Impossible de lire le catalogue dans cet onglet.');}
  finally{$('catalog').disabled=false;}
});
$('simulator').addEventListener('click',async()=>{
  info('Inspection locale des contrôles du simulateur…');
  const r=await send({type:'SIMULATOR_LOCAL'});
  info(r.ok?'Contrôles visibles : '+r.summary.count+'\nExemples : '+
     r.summary.controls.join(' | ')+'\nSections : '+r.summary.headings.join(', ')+
     '\nAucun transfert demandé.':r.error);
});
$('search').addEventListener('click',async()=>{
 const sku=$('search-sku').value.trim();
 $('search').disabled=true;info('Recherche temporaire du SKU '+sku+'…');
 try{
  const r=await send({type:'SEARCH_LOCAL',sku});
  info(r.ok?'Test local : '+r.summary.sku+'\nSuggestions : '+r.summary.count+
    (r.summary.labels.length?'\nExemples : '+r.summary.labels.join(' | '):'\nAucun produit reconnu pendant ce test. Vérifie la société et la recherche dans Kino.')+
    '\nRecherche prise en compte : '+(r.summary.input_accepted?'oui':'non')+
    '\nÉléments non produits écartés : '+r.summary.excluded_non_products+
    '\nListe de suggestions détectée : '+(r.summary.dropdown_detected?'oui':'non')+
    '\nLe champ de recherche a été vidé. Aucun produit ajouté. Aucun transfert demandé.':r.error);
 }catch{info('Test de recherche impossible.');}
 finally{$('search').disabled=false;}
});
$('logout').addEventListener('click',async()=>{await send({type:'LOGOUT'});await refresh();});
refresh().catch(()=>info('Erreur de chargement de l’extension.'));
