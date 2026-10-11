import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,join,extname,sep} from 'node:path';
import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=resolve('validation-v12'),mime={'.html':'text/html','.mjs':'text/javascript','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml'};
const server=createServer(async(req,res)=>{try{const u=new URL(req.url,'http://localhost'),path=u.pathname==='/'?join(root,'index.html'):resolve(root,'.'+decodeURIComponent(u.pathname));if(path!==root&&!path.startsWith(root+sep))return res.writeHead(403).end();res.writeHead(200,{'content-type':mime[extname(path)]||'text/plain'}).end(await readFile(path))}catch{res.writeHead(404).end()}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const origin='http://127.0.0.1:'+server.address().port;
const client='10000000-1111-4111-8111-000000000003';
let tasks=[],operations=new Map(),posts=[],loseResponse=false,failList=false,version=1;
const now=()=>new Date(Date.UTC(2026,9,11,8,0,version++)).toISOString();
const headers={'access-control-allow-origin':'*','access-control-allow-headers':'authorization,apikey,content-type,x-client-info','access-control-allow-methods':'GET,POST,OPTIONS'};
const json=data=>({status:200,contentType:'application/json',headers,body:JSON.stringify(data)});
let browser;
try{
 browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHANNEL?{channel:process.env.PLAYWRIGHT_CHANNEL}:{})});
 const page=await browser.newPage({viewport:{width:390,height:844},timezoneId:'Europe/Paris'}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('https://gcirlrghjvumhkekrtmf.supabase.co/**',async route=>{
  const req=route.request(),u=new URL(req.url());if(req.method()==='OPTIONS')return route.fulfill({status:204,headers});
  if(u.pathname==='/auth/v1/token')return route.fulfill(json({access_token:'synthetic-only',refresh_token:'synthetic-only',expires_in:3600}));
  if(u.pathname==='/functions/v1/companion-profile')return route.fulfill(json({ok:true,role:'owner'}));
  if(u.pathname==='/functions/v1/companion-api/clients')return route.fulfill(json({ok:true,data:[{client_id:client,canonical_name:'Boutique de test'}]}));
  if(u.pathname==='/functions/v1/companion-tasks'){
   if(req.method()==='GET'){
    if(failList)return route.fulfill(json({ok:false,error:'tasks_unavailable'}));
    const status=u.searchParams.get('status'),rows=tasks.filter(t=>t.status!=='SUPERSEDED'&&(status==='ALL'||t.status===status));
    return route.fulfill(json({ok:true,data:{tasks:rows,total:rows.length,checked_at:now()}}));
   }
   const b=req.postDataJSON();posts.push(b);
   if(operations.has(b.request_id))return route.fulfill(json(operations.get(b.request_id)));
   let t=tasks.find(t=>t.id===b.task_id);
   if(b.action!=='create'&&b.expected_version!==t.updated_at)return route.fulfill(json({ok:false,error:'task_conflict'}));
   if(b.action==='create'){t={id:'10000000-1111-4111-8111-00000000000'+(tasks.length+4),status:'OPEN',is_suggested:false,...b.payload,client_name:b.payload.client_id?'Boutique de test':null};tasks.push(t)}
   if(b.action==='edit')Object.assign(t,b.payload);
   if(b.action==='complete')t.status='DONE';
   if(b.action==='cancel')t.status='CANCELLED';
   if(b.action==='approve')t.is_suggested=false;
   if(b.action==='merge')t.status='SUPERSEDED';
   t.updated_at=now();t.reminder_sync_status='PENDING';
   const response={ok:true,duplicate:false,task_id:t.id,updated_at:t.updated_at};operations.set(b.request_id,response);
   if(loseResponse){loseResponse=false;return route.abort('failed')}
   return route.fulfill(json(response));
  }
  if(u.pathname==='/auth/v1/logout')return route.fulfill(json({}));
  return route.fulfill(json({ok:true,data:{stats:{clients_total:0},attention_clients:[],unassigned_actionable_tasks:[]}}));
 });
 await page.goto(origin+'/?view=tasks&build=D24');
 await page.locator('#login-password').fill('synthetic-only');await page.locator('#login-button').click();
 await page.locator('#view-tasks').waitFor({state:'visible'});
 await page.getByRole('button',{name:'Nouvelle tâche',exact:true}).click();
 await page.getByLabel('Action à réaliser').fill('Relancer la boutique de test');
 await page.getByLabel('Contexte',{exact:true}).fill('Envoyer le devis demandé');
 await page.getByLabel('Échéance (heure locale)').fill('2026-10-12T10:00');
 await page.getByLabel('Chercher un client (facultatif)').fill('Boutique');
 await page.getByText('1 résultat(s). Sélectionne le client souhaité.').waitFor({state:'visible'});
 await page.getByLabel('Client',{exact:true}).selectOption(client);
 loseResponse=true;
 await page.getByRole('button',{name:'Enregistrer',exact:true}).click();
 await page.getByRole('button',{name:'Réessayer le même enregistrement'}).waitFor({state:'visible'});
 assert.equal(tasks.length,1);await page.getByRole('button',{name:'Réessayer le même enregistrement'}).click();
 await page.locator('.task-card').waitFor({state:'visible'});
 assert.equal(tasks.length,1);assert.equal(posts[0].request_id,posts[1].request_id);
 assert.equal(posts[0].payload.due_at,'2026-10-12T08:00:00.000Z');
 assert.match(await page.locator('#tasks-root').innerText(),/Rappels : en attente du Mac/);
 await page.getByRole('button',{name:'Modifier / reporter'}).click();
 await page.getByLabel('Échéance (heure locale)').fill('2026-10-13T10:00');
 await page.getByRole('button',{name:'Enregistrer',exact:true}).click();
 await page.getByText(/13\/10\/2026/).waitFor({state:'visible'});
 assert.equal(tasks[0].due_at,'2026-10-13T08:00:00.000Z');
 failList=true;await page.getByRole('button',{name:'Actualiser ↻',exact:true}).click();
 await page.getByText(/Dernière lecture conservée/).waitFor({state:'visible'});assert.equal(await page.locator('.task-card').count(),1);
 failList=false;await page.getByRole('button',{name:'Actualiser ↻',exact:true}).click();
 await page.getByRole('button',{name:'Terminer',exact:true}).click();
 await page.getByText('Aucune tâche pour ce filtre.').waitFor({state:'visible'});
 await page.getByLabel('Statut des tâches').selectOption('DONE');
 await page.locator('.task-card').waitFor({state:'visible'});assert.match(await page.locator('.task-card').innerText(),/Terminée/);
 assert.equal(await page.getByRole('button',{name:'Terminer',exact:true}).count(),0);
 await page.locator('#logout-top').click();await page.locator('#login-panel').waitFor({state:'visible'});
 assert.equal(await page.locator('.task-card').count(),0);assert.equal(errors.length,0,errors.join('\n'));
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'mobile overflow');
 console.log('D24 mobile tasks passed: creation, client, local time, lost-response retry, deferral, stale display, completion and logout');
}finally{await browser?.close();await new Promise(r=>server.close(r))}
