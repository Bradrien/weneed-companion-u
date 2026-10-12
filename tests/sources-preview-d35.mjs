import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,join,extname,sep} from 'node:path';
import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=resolve('validation-v12'),mime={'.html':'text/html','.mjs':'text/javascript','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml'};
const server=createServer(async(req,res)=>{try{const u=new URL(req.url,'http://localhost'),path=u.pathname==='/'?join(root,'index.html'):resolve(root,'.'+decodeURIComponent(u.pathname));if(path!==root&&!path.startsWith(root+sep))return res.writeHead(403).end();res.writeHead(200,{'content-type':mime[extname(path)]||'text/plain'}).end(await readFile(path))}catch{res.writeHead(404).end()}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const origin='http://127.0.0.1:'+server.address().port,id=n=>'10000000-1111-4111-8111-'+String(n).padStart(12,'0');
const time=new Date().toISOString(),since=new Date(Date.now()-6*3600000).toISOString(),older=new Date(Date.now()-3600000).toISOString();
const headers={'access-control-allow-origin':'*','access-control-allow-headers':'authorization,apikey,content-type,x-client-info','access-control-allow-methods':'GET,POST,OPTIONS'};
const json=(data,status=200)=>({status,contentType:'application/json',headers,body:JSON.stringify(data)});
const gates=new Map(),hold=(name,route,data)=>{gates.set(name,()=>route.fulfill(json(data)))};
async function gate(name){for(let i=0;i<100&&!gates.has(name);i++)await new Promise(r=>setTimeout(r,20));assert.ok(gates.has(name),'missing gate '+name);return async()=>{const release=gates.get(name);gates.delete(name);await release()}}
let sourceFail=false,stockFail=false,delayStock=false,delayOverview=false,delayAudio=false,delayPush=false,wrongAudio=false,wrongMessages=false;
let pushCalls=[],linkCalls=[],taskWrites=0,overviewName='Aperçu récent';
const connector=(source,extra={})=>({source,sync_in_progress:false,continuation_pending:false,last_run_status:'success',
 coverage_from:since,watermark_at:time,last_success_at:time,last_run_started_at:time,last_run_finished_at:time,last_error:null,
 inserted_count:0,duplicate_count:0,skipped_count:0,failed_count:0,...extra});
let sourceRows=[connector('gmail'),connector('google_chat',{continuation_pending:true,last_run_status:'partial'}),connector('google_drive',{watermark_at:older,last_success_at:older})];
const products=[...Array.from({length:55},(_,i)=>({company:'TR',product_id:i+1,sku:'TEST/TR/'+(i+1),product_name:'Produit TR '+(i+1),
 unit:'g',quantity_basis:'free_qty',available_quantity:i===0?-1.125:10,on_hand_quantity:20,forecast_quantity:30,checked_at:time})),
 ...Array.from({length:2},(_,i)=>({company:'GTA',product_id:i+1,sku:'TEST/GTA/'+(i+1),product_name:'Produit GTA '+(i+1),
 unit:'g',quantity_basis:'qty_available',available_quantity:10,on_hand_quantity:10,forecast_quantity:20,checked_at:time}))];
const stock=u=>{const c=u.searchParams.get('company')||'ALL',q=(u.searchParams.get('q')||'').toLowerCase(),offset=Number(u.searchParams.get('offset')||0),
 rows=products.filter(r=>(c==='ALL'||r.company===c)&&(!q||(r.product_name+' '+r.sku).toLowerCase().includes(q))).sort((a,b)=>a.company.localeCompare(b.company)||a.product_id-b.product_id);
 return {ok:true,data:{checked_at:time,stale:false,last_error:null,scan_interval_minutes:5,total:rows.length,
  summary:[{company:'TR',products:55,out_of_stock:1},{company:'GTA',products:2,out_of_stock:0}],items:rows.slice(offset,offset+50),
  alerts:c==='GTA'?[]:[{id:id(800),company:'TR',product_name:'Produit TR 1',unit:'g',kind:'out_of_stock',previous_quantity:1,current_quantity:-1.125,created_at:time}]}};
};
const conversations=Array.from({length:101},(_,i)=>({batch_id:id(1),chat_pk:i+1,client_id:(i+1)%2===0?id(2):null,
 display_name:'Conversation de test '+(i+1),phone_e164:null,link_state:(i+1)%2===0?'verified':'needs_review',
 message_count:200,audio_count:1,first_message_at:since,last_message_at:time}));
const archiveSummary=()=>({ok:true,version:'whatsapp_archive_summary_v2',scope:'approved_archives_only_exclusions_applied',read_at:time,
 conversations:101,linked_conversations:conversations.filter(c=>c.client_id).length,needs_review:conversations.filter(c=>!c.client_id).length,
 messages:20200,audio:101,audio_available:101,transcribed:50,first_message_at:since,last_message_at:time,
 pilots:[{authorized_at:time,hard_limit_usd:1,reserve_limit_usd:.6,reserved_usd:.531,jobs:50,pending:0,processing:0,done:50,errors:0}]});
const overview=name=>({ok:true,data:[{client_id:id(2),client_name:name,text_count:10,conversation_count:1,last_at:time,
 last_message:{chat_pk:2,message_pk:100,at:time,direction:'incoming',excerpt:'Dernier échange synthétique'}}]});
const msg=(pk,chat)=>({id:id(10000+pk),batch_id:id(1),chat_pk:chat,local_message_pk:pk,occurred_at:time,
 client_id:conversations[chat-1]?.client_id||null,is_outbound:false,display_name:'Conversation de test '+chat,
 text_body:pk===1000?'Texte original <img src=x onerror=window.__xss=true>':'Message historique '+pk,
 audio_id:pk===1000?id(5000):null,archive_status:pk===1000?'verified':null,
 transcription_status:pk===1000?'done':null,transcript_text:pk===1000?'Transcription synthétique à vérifier':null,duration_seconds:pk===1000?59.9:null});
let browser;
try{
 browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHANNEL?{channel:process.env.PLAYWRIGHT_CHANNEL}:{})});
 const page=await browser.newPage({viewport:{width:390,height:844},timezoneId:'Europe/Paris'}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{
  window.__deferPermission=false;window.__subscription=null;
  const sub={toJSON:()=>({endpoint:'https://push.example.test/synthetic',keys:{p256dh:'synthetic',auth:'synthetic'}}),unsubscribe:async()=>{window.__subscription=null;return true}};
  const reg={pushManager:{getSubscription:async()=>window.__subscription,subscribe:async()=>{window.__subscription=sub;return sub}}};
  Object.defineProperty(navigator,'serviceWorker',{value:{register:async()=>reg,ready:Promise.resolve(reg)},configurable:true});
  Object.defineProperty(window,'PushManager',{value:function(){},configurable:true});
  Object.defineProperty(window,'Notification',{value:{requestPermission:()=>window.__deferPermission?new Promise(r=>window.__resolvePermission=r):Promise.resolve('granted')},configurable:true});
 });
 await page.route('https://gcirlrghjvumhkekrtmf.supabase.co/**',async route=>{
  const req=route.request(),u=new URL(req.url());if(req.method()==='OPTIONS')return route.fulfill({status:204,headers});
  if(u.pathname==='/auth/v1/token')return route.fulfill(json({access_token:'synthetic-only',refresh_token:'synthetic-only',expires_in:3600}));
  if(u.pathname==='/functions/v1/companion-profile')return route.fulfill(json({ok:true,role:'owner'}));
  if(u.pathname==='/functions/v1/companion-api/sync-status')return route.fulfill(sourceFail?json({ok:false,error:'unavailable'},503):json({ok:true,data:sourceRows}));
  if(u.pathname==='/functions/v1/stock-monitor'){
   const action=u.searchParams.get('action');
   if(action==='push-key')return route.fulfill(json({ok:true,publicKey:'AQIDBA'}));
   if(action){pushCalls.push(action);if(action==='test'&&delayPush){delayPush=false;hold('push',route,{ok:true});return}return route.fulfill(json({ok:true}))}
   if(stockFail)return route.fulfill(json({ok:false,error:'stock_read_failed'},503));
   const response=stock(u);if(delayStock&&u.searchParams.get('company')==='TR'){delayStock=false;hold('stock',route,response);return}
   return route.fulfill(json(response));
  }
  if(u.pathname==='/functions/v1/whatsapp-client-brief'){
   if(delayOverview){delayOverview=false;hold('overview',route,overview('Ancien aperçu'));return}
   return route.fulfill(json(overview(overviewName)));
  }
  if(u.pathname==='/functions/v1/whatsapp-archives'){
   const action=u.searchParams.get('action');
   if(req.method()==='POST'){
    const b=req.postDataJSON();linkCalls.push(b);assert.equal(b.action,'link');
    const c=conversations.find(c=>c.batch_id===b.batch_id&&c.chat_pk===b.chat_pk);c.client_id=b.client_id;c.link_state='manual';return route.fulfill(json({ok:true}));
   }
   if(action==='summary')return route.fulfill(json(archiveSummary()));
   if(action==='conversations'){
    const offset=Number(u.searchParams.get('offset')||0);return route.fulfill(json({ok:true,version:'whatsapp_archive_conversations_v2',scope:'approved_archives_only_exclusions_applied',
     conversations:conversations.slice(offset,offset+100),clients:[{id:id(2),canonical_name:'Client synthétique'}],total:101,offset,limit:100,next_offset:offset+100<101?offset+100:null}));
   }
   if(action==='messages'){
    const chat=Number(u.searchParams.get('chat_pk')||2),q=u.searchParams.get('q'),cursor=u.searchParams.get('cursor');
    const messages=wrongMessages?[msg(1000,chat===1?2:1)]:q?[msg(1000,chat)]:cursor?[msg(940,chat)]:Array.from({length:60},(_,i)=>msg(1000-i,chat));
    return route.fulfill(json({ok:true,messages,next_cursor:!wrongMessages&&!q&&!cursor?JSON.stringify({at:time,pk:941}):null}));
   }
   if(action==='audio'){
    const response={ok:true,url:wrongAudio?'https://example.test/untrusted':'https://gcirlrghjvumhkekrtmf.supabase.co/storage/v1/object/sign/whatsapp-history-audio/synthetic?token=synthetic'};
    if(delayAudio){delayAudio=false;hold('audio',route,response);return}return route.fulfill(json(response));
   }
  }
  if(u.pathname==='/functions/v1/companion-tasks'&&req.method()==='POST')taskWrites++;
  if(u.pathname==='/auth/v1/logout')return route.fulfill(json({}));
  return route.fulfill(json({ok:true,data:{stats:{clients_total:0},attention_clients:[],unassigned_actionable_tasks:[]}}));
 });
 const login=async()=>{await page.locator('#login-password').fill('synthetic-only');await page.locator('#login-button').click();await page.locator('#app-panel').waitFor({state:'visible'})};
 const logout=async()=>{await page.locator('#logout-top').click();await page.locator('#login-panel').waitFor({state:'visible'})};
 const noOverflow=async()=>assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'mobile overflow');
 await page.goto(origin+'/?view=settings&build=D35');await login();await page.locator('#connection-options>summary').click();
 await page.locator('[data-source="gmail"][data-health="current"]').waitFor({state:'visible'});
 assert.equal(await page.locator('#connector-status-root [data-source]').count(),3);
 assert.equal(await page.locator('[data-source="google_chat"]').getAttribute('data-health'),'pending');
 assert.equal(await page.locator('[data-source="google_drive"]').getAttribute('data-health'),'late');
 assert.match(await page.locator('#connector-status-root').innerText(),/échanges antérieurs.*ne sont pas garantis/);
 sourceFail=true;await page.getByRole('button',{name:'Actualiser les connexions ↻'}).click();
 await page.getByText(/état actuel non confirmé/).waitFor({state:'visible'});assert.equal(await page.locator('#connector-status-root [data-source]').count(),3);
 sourceFail=false;sourceRows=sourceRows.slice(0,2);await page.getByRole('button',{name:'Actualiser les connexions ↻'}).click();
 await page.locator('[data-source="google_drive"][data-health="missing"]').waitFor({state:'visible'});await noOverflow();
 await page.locator('#view-settings .v1-tools-grid [data-nav="stocks"]').click();
 await page.locator('.stock-card').first().waitFor({state:'visible'});assert.equal(await page.locator('.stock-card').count(),50);
 assert.match(await page.locator('#stock-summary').innerText(),/catalogue complet/);
 await page.locator('#stock-next').click();await page.getByText(/51–57/).waitFor({state:'visible'});assert.equal(await page.locator('.stock-card').count(),7);
 await page.locator('#stock-company').selectOption('GTA');await page.getByText(/GTA · 2 référence/).waitFor({state:'visible'});
 stockFail=true;await page.locator('#stock-reload').click();await page.getByText(/Dernière lecture conservée pour ce filtre/).waitFor({state:'visible'});assert.equal(await page.locator('.stock-card').count(),2);
 await page.locator('#stock-company').selectOption('TR');await page.getByText(/Lecture des stocks indisponible/).waitFor({state:'visible'});assert.equal(await page.locator('.stock-card').count(),0);
 stockFail=false;await page.locator('#stock-company').selectOption('GTA');await page.getByText(/GTA · 2 référence/).waitFor({state:'visible'});
 delayStock=true;await page.locator('#stock-company').selectOption('TR');const releaseStock=await gate('stock');
 await page.locator('#stock-company').selectOption('GTA');await page.getByText(/GTA · 2 référence/).waitFor({state:'visible'});await releaseStock();
 assert.equal(await page.locator('.stock-card').count(),2);assert.ok(!(await page.locator('#stock-list').innerText()).includes('Produit TR'));
 await page.locator('#stock-search').fill('Absent');await page.getByText(/0 référence/).waitFor({state:'visible'});assert.equal(await page.locator('.stock-card').count(),0);
 await page.locator('#stock-search').fill('');await page.getByText(/GTA · 2 référence/).waitFor({state:'visible'});
 await page.evaluate(()=>window.__deferPermission=true);await page.locator('#stock-notification-options').evaluate(d=>{d.open=true});await page.locator('#stock-push-enable').click();await logout();
 await page.evaluate(()=>{window.__deferPermission=false;window.__resolvePermission('granted')});await login();
 await page.getByText(/TR et GTA · 57 référence/).waitFor({state:'visible'});assert.deepEqual(pushCalls,[]);
 await page.locator('#stock-notification-options').evaluate(d=>{d.open=true});await page.locator('#stock-push-enable').click();await page.getByText(/Notifications activées/).waitFor({state:'visible'});
 await page.locator('#stock-push-test').click();await page.getByText(/test acceptée par le service/).waitFor({state:'visible'});
 delayPush=true;await page.locator('#stock-push-test').click();const releasePush=await gate('push');await logout();await login();await releasePush();
 assert.ok(!(await page.locator('#stock-push-status').innerText()).includes('test acceptée'));
 await page.locator('#stock-push-stop').click();await page.getByText(/Notifications désactivées/).waitFor({state:'visible'});await noOverflow();
 assert.deepEqual(pushCalls,['subscribe','test','test','unsubscribe']);
 await page.locator('#bottom-nav [data-nav="settings"]').click();await page.locator('#view-settings .v1-tools-grid [data-nav="archives"]').click();
 await page.getByText(/100 \/ 101 conversations chargées/).waitFor({state:'visible'});
 assert.match(await page.locator('#archive-root').innerText(),/51 vocaux disponibles sans transcription/);
 await page.getByText(/Lot de transcription autorisé/).click();assert.match(await page.locator('#archive-root').innerText(),/50 \/ 50 terminé/);
 assert.match(await page.locator('#archive-root').innerText(),/ne correspond pas à une facture effective/);
 await page.getByRole('button',{name:'Charger les conversations suivantes'}).click();await page.getByText(/101 \/ 101 conversations chargées/).waitFor({state:'visible'});
 await page.getByLabel('Rechercher une conversation').fill('Conversation de test 101');assert.equal(await page.locator('#archive-root .client-row').count(),1);
 await page.getByLabel('Rechercher une conversation').fill('');await page.getByLabel('Rattachement',{exact:true}).selectOption('review');assert.equal(await page.locator('#archive-root .client-row').count(),51);
 await page.locator('#archive-root .client-row').first().click();await page.locator('.archive-message').first().waitFor({state:'visible'});
 assert.equal(await page.locator('.archive-message').count(),60);assert.equal(await page.locator('#archive-root img').count(),0);assert.equal(await page.evaluate(()=>window.__xss),undefined);
 assert.match(await page.locator('.archive-message').first().innerText(),/Archive #1 · message #1000/);
 assert.match(await page.locator('.archive-message').first().innerText(),/Vocal · 1 min 0 s/);
 await page.getByRole('button',{name:'Afficher les messages précédents'}).click();await page.getByText('Message historique 940',{exact:true}).waitFor({state:'visible'});assert.equal(await page.locator('.archive-message').count(),61);
 await page.getByLabel('Rechercher dans les échanges').fill('Texte original');await page.getByRole('button',{name:'Rechercher',exact:true}).click();
 await page.getByText('Transcription synthétique à vérifier',{exact:true}).waitFor({state:'visible'});assert.equal(await page.locator('.archive-message').count(),1);
 wrongAudio=true;await page.getByRole('button',{name:'Écouter le vocal original'}).click();await page.getByText('Le vocal ne peut pas être ouvert. Réessayez.').waitFor({state:'visible'});assert.equal(await page.locator('audio').count(),0);
 wrongAudio=false;delayAudio=true;await page.getByRole('button',{name:'Écouter le vocal original'}).click();const releaseAudio=await gate('audio');await logout();await login();await releaseAudio();
 await page.getByText(/100 \/ 101 conversations chargées/).waitFor({state:'visible'});assert.equal(await page.locator('audio').count(),0);
 delayOverview=true;await page.getByRole('button',{name:'Actualiser les archives'}).click();const releaseOverview=await gate('overview');
 await logout();overviewName='Nouvel aperçu';await login();await releaseOverview();
 const overviewPanel=page.locator('.wa-brief-overview');await overviewPanel.locator('summary').click();await page.getByText('Nouvel aperçu',{exact:true}).waitFor({state:'visible'});
 assert.ok(!(await overviewPanel.innerText()).includes('Ancien aperçu'));
 wrongMessages=true;await page.locator('#archive-root .client-row').first().click();await page.getByText(/Impossible de charger ces échanges/).waitFor({state:'visible'});assert.equal(await page.locator('.archive-message').count(),0);
 wrongMessages=false;await page.getByRole('button',{name:'Réessayer',exact:true}).click();await page.locator('.archive-message').first().waitFor({state:'visible'});
 assert.equal(linkCalls.length,0);await page.getByLabel('Fiche client à rattacher').selectOption(id(2));await page.getByRole('button',{name:'Rattacher cette conversation'}).click();await page.getByText('Conversation rattachée.',{exact:true}).waitFor({state:'visible'});
 assert.equal(linkCalls.length,1);assert.equal(linkCalls[0].chat_pk,1);assert.equal(linkCalls[0].client_id,id(2));assert.equal(taskWrites,0);await noOverflow();
 await logout();assert.equal(await page.locator('.archive-message').count(),0);assert.equal(await page.locator('#archive-root').innerText(),'');
 assert.equal(errors.length,0,errors.join('\n'));
 console.log('D35 mobile passed: Google coverage and stale states; scoped stock pagination, failures and late responses; push logout guards; approved archive pages, pilot budget, original provenance, search, manual link and stale audio/overview guards.');
}finally{await browser?.close();await new Promise(r=>server.close(r))}
