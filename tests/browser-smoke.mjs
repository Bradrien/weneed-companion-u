/**
 * Browser-level contract test. Uses a local static server and entirely synthetic,
 * intercepted Supabase replies. No production login or real CRM data is used.
 */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {join, extname, resolve, sep} from 'node:path';
import {mkdir} from 'node:fs/promises';
import {chromium} from 'playwright';

const root=resolve(new URL('..',import.meta.url).pathname);
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.webmanifest':'application/manifest+json'};
const server=createServer(async(req,res)=>{
 try{
  const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
  const path=pathname==='/'?join(root,'index.html'):resolve(root,'.'+pathname);
  if(path!==root&&!path.startsWith(root+sep)){res.writeHead(403).end();return}
  const content=await readFile(path);
  res.writeHead(200,{'content-type':mime[extname(path)]||'application/octet-stream','cache-control':'no-store'}).end(content);
 }catch{res.writeHead(404).end('not found')}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin='http://127.0.0.1:'+server.address().port;
const uuid='fef12218-1111-4111-8111-bb011ac01ac0';
const uuid2='fef12218-1111-4111-8111-bb011ac01ac1';
let linkedSecond=false;
const crmCard={profile:{id:uuid,name:'Boutique Test',status:'ACTIVE',address:'12 rue Exemple',country:'France'},
 odoo_partner_link:{partner_odoo_id:777,confirmed_by:'owner_explicit',confirmed_at:'2026-10-10T17:13:54Z'},
 memory:{summary:'Compte de démonstration, aucune donnée réelle.'},
 contacts:[{name:'Contact Démo',role:'Gérant',channels:[{type:'email',value:'demo@example.test'}]}],
 attention:{open_task_count:1,overdue_task_count:0,tasks:[{title:'Rappeler le gérant',due_at:'2026-10-15'}]},
 activity:{recent:[{source:'whatsapp',type:'message',occurred_at:'2026-10-08',body:'Échange de démonstration'}]}};
const secondCard={profile:{id:uuid2,name:'Boutique Sans Lien',status:'client'},
 contacts:[{name:'Gérant fictif',channels:[{type:'email',value:'second@example.test'}]}],
 attention:{tasks:[]},activity:{recent:[]}};
const clients=[{client_id:uuid,canonical_name:'Boutique Test',status:'ACTIVE',summary:'Client fictif pour tests',open_task_count:1,overdue_task_count:0,event_count:1},
 {client_id:uuid2,canonical_name:'Boutique Sans Lien',status:'client',summary:'Candidat Odoo à confirmer',open_task_count:0,overdue_task_count:0,event_count:0}];
const crm360={profile:{id:uuid,canonical_name:'Boutique Test'},memory:{},
 business_objects:[{id:'doc-1',type:'invoice',key:'INV-DEMO',status:'sent',amount:120,currency:'EUR'}],
 key_facts:[{type:'document',status:'inferred',value:{text:'Document mentionné dans un échange fictif'}}],
 conversations:[{id:'conv-1',source:'gmail',title:'E-mail de démonstration',last_event_at:'2026-09-25'}],
 stale_tasks:[{title:'Ancienne action test',description:'À réexaminer'}]};
let odooFailure=false;
let odooLoginRejected=false;
let pinnedReadAccepted=true;
const dashboard={stats:{clients_total:131,clients_needing_attention:1,open_actionable_tasks:1,overdue_actionable_tasks:0},
 attention_clients:clients,unassigned_actionable_tasks:[]};
const report=(from,to)=>({source:'odoo_live_read_only',period_from:from,period_to:to,
 persisted:false,verified_commissions_eur:null,commissions_are_calculated:false,
 source_order_status_rechecked:true,source_order_status_checked_at:'2026-10-10T15:00:00.000Z',
 orders_count:1,catalog_snapshot:{products_total:1385,source_completed_at:'2026-10-10T00:35:35Z'},
 catalog_matching:{eligible:2,matched:1,not_found:0,missing_sku:1,ambiguous_sku:0,catalog_invalid_price:0,zero_cost:0,zero_list_price:0},
 line_kinds:{candidate:1,review:1,sample:0,shipping:0,anomaly:0},
 orders:[{id:987,reference:'TEST-ORDER',date:from,company:'GTA',client:'Boutique Test',partner_odoo_id:777,salesperson:'Test Owner',
  currency:'EUR',state:'sale',amount_ht:220,line_sum_ht:220,amount_difference:0,
  commission_eur:null,issues:[],
  lines:[{id:1,sku:'SKU/TEST',product_name:'Produit Démo',quantity:100,unit_price:2,
   discount_pct:0,line_ht:200,kind:'candidate',commission_eur:null,
   catalog_match:{status:'matched',tier:'A',category:'Indoor',cost_eur:1.5,list_price_eur:2,cost_zero:false,price_zero:false}},
  {id:2,sku:'',product_name:'[TT/G] Fictitious Tangie Tonic',quantity:1,unit_price:20,
   discount_pct:0,line_ht:20,kind:'review',commission_eur:null,
   catalog_match:{status:'missing_sku',candidate:{sku:'TT/G',status:'found',catalog_name:'Fictitious catalog',tier:'A',category:'GR'}}}]}]});
const json=(payload,status=200)=>({status,contentType:'application/json',headers:{
 'access-control-allow-origin':'*','access-control-allow-headers':'authorization,apikey,content-type,x-client-info',
 'access-control-allow-methods':'GET,POST,OPTIONS'},body:JSON.stringify(payload)});

let browser;
try{
 browser=await chromium.launch({headless:true});
 const context=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:2});
 const page=await context.newPage();
 page.setDefaultTimeout(10000);
 const errors=[];
 page.on('pageerror',err=>errors.push(err.message));
 await page.route('https://gcirlrghjvumhkekrtmf.supabase.co/**',async route=>{
  const req=route.request();
  const u=new URL(req.url());
  if(req.method()==='OPTIONS'){await route.fulfill({status:204,headers:json(null).headers});return}
  let body;
  if(u.pathname==='/auth/v1/token')body={access_token:'fake-access-browser-only',refresh_token:'fake-refresh-browser-only',expires_in:3600};
  else if(u.pathname==='/auth/v1/logout')body={};
  else if(u.pathname==='/functions/v1/companion-profile')body={ok:true,role:'owner'};
  else if(u.pathname==='/functions/v1/companion-api/dashboard')body={ok:true,data:dashboard};
  else if(u.pathname==='/functions/v1/odoo-read'){
   const resource=u.searchParams.get('resource');
   if(resource==='ping'&&odooFailure){await route.fulfill(json({ok:false,error:'upstream_failure'},502));return}
   if(resource==='ping'&&odooLoginRejected){await route.fulfill(json({ok:false,error:'odoo_credentials_rejected'},502));return}
   if(resource==='credential_probe'){
    if(pinnedReadAccepted)body={ok:true,data:{pinned_credentials_accepted:true,returned_order_data:false,mode:'read_only',persisted:false}};
    if(pinnedReadAccepted){await route.fulfill(json(body));return}
    else {await route.fulfill(json({ok:false,error:'odoo_pinned_read_rejected'},502));return}
   }
   if(resource==='ping')body={ok:true,data:{connected:true,mode:'read_only',persisted:false}};
   else if(resource==='orders_probe')body={ok:true,data:{readable:true,has_accessible_orders:true,mode:'read_only',returned_order_data:false,persisted:false}};
   else throw Error('Unexpected Odoo diagnostic request: '+resource);
  }
  else if(u.pathname==='/functions/v1/companion-api/clients')body={ok:true,data:clients};
  else if(u.pathname===('/functions/v1/companion-api/clients/'+uuid+'/card'))body={ok:true,data:crmCard};
  else if(u.pathname===('/functions/v1/companion-api/clients/'+uuid2+'/card'))
   body={ok:true,data:{...secondCard,odoo_partner_link:linkedSecond?
    {partner_odoo_id:778,confirmed_by:'owner_explicit',confirmed_at:'2026-10-10T18:00:00Z'}:null}};
  else if(u.pathname===('/functions/v1/companion-api/clients/'+uuid))body={ok:true,data:crm360};
  else if(u.pathname===('/functions/v1/companion-api/clients/'+uuid2))
   body={ok:true,data:{profile:{id:uuid2,canonical_name:'Boutique Sans Lien'},memory:{},
    key_facts:[],business_objects:[],conversations:[],stale_tasks:[]}};
  else if(u.pathname==='/functions/v1/client-odoo-link'){
   if(req.method()==='GET'){
    assert.equal(u.searchParams.get('client_id'),uuid2);
    body={ok:true,data:{client_id:uuid2,matching:'exact_partner_name_and_salesperson_orders',
     complete:false,verified:false,sampled_orders:2,
     candidates:[{partner_odoo_id:778,name:'Boutique Sans Lien',examples:2,last_date:'2026-09-11'}]}};
   }else{
    const request=req.postDataJSON();
    assert.equal(request.client_id,uuid2);
    assert.equal(request.partner_id,778);
    assert.equal(request.action,'confirm');
    assert.equal(request.confirmation,'CONFIRMER_LIAISON');
    linkedSecond=true;body={ok:true,status:'linked',partner_odoo_id:778,confirmed_at:'2026-10-10T18:00:00Z'};
   }
  }
  else if(u.pathname==='/functions/v1/client-odoo-history'){
   const partner=Number(u.searchParams.get('partner_id'));
   assert.ok([777,778].includes(partner));
   body={ok:true,data:{source:'odoo_partner_history_read_only',identity_verified:false,
    partner_odoo_id:partner,period_from:u.searchParams.get('from'),period_to:u.searchParams.get('to'),
    checked_at:'2026-10-10T16:30:00Z',partner_diagnostic:'complete',
    partner:{id:partner,name:partner===777?'Boutique Test':'Boutique Sans Lien',
    email:partner===777?'demo@example.test':'second@example.test',
    phone:'',mobile:'',street:'12 rue Exemple',zip:'',city:'',parent_odoo_id:null},
    orders:partner===778?[{id:889,reference:'CAND-ORDER',partner_odoo_id:778,company:'TR',
     date:'2026-09-11',state:'sale',amount_ht:300,currency:'EUR'}]:[
     {id:987,reference:'TEST-ORDER',partner_odoo_id:777,company:'GTA',date:'2026-09-10',state:'sale',amount_ht:220,currency:'EUR'},
     {id:888,reference:'OLD-ORDER',partner_odoo_id:777,company:'TR',date:'2025-06-10',state:'cancel',amount_ht:150,currency:'EUR'}
    ]}};
  }
  else if(u.pathname==='/functions/v1/commission-catalog-review'){
   const from=u.searchParams.get('from'),to=u.searchParams.get('to');
   body={ok:true,data:report(from,to)};
  }
  else throw Error('Unexpected API route: '+req.method()+' '+u.pathname);
  await route.fulfill(json(body));
 });
 await page.goto(origin+'/',{waitUntil:'domcontentloaded'});
 await page.locator('#login-panel').waitFor({state:'visible'});
 assert.equal(await page.locator('#app-panel').isVisible(),false);
 await page.locator('#login-password').fill('not-a-real-password');
 await page.locator('#login-button').click();
 await page.locator('#app-panel').waitFor({state:'visible',timeout:10000});
 await page.locator('#crm-stats .metric').first().waitFor({state:'visible'});
 assert.match(await page.locator('#crm-stats').innerText(),/131/);
 assert.match(await page.locator('#crm-attention').innerText(),/Boutique Test/);
 await page.screenshot({path:'artifacts/companion-mobile-smoke.png',fullPage:true});
 await page.locator('#bottom-nav [data-nav="clients"]').click();
 await page.locator('#client-search').fill('Boutique');
 await page.locator('#clients-list .client-row').first().waitFor({state:'visible'});
 await page.locator('#clients-list .client-row').first().click();
 await page.locator('#client-detail .client-profile').waitFor({state:'visible'});
 assert.match(await page.locator('#client-detail').innerText(),/Contact Démo/);
 assert.match(await page.locator('#client-detail').innerText(),/Rappeler le gérant/);
 assert.match(await page.locator('#client-detail').innerText(),/Dossier commercial/);
 assert.match(await page.locator('#client-detail').innerText(),/INV-DEMO/);
 assert.match(await page.locator('#client-detail').innerText(),/Conversations par source/);
 assert.match(await page.locator('#client-detail .client-link-confirmed').innerText(),/partenaire Odoo #777/);
 assert.equal(await page.locator('#client-detail .client-history-panel button').count(),1);
 const privateStorage=await page.evaluate(()=>Object.keys(sessionStorage));
 assert.deepEqual(privateStorage,['weneed_v1_ephemeral_session']);
 await page.locator('#bottom-nav [data-nav="orders"]').click();
 await page.locator('#reload').click();
 await page.locator('#orders-list .order-card').first().waitFor({state:'visible'});
 assert.match(await page.locator('#orders-list').innerText(),/TEST-ORDER/);
 await page.locator('#bottom-nav [data-nav="clients"]').click();
 assert.match(await page.locator('#client-detail .client-odoo').innerText(),/TEST-ORDER/);
 assert.match(await page.locator('#client-detail .client-odoo').innerText(),/Partenaire Odoo #777/);
 await page.locator('#client-detail .client-history-panel button').first().click();
 await page.locator('#client-detail .client-history-summary').waitFor({state:'visible'});
 assert.match(await page.locator('#client-detail .client-history-summary').innerText(),/2 commande\(s\)/);
 assert.match(await page.locator('#client-detail .client-history-summary').innerText(),/1 annulée\(s\)/);
 assert.match(await page.locator('#client-detail .client-partner-evidence').innerText(),/nom identique/);
 assert.match(await page.locator('#client-detail .client-partner-evidence').innerText(),/e-mail identique/);
 assert.match(await page.locator('#client-detail .client-partner-evidence').innerText(),/lien confirmé par le propriétaire/);
 await page.locator('#client-detail .client-history-year').last().evaluate(el=>{el.open=true});
 assert.match(await page.locator('#client-detail .client-history-panel').innerText(),/OLD-ORDER/);

 assert.match(await page.locator('#client-detail .client-odoo').innerText(),/Commandes du mois proposées par nom/);
 await page.locator('#client-detail .client-odoo .audit-order-link').first().click();
 await page.locator('#view-orders').waitFor({state:'visible'});
 assert.match(await page.locator('#order-search').inputValue(),/TEST-ORDER/);

 await page.locator('#bottom-nav [data-nav="commissions"]').click();
 assert.match(await page.locator('#view-commissions').innerText(),/Simulation sous conditions/);
 await page.locator('#commission-scenario .scenario-metric').first().waitFor({state:'visible'});
 assert.match(await page.locator('#commission-scenario').innerText(),/SIMULATION CONDITIONNELLE/);
 assert.match(await page.locator('#commission-scenario').innerText(),/États des commandes revérifiés dans Odoo/);
 assert.match(await page.locator('#commission-scenario').innerText(),/Commandes Odoo annulées : 0/);
 assert.match(await page.locator('#commission-scenario').innerText(),/2,72/);
 assert.match(await page.locator('#commission-scenario').innerText(),/1 ligne\(s\) simulée/);
 assert.match(await page.locator('#commission-scenario').innerText(),/Lignes non simulées : 1/);
 await page.locator('#commission-scenario .scenario-order .audit-order-link').first().click();
 await page.locator('#view-orders').waitFor({state:'visible'});
 assert.match(await page.locator('#order-search').inputValue(),/TEST-ORDER/);
 await page.locator('#bottom-nav [data-nav="commissions"]').click();
 await page.locator('#commission-audit .audit-heading').first().waitFor({state:'visible'});
 assert.match(await page.locator('#commission-audit').innerText(),/Références internes Odoo manquantes/);
 assert.match(await page.locator('#commission-audit').innerText(),/Classement par mot-clé/);
 assert.match(await page.locator('#commission-audit').innerText(),/GTA · \[TT\/G\]/);
 assert.match(await page.locator('#commission-audit').innerText(),/1 groupe\(s\) retrouvé\(s\) exactement/);
 assert.match(await page.locator('#commission-audit .audit-verified').first().innerText(),/Référence exacte trouvée dans Kino/);
 await page.locator('#commission-audit .audit-order-link').first().click();
 await page.locator('#view-orders').waitFor({state:'visible'});
 assert.match(await page.locator('#order-search').inputValue(),/TEST-ORDER/);
 assert.equal(await page.locator('#orders-list .order-button').first().getAttribute('aria-expanded'),'true');
 assert.match(await page.locator('#orders-list').innerText(),/Fictitious Tangie Tonic/);
 await page.locator('#bottom-nav [data-nav="commissions"]').click();

 await page.locator('#bottom-nav [data-nav="settings"]').click();
 await page.locator('#odoo-probe').click();
 await page.waitForFunction(()=>document.getElementById('odoo-probe-status').textContent.includes('Connexion Odoo opérationnelle'));
 assert.match(await page.locator('#odoo-state').innerText(),/Accès lecture validé/);
 odooFailure=true;
 await page.locator('#odoo-probe').click();
 await page.waitForFunction(()=>document.getElementById('odoo-probe-status').textContent.includes('upstream_failure'));
 assert.match(await page.locator('#odoo-probe-status').innerText(),/ping · upstream_failure · HTTP 502/);
 assert.match(await page.locator('#odoo-probe-status').innerText(),/erreur serveur inattendue/);
 odooFailure=false;
 odooLoginRejected=true;
 await page.locator('#odoo-probe').click();
 await page.waitForFunction(()=>document.getElementById('odoo-probe-status').textContent.includes('La clé fonctionne avec l’UID attendu'));
 assert.match(await page.locator('#odoo-probe-status').innerText(),/odoo_credentials_rejected/);
 pinnedReadAccepted=false;
 await page.locator('#odoo-probe').click();
 await page.waitForFunction(()=>document.getElementById('odoo-probe-status').textContent.includes('odoo_pinned_read_rejected'));
 assert.match(await page.locator('#odoo-probe-status').innerText(),/Test UID direct \[odoo_pinned_read_rejected · HTTP 502\]/);
 odooLoginRejected=false;

 await page.locator('#bottom-nav [data-nav="clients"]').click();
 await page.locator('#client-search').fill('Sans Lien');
 await page.locator('#clients-list .client-row').filter({hasText:'Boutique Sans Lien'}).click();
 await page.locator('#client-detail .client-candidate-discovery button').first().click();
 await page.locator('#client-detail .client-candidate').first().waitFor({state:'visible'});
 assert.match(await page.locator('#client-detail .client-candidate').innerText(),/Partenaire #778/);
 assert.equal(await page.locator('#client-detail .client-link-confirmed').count(),0);
 await page.locator('#client-detail .client-candidate button').first().click();
 await page.locator('#client-detail .client-candidate .client-history-panel button').first().click();
 await page.locator('#client-detail .client-partner-evidence').waitFor({state:'visible'});
 assert.match(await page.locator('#client-detail .client-partner-evidence').innerText(),/e-mail identique/);
 assert.match(await page.locator('#client-detail .client-memory-digest').innerText(),/Aucun historique Odoo exploitable/);
 await page.locator('#client-detail .client-link-action button').first().click();
 assert.match(await page.locator('#client-detail .client-link-action').innerText(),/Confirmer le rattachement permanent/);
 await page.locator('#client-detail .client-link-action button').first().click();
 await page.locator('#client-detail .client-link-confirmed').waitFor({state:'visible'});
 assert.match(await page.locator('#client-detail .client-link-confirmed').innerText(),/partenaire Odoo #778/);
 assert.match(await page.locator('#client-detail .client-memory-digest').innerText(),/1 commandes confirmées/);

 await page.locator('#logout-top').click();
 await page.locator('#login-panel').waitFor({state:'visible'});
 assert.equal(await page.locator('#app-panel').isVisible(),false);
 assert.deepEqual(await page.evaluate(()=>Object.keys(sessionStorage)),[]);
 assert.deepEqual(errors,[],'Unhandled JavaScript errors: '+errors.join('; '));
 console.log('PASS browser smoke: mobile login, CRM, client card, orders, commission guard, Odoo diagnostics, logout');
}finally{
 if(browser)await browser.close();
 await new Promise(resolve=>server.close(resolve));
}
