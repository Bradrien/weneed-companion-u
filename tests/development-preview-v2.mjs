import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import assert from 'node:assert/strict';
const {chromium}=await import('playwright');
const root=resolve('validation-v12'),mime={'.html':'text/html','.mjs':'text/javascript','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml'};
const server=createServer(async(req,res)=>{try{const path=new URL(req.url,'http://localhost').pathname,file=path==='/'?resolve(root,'index.html'):resolve(root,'.'+decodeURIComponent(path));
 if(!file.startsWith(root+sep))return res.writeHead(403).end();res.writeHead(200,{'content-type':mime[extname(file)]||'application/octet-stream'}).end(await readFile(file));}catch{res.writeHead(404).end()}});
await new Promise(ok=>server.listen(0,'127.0.0.1',ok));const origin='http://127.0.0.1:'+server.address().port;
const id='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222',sampleId='33333333-3333-4333-8333-333333333333';
const stamp=new Date().toISOString(),oldDate=new Date(Date.now()-120*86400000).toISOString().slice(0,10),clients=[{client_id:id,canonical_name:'Client Démo',status:'active'},{client_id:other,canonical_name:'Autre client',status:'active'}];
const portfolio={version:'strategy_verified_v1',checked_at:stamp,clients:clients.map(c=>({id:c.client_id,canonical_name:c.canonical_name,status:'active'})),
 verified_links:[{client_id:id,partner_odoo_id:1}],whatsapp:[],memories:[],odoo:{available:true,orders:[{odoo_id:1,reference:'SYNTHETIC',date:oldDate,state:'sale',partner_id:1,company:'TR',amount_ht:500,currency:'EUR'},{odoo_id:2,reference:'NATIVE-2',date:oldDate,state:'sale',partner_id:2,partner_name:'Autre client',company:'GTA',amount_ht:200,currency:'EUR'}]}};
const headers={'access-control-allow-origin':'*','access-control-allow-headers':'authorization,apikey,content-type,x-client-info','access-control-allow-methods':'GET,POST,OPTIONS'};
const json=(body,status=200)=>({status,contentType:'application/json',headers,body:JSON.stringify(body)});
const base={status:'PLANNED',products:'Produit autre client',goal:'',notes:'',tracking:'',follow_up_at:null,sent_at:null,received_at:null,created_at:stamp,updated_at:stamp};
let rows=[{...base,id:'44444444-4444-4444-8444-444444444444',client_id:other,client_name:'Autre client'}],posts=[],taskPosts=[],operations=new Map(),lost=true,delayRead=false,releaseRead,heldRead,signalHeld,finishHeld,heldReady=new Promise(ok=>signalHeld=ok),heldFinished=new Promise(ok=>finishHeld=ok),errors=[],browser,page;
try{
 browser=await chromium.launch({headless:true});page=await browser.newPage({viewport:{width:390,height:844},timezoneId:'Europe/Paris',locale:'fr-FR'});page.on('pageerror',e=>errors.push(e.message));
 await page.route('https://gcirlrghjvumhkekrtmf.supabase.co/**',async route=>{
  const req=route.request(),u=new URL(req.url()),p=u.pathname;let wasHeld=false;if(req.method()==='OPTIONS')return route.fulfill({status:204,headers});let body;
  if(p==='/auth/v1/token')body={access_token:'synthetic-only',refresh_token:'synthetic-only',expires_in:3600};
  else if(p==='/functions/v1/companion-profile')body={ok:true,role:'owner'};
  else if(p==='/functions/v1/strategy-portfolio')body={ok:true,data:portfolio};
  else if(p==='/functions/v1/companion-api/clients')body={ok:true,data:clients};
  else if(p==='/functions/v1/companion-api/clients/'+id+'/card')body={ok:true,data:{profile:{id,name:'Client Démo',status:'active'},contacts:[],memory:{},attention:{tasks:[],open_task_count:0},activity:{recent:[]}}};
  else if(p==='/functions/v1/companion-samples'){
   if(req.method()==='POST'){
    const b=req.postDataJSON();posts.push(b);if(operations.has(b.request_id))body=operations.get(b.request_id);
    else{const time=new Date(Date.now()+posts.length*1000).toISOString();
     if(b.action==='create')rows.push({...base,id:sampleId,client_id:b.payload.client_id,client_name:'Client Démo',...b.payload,created_at:time,updated_at:time});
     else{const row=rows.find(x=>x.id===b.sample_id);assert.ok(row);assert.equal(b.expected_version,row.updated_at);Object.assign(row,b.action==='move'?{status:b.payload.status,...(b.payload.status==='SENT'?{sent_at:time}:{})}:b.payload,{updated_at:time});}
     body={ok:true,sample_id:b.sample_id||sampleId,updated_at:time};operations.set(b.request_id,body);
     if(lost){lost=false;return route.fulfill(json({ok:false,error:'samples_unavailable'},503))}
    }
   }else{
    const status=u.searchParams.get('status')||'ACTIVE',cid=u.searchParams.get('client_id'),offset=Number(u.searchParams.get('offset')||0),q=u.searchParams.get('q')||'';
    const scoped=rows.filter(x=>(!cid||x.client_id===cid)&&(!q||(x.client_name+' '+x.products).includes(q)));
    const active=x=>['PLANNED','SENT','RECEIVED','FEEDBACK'].includes(x.status),overdue=x=>active(x)&&x.follow_up_at&&Date.parse(x.follow_up_at)<=Date.now();
    const selected=scoped.filter(x=>status==='ALL'||status===x.status||status==='ACTIVE'&&active(x)||status==='OVERDUE'&&overdue(x));
    body={ok:true,data:{version:'client_samples_v1',scope:'owner_recorded_samples',offset,limit:50,total:selected.length,checked_at:new Date().toISOString(),
     counts:{active:scoped.filter(active).length,overdue:scoped.filter(overdue).length,won:scoped.filter(x=>x.status==='WON').length},samples:selected.slice(offset,offset+50).map(x=>({...x}))}};
    if(delayRead){delayRead=false;heldRead=true;wasHeld=true;signalHeld();await new Promise(ok=>releaseRead=ok)}
   }
  }else if(p==='/functions/v1/companion-tasks'){
   if(req.method()==='POST')taskPosts.push(req.postDataJSON());body={ok:true,data:{tasks:[],total:0,limit:200,checked_at:stamp}};
  }else if(p==='/auth/v1/logout')body={};
  else return route.fulfill(json({ok:false,error:'unavailable'},503));
  await route.fulfill(json(body));if(wasHeld)finishHeld();
 });
 const login=async()=>{await page.locator('#login-password').fill('synthetic-only');await page.locator('#login-button').click();await page.locator('#app-panel').waitFor({state:'visible'})};
 const overflow=async()=>assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'development horizontal overflow');
 await page.goto(origin+'/?view=strategy');await login();await page.locator('.strategy-client').first().waitFor({state:'visible'});
 await page.getByLabel('Filtrer le développement client').selectOption('reactivate');assert.equal(await page.locator('.strategy-client').count(),1);assert.match(await page.locator('.strategy-client').innerText(),/Client Démo/);
 assert.equal(await page.locator('#native-reactivation-list .native-client').count(),1);assert.match(await page.locator('#native-reactivation-list a').getAttribute('href'),/id=2&model=sale.order/);
 await page.locator('.strategy-client').click();await page.locator('.strategy-detail').getByRole('button',{name:'Préparer des échantillons',exact:true}).click();
 await page.getByLabel('Produits et quantités').waitFor({state:'visible'});assert.equal(await page.getByLabel('Client des échantillons',{exact:true}).inputValue(),id);assert.equal(posts.length,0);
 await page.getByLabel('Produits et quantités').fill('Indoor Démo · 2 × 5 g');
 for(const width of [320,390,768,1440]){await page.setViewportSize({width,height:844});await overflow()}await page.setViewportSize({width:390,height:844});
 await mkdir('artifacts-v2',{recursive:true});await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:'artifacts-v2/sample-draft-mobile.png',fullPage:true});
 await page.locator('.sample-editor-options>summary').click();await page.getByLabel('Notes et retour client').fill('<img src=x onerror=alert(1)>');
 await page.getByRole('button',{name:'Enregistrer les échantillons',exact:true}).click();await page.getByRole('button',{name:'Réessayer le même dossier'}).waitFor({state:'visible'});
 assert.equal(rows.filter(x=>x.client_id===id).length,1);await page.getByRole('button',{name:'Réessayer le même dossier'}).click();await page.locator('#sample-root .sample-card').waitFor({state:'visible'});
 assert.equal(posts.length,2);assert.deepEqual(posts[0],posts[1]);assert.equal(await page.locator('#sample-root .sample-card').count(),1);assert.equal(await page.locator('#sample-root img').count(),0);
 await page.getByRole('button',{name:'Marquer envoyé',exact:true}).click();await page.locator('.sample-status').getByText('Envoyé',{exact:true}).waitFor({state:'visible'});
 await page.locator('.sample-detail>summary').click();assert.match(await page.locator('.sample-detail').innerText(),/<img src=x onerror=alert\(1\)>/);await overflow();
 await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:'artifacts-v2/samples-mobile.png',fullPage:true});
 await page.getByRole('button',{name:'Préparer la relance',exact:true}).click();await page.getByLabel('Action à réaliser').waitFor({state:'visible'});
 assert.equal(await page.getByLabel('Client',{exact:true}).inputValue(),id);assert.equal(taskPosts.length,0);await page.getByRole('button',{name:'Fermer',exact:true}).click();
 await page.locator('#bottom-nav [data-nav="clients"]').click();await page.locator('#clients-list .client-row').first().click();
 await page.getByRole('button',{name:'Suivre les échantillons',exact:true}).click();await page.locator('#sample-root .sample-card').waitFor({state:'visible'});assert.equal(await page.locator('#sample-root .sample-card').count(),1);assert.match(await page.locator('#sample-root .sample-card').innerText(),/Indoor Démo/);
 await page.getByRole('button',{name:'Tous les clients',exact:true}).click();await page.locator('#sample-root .sample-card').nth(1).waitFor({state:'visible'});
 delayRead=true;await page.locator('#sample-root').getByRole('button',{name:'Actualiser',exact:true}).click();await heldReady;assert.ok(heldRead);
 await page.locator('#logout-top').click();await page.locator('#login-panel').waitFor({state:'visible'});assert.equal(await page.locator('#sample-root').innerText(),'');
 rows[0].products='Nouvelle session';await login();await page.locator('[data-development="samples"]').click();await page.getByText('Nouvelle session',{exact:true}).waitFor({state:'visible'});releaseRead();await heldFinished;await page.evaluate(()=>new Promise(ok=>requestAnimationFrame(()=>requestAnimationFrame(ok))));
 await page.getByText('Nouvelle session',{exact:true}).waitFor({state:'visible'});assert.equal(errors.length,0,errors.join('\n'));
 console.log('Development V2 passed: verified reactivation, exact client sample draft, 320–1440px layouts, literal notes, identical lost-response retry, explicit sent status, unsaved follow-up task, client scope, logout clearing and late-session isolation.');
}catch(error){if(page){await mkdir('artifacts-v2',{recursive:true});await page.screenshot({path:'artifacts-v2/failure.png',fullPage:true});console.log('Development failure',JSON.stringify({errors,visible:(await page.locator('#app-panel').innerText()).slice(0,1800),posts:posts.length}))}throw error}
finally{releaseRead?.();await browser?.close();await new Promise(ok=>server.close(ok))}
