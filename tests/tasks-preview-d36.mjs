import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,join,extname,sep} from 'node:path';
import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=resolve('validation-v12'),mime={'.html':'text/html','.mjs':'text/javascript','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml'};
const server=createServer(async(req,res)=>{try{const u=new URL(req.url,'http://localhost'),path=u.pathname==='/'?join(root,'index.html'):resolve(root,'.'+decodeURIComponent(u.pathname));if(path!==root&&!path.startsWith(root+sep))return res.writeHead(403).end();res.writeHead(200,{'content-type':mime[extname(path)]||'text/plain'}).end(await readFile(path))}catch{res.writeHead(404).end()}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const origin='http://127.0.0.1:'+server.address().port,id=n=>'10000000-1111-4111-8111-'+String(n).padStart(12,'0'),time=new Date().toISOString();
const headers={'access-control-allow-origin':'*','access-control-allow-headers':'authorization,apikey,content-type,x-client-info','access-control-allow-methods':'GET,POST,OPTIONS'};
const json=(body,status=200)=>({status,contentType:'application/json',headers,body:JSON.stringify(body)});
const clients=[{client_id:id(300),canonical_name:'Client Alpha'},{client_id:id(301),canonical_name:'Client Beta'}];
const make=(n,client_id,status='OPEN')=>({id:id(n),client_id,client_name:clients.find(c=>c.client_id===client_id)?.canonical_name||null,
 title:'Action de test '+n,description:'Contexte synthétique',due_at:null,status,is_suggested:false,updated_at:time,
 reminder_sync_status:'SYNCED',reminder_action:status==='DONE'?'DELETE':'UPSERT',reminder_synced_at:time});
let tasks=[make(1,id(300)),make(2,id(300)),make(3,id(300)),make(4,id(301)),make(5,id(301),'DONE')],posts=[],listReads=[],clientReads=[],operations=new Map();
let failDone=false,delayRead=false,delayWrite='',badAck=false,wrongClient=false,version=0;
const gates=new Map(),hold=(name,route,response)=>gates.set(name,()=>route.fulfill(json(response)));
async function gate(name){for(let i=0;i<100&&!gates.has(name);i++)await new Promise(r=>setTimeout(r,20));assert.ok(gates.has(name),'missing gate '+name);return async()=>{const fn=gates.get(name);gates.delete(name);await fn()}}
let browser;
try{
 browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHANNEL?{channel:process.env.PLAYWRIGHT_CHANNEL}:{})});
 const page=await browser.newPage({viewport:{width:390,height:844},timezoneId:'Europe/Paris'}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('https://gcirlrghjvumhkekrtmf.supabase.co/**',async route=>{
  const req=route.request(),u=new URL(req.url());if(req.method()==='OPTIONS')return route.fulfill({status:204,headers});
  if(u.pathname==='/auth/v1/token')return route.fulfill(json({access_token:'synthetic-only',refresh_token:'synthetic-only',expires_in:3600}));
  if(u.pathname==='/functions/v1/companion-profile')return route.fulfill(json({ok:true,role:'owner'}));
  if(u.pathname==='/functions/v1/companion-api/clients')return route.fulfill(json({ok:true,data:clients}));
  const card=u.pathname.match(/^\/functions\/v1\/companion-api\/clients\/([^/]+)\/card$/);
  if(card){
   const client=clients.find(c=>c.client_id===card[1]);clientReads.push(card[1]);
   const open=tasks.filter(t=>t.client_id===card[1]&&t.status==='OPEN');
   return route.fulfill(json({ok:true,data:{profile:{id:client.client_id,name:client.canonical_name},contacts:[],memory:{summary:''},
    attention:{open_task_count:open.length,tasks:open.map(t=>({title:t.title,description:t.description,due_at:t.due_at}))},activity:{recent:[]}}}));
  }
  if(u.pathname.startsWith('/functions/v1/companion-api/clients/'))return route.fulfill(json({ok:false,error:'detail_unavailable'},503));
  if(u.pathname==='/functions/v1/companion-tasks'){
   if(req.method()==='GET'){
    const status=u.searchParams.get('status'),client=u.searchParams.get('client_id'),q=(u.searchParams.get('q')||'').toLowerCase(),offset=Number(u.searchParams.get('offset')||0);
    listReads.push({status,client,q,offset});if(failDone&&status==='DONE')return route.fulfill(json({ok:false,error:'tasks_unavailable'},503));
    const rows=tasks.filter(t=>(status==='ALL'||t.status===status)&&(!client||t.client_id===client)&&(!q||(t.title+' '+(t.client_name||'')).toLowerCase().includes(q)));
    const output=rows.slice(offset,offset+200).map(t=>({...t}));
    if(wrongClient&&client&&output.length)output[0]={...tasks.find(t=>t.client_id!==client&&t.status===status)};
    const response={ok:true,data:{tasks:output,total:rows.length,limit:200,checked_at:new Date().toISOString()}};
    if(delayRead){delayRead=false;hold('read',route,response);return}return route.fulfill(json(response));
   }
   const body=req.postDataJSON();posts.push(body);
   if(operations.has(body.request_id))return route.fulfill(json(operations.get(body.request_id)));
   let task=tasks.find(t=>t.id===body.task_id);
   if(body.action!=='create'&&task.updated_at!==body.expected_version)return route.fulfill(json({ok:false,error:'task_conflict'},409));
   if(body.action==='create'){task={...make(100+version,body.payload.client_id),...body.payload};tasks.unshift(task)}
   if(body.action==='complete')task.status='DONE';
   task.updated_at=new Date(Date.parse(time)+1000*(++version)).toISOString();task.reminder_sync_status='PENDING';
   const response={ok:true,task_id:task.id,updated_at:task.updated_at,duplicate:false};operations.set(body.request_id,response);
   if(delayWrite){const name=delayWrite;delayWrite='';hold(name,route,response);return}
   if(badAck){badAck=false;return route.fulfill(json({...response,task_id:id(999)}))}
   return route.fulfill(json(response));
  }
  if(u.pathname==='/auth/v1/logout')return route.fulfill(json({}));
  return route.fulfill(json({ok:true,data:{stats:{clients_total:2},attention_clients:[],unassigned_actionable_tasks:[]}}));
 });
 const login=async()=>{await page.locator('#login-password').fill('synthetic-only');await page.locator('#login-button').click();await page.locator('#app-panel').waitFor({state:'visible'})};
 const logout=async()=>{await page.locator('#logout-top').click();await page.locator('#login-panel').waitFor({state:'visible'})};
 const ready=async()=>{await page.locator('#tasks-root .task-card').first().waitFor({state:'visible'});await page.locator('[data-task-reload]:not([disabled])').waitFor({state:'visible'})};
 await page.goto(origin+'/?view=clients&build=D36');await login();await page.locator('#clients-list .client-row').first().click();
 await page.getByRole('button',{name:'Gérer les tâches de ce client'}).click();await ready();
 assert.match(await page.locator('#tasks-root').innerText(),/Tâches du client : Client Alpha/);assert.equal(await page.locator('#tasks-root .task-card').count(),3);
 assert.equal(listReads.at(-1).client,id(300));assert.match(await page.locator('#tasks-root').innerText(),/Rappels : synchronisé le/);
 await page.getByRole('button',{name:'Nouvelle tâche',exact:true}).click();assert.equal(await page.getByLabel('Client',{exact:true}).inputValue(),id(300));
 await page.getByLabel('Action à réaliser').fill('Action créée depuis la fiche');await page.getByRole('button',{name:'Enregistrer',exact:true}).click();
 await page.getByText('Action créée depuis la fiche',{exact:true}).waitFor({state:'visible'});assert.equal(posts[0].payload.client_id,id(300));
 await page.locator('#bottom-nav [data-nav="clients"]').click();await page.locator('#client-detail').getByText('Action créée depuis la fiche',{exact:true}).first().waitFor({state:'visible'});
 assert.ok(clientReads.filter(x=>x===id(300)).length>=2,'client card was not refreshed');
 await page.getByRole('button',{name:'Gérer les tâches de ce client'}).click();await ready();
 await page.getByRole('button',{name:'Voir les tâches de tous les clients'}).click();await ready();assert.equal(listReads.at(-1).client,null);
 failDone=true;await page.getByLabel('Statut des tâches').selectOption('DONE');await page.getByText('Le service des tâches ne répond pas. Réessaie.').waitFor({state:'visible'});
 assert.equal(await page.locator('#tasks-root .task-card').count(),0);assert.equal(await page.getByRole('button',{name:'Terminer',exact:true}).count(),0);
 failDone=false;await page.getByLabel('Statut des tâches').selectOption('OPEN');await ready();
 delayRead=true;await page.locator('[data-task-reload]').click();const releaseRead=await gate('read');
 await page.getByLabel('Rechercher une tâche').fill('Absent');await page.getByText('Aucune tâche pour ce filtre.',{exact:true}).waitFor({state:'visible'});await releaseRead();
 await page.locator('[data-task-reload]:not([disabled])').waitFor({state:'visible'});assert.equal(await page.locator('#tasks-root .task-card').count(),0);
 await page.getByLabel('Rechercher une tâche').fill('');await ready();
 delayWrite='old';await page.getByRole('button',{name:'Terminer',exact:true}).first().click();const releaseOld=await gate('old');await logout();await login();await ready();
 delayWrite='current';await page.getByRole('button',{name:'Terminer',exact:true}).first().click();const releaseCurrent=await gate('current');await releaseOld();
 assert.equal(await page.getByRole('button',{name:'Réessayer le même enregistrement'}).count(),0,'old finally cleared the new operation');
 assert.equal(await page.locator('[data-task-new]').isDisabled(),true);await releaseCurrent();await ready();
 badAck=true;await page.getByRole('button',{name:'Terminer',exact:true}).first().click();await page.getByRole('button',{name:'Réessayer le même enregistrement'}).waitFor({state:'visible'});
 const uncertain=posts.at(-1),before=operations.size;await page.getByRole('button',{name:'Réessayer le même enregistrement'}).click();await ready();
 assert.equal(posts.at(-1).request_id,uncertain.request_id);assert.equal(operations.size,before);
 const readsBefore=listReads.length;await page.getByLabel('Rechercher une tâche').fill('Alpha');await logout();await page.waitForTimeout(400);assert.equal(listReads.length,readsBefore);
 await login();await ready();assert.equal(await page.getByLabel('Rechercher une tâche').inputValue(),'');assert.equal(await page.getByLabel('Statut des tâches').inputValue(),'OPEN');
 await page.locator('#bottom-nav [data-nav="clients"]').click();await page.locator('#clients-list .client-row').first().click();
 wrongClient=true;await page.getByRole('button',{name:'Gérer les tâches de ce client'}).click();await page.getByText('Le service des tâches ne répond pas. Réessaie.').waitFor({state:'visible'});
 assert.equal(await page.locator('#tasks-root .task-card').count(),0);wrongClient=false;await page.locator('[data-task-reload]').click();await ready();
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'mobile overflow');
 await logout();assert.equal(await page.locator('#tasks-root .task-card').count(),0);assert.equal(errors.length,0,errors.join('\n'));
 console.log('D36 mobile passed: exact client task scope, preselected creation, refreshed CRM card, cleared filters on failures, late-read guards, two-session mutation isolation and identical-request retry after an invalid acknowledgement.');
}finally{await browser?.close();await new Promise(r=>server.close(r))}
