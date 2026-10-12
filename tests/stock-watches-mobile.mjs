import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
const root=resolve('validation-v12'),mime={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.svg':'image/svg+xml'};
const server=createServer(async(req,res)=>{try{const p=new URL(req.url,'http://localhost').pathname,file=p==='/'?resolve(root,'index.html'):resolve(root,'.'+decodeURIComponent(p));
 if(!file.startsWith(root+sep))return res.writeHead(403).end();res.writeHead(200,{'content-type':mime[extname(file)]||'application/octet-stream'}).end(await readFile(file));}catch{res.writeHead(404).end()}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const time=new Date().toISOString(),headers={'access-control-allow-origin':'*','access-control-allow-headers':'authorization,apikey,content-type','access-control-allow-methods':'GET,POST,OPTIONS'},
 json=(body,status=200)=>({status,headers,contentType:'application/json',body:JSON.stringify(body)});
const watches=new Map(),writes=[],subscriptions=[];let fail=false,delay=false,held=null,notifyAll=true,active=false,browser;
const products=['TR','GTA'].map(company=>({company,product_id:7,sku:'TRIM/'+company,product_name:'Trim '+company+'-500g',unit:'Units',quantity_basis:'free_qty',available_quantity:0,on_hand_quantity:0,forecast_quantity:0,checked_at:time}));
try{
 browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:390,height:844},locale:'fr-FR',timezoneId:'Europe/Paris'}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{
  window.__permission='granted';window.__subscription=null;
  const sub={toJSON:()=>({endpoint:'https://web.push.apple.com/synthetic',keys:{p256dh:'a'.repeat(87),auth:'b'.repeat(22)}}),unsubscribe:async()=>{window.__subscription=null;return true}};
  const reg={pushManager:{getSubscription:async()=>window.__subscription,subscribe:async()=>{window.__subscription=sub;return sub}}};
  Object.defineProperty(navigator,'serviceWorker',{value:{register:async()=>reg,ready:Promise.resolve(reg)},configurable:true});
  Object.defineProperty(window,'PushManager',{value:function(){},configurable:true});
  Object.defineProperty(window,'Notification',{value:{requestPermission:()=>Promise.resolve(window.__permission)},configurable:true});
 });
 await page.route('https://gcirlrghjvumhkekrtmf.supabase.co/**',async route=>{
  const req=route.request(),u=new URL(req.url());if(req.method()==='OPTIONS')return route.fulfill({status:204,headers});
  if(u.pathname==='/auth/v1/token')return route.fulfill(json({access_token:'synthetic-only',refresh_token:'synthetic-only',expires_in:3600}));
  if(u.pathname==='/functions/v1/companion-profile')return route.fulfill(json({ok:true,role:'owner'}));
  if(u.pathname==='/functions/v1/stock-monitor'){
   const action=u.searchParams.get('action');
   if(action==='push-key')return route.fulfill(json({ok:true,publicKey:'AQIDBA'}));
   if(action==='push-status')return route.fulfill(json({ok:true,data:{active,notify_all:notifyAll}}));
   if(action==='subscribe'){const b=req.postDataJSON();subscriptions.push(b);notifyAll=b.notify_all;active=true;return route.fulfill(json({ok:true}))}
   if(action==='watch'){const b=req.postDataJSON();writes.push(b);if(fail)return route.fulfill(json({ok:false,error:'watch_update_failed'},503));
    watches.set(b.company+':'+b.product_id,b.watching);if(delay){delay=false;held=()=>route.fulfill(json({ok:true,data:b}));return}return route.fulfill(json({ok:true,data:b}));}
   if(action==='test')return route.fulfill(json({ok:true}));
   const company=u.searchParams.get('company')||'ALL',q=(u.searchParams.get('q')||'').toLowerCase(),items=products.filter(p=>(company==='ALL'||p.company===company)&&(!q||(p.sku+' '+p.product_name).toLowerCase().includes(q)))
    .map(p=>({...p,watching:watches.get(p.company+':'+p.product_id)===true}));
   return route.fulfill(json({ok:true,data:{checked_at:time,stale:false,last_error:null,scan_interval_minutes:5,total:items.length,
    summary:[{company:'TR',products:1,out_of_stock:1},{company:'GTA',products:1,out_of_stock:1}],items,alerts:[]}}));
  }
  return route.fulfill(json({ok:true,data:{stats:{clients_total:0},attention_clients:[],unassigned_actionable_tasks:[]}}));
 });
 const login=async()=>{await page.locator('#login-password').fill('synthetic-only');await page.locator('#login-button').click();await page.locator('#app-panel').waitFor({state:'visible'})};
 const logout=async()=>{await page.locator('#logout-top').click();await page.locator('#login-panel').waitFor({state:'visible'})};
 await page.goto('http://127.0.0.1:'+server.address().port+'/?view=stocks');await login();
 await page.locator('#stock-company').selectOption('TR');await page.locator('#stock-search').fill('Trim');
 const tr=()=>page.locator('.stock-card[data-product="TR:7"]');await tr().waitFor();await tr().locator('summary').click();
 await tr().getByRole('button',{name:'M’avertir du retour en stock'}).click();await tr().getByText(/Alerte activée pour cette référence/).waitFor();
 assert.deepEqual(writes[0],{company:'TR',product_id:7,watching:true});assert.equal(subscriptions[0].notify_all,false);
 await page.locator('#stock-reload').click();await tr().getByRole('button',{name:'Désactiver cette alerte'}).waitFor();
 await page.locator('#stock-company').selectOption('GTA');const gta=page.locator('.stock-card[data-product="GTA:7"]');await gta.waitFor();await gta.locator('summary').click();
 await gta.getByRole('button',{name:'M’avertir du retour en stock'}).waitFor();assert.equal(watches.get('GTA:7'),undefined);
 await page.locator('#stock-company').selectOption('TR');await tr().getByRole('button',{name:'Désactiver cette alerte'}).click();await tr().getByText(/Alerte désactivée/).waitFor();
 assert.deepEqual(writes[1],{company:'TR',product_id:7,watching:false});
 fail=true;await tr().getByRole('button',{name:'M’avertir du retour en stock'}).click();await tr().getByText(/Enregistrement non confirmé/).waitFor();assert.equal(watches.get('TR:7'),false);fail=false;
 await page.evaluate(()=>window.__permission='denied');const count=writes.length;
 await tr().getByRole('button',{name:'M’avertir du retour en stock'}).click();await tr().getByText(/Notifications non activées/).waitFor();assert.equal(writes.length,count);
 await page.evaluate(()=>window.__permission='granted');delay=true;await tr().getByRole('button',{name:'M’avertir du retour en stock'}).click();
 await page.waitForFunction(()=>document.querySelector('.stock-watch-button').disabled);while(!held)await new Promise(r=>setTimeout(r,10));
 await logout();await login();await held();await tr().waitFor();
 assert.ok(!(await page.locator('#stock-list').innerText()).includes('Alerte activée pour cette référence'));
 await tr().locator('summary').click();await page.locator('#stock-notification-options').evaluate(el=>el.open=true);
 await page.locator('#stock-push-scope').selectOption('all');await page.locator('#stock-push-enable').click();await page.getByText(/Notifications activées · toutes/).waitFor();assert.equal(subscriptions.at(-1).notify_all,true);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.deepEqual(errors,[]);
 await mkdir('artifacts-v1',{recursive:true});await page.screenshot({path:'artifacts-v1/stock-watches-mobile.png',fullPage:true});
 console.log('Stock mobile passed: clickable searched product, exact company/ID, persistent enable/disable, server and permission failures, logout race, selected/all device scope, no horizontal overflow.');
}finally{await browser?.close();server.close()}
