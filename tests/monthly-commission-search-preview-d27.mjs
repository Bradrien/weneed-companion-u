import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=resolve('validation-v12'),mime={'.mjs':'text/javascript','.css':'text/css'};
const server=createServer(async(req,res)=>{
 try{
  const path=new URL(req.url,'http://localhost').pathname;
  if(path==='/')return res.writeHead(200,{'content-type':'text/html'}).end(
   '<!doctype html><meta name="viewport" content="width=device-width"><link rel="stylesheet" href="/assets/app-crm-d23.css"><link rel="stylesheet" href="/assets/commission-monthly-d27.css"><main id="odoo-quote-pipeline-root"></main>');
  const file=resolve(root,'.'+decodeURIComponent(path));
  if(!file.startsWith(root+sep))return res.writeHead(403).end();
  res.writeHead(200,{'content-type':mime[extname(file)]||'text/plain'}).end(await readFile(file));
 }catch{res.writeHead(404).end('not found')}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const origin='http://127.0.0.1:'+server.address().port;
const base=(state,id,reference,date,company='GTA')=>({
 id,reference,date,company,client:'Compte de test',state,currency:'EUR',amount_ht:200,
 lines:[{id:id*10,sku:'SYNT',product_name:'Produit synthétique'}]});
const raw=(month)=>{const [year,m]=month.split('-').map(Number);
 const to=new Date(Date.UTC(year,m,0)).toISOString().slice(0,10);
 const rows=[
  base('sent',1,'TEST-PENDING-TR',month+'-07 08:00:00','TR'),
  base('draft',2,'TEST-PENDING-GTA',month+'-08 08:00:00'),
  base('sale',3,'TEST-CONFIRMED',month+'-09 08:00:00'),
  base('cancel',4,'TEST-CANCELED',month+'-10 08:00:00')];
 return {source:'odoo_live_read_only',persisted:false,commissions_are_calculated:false,
  verified_commissions_eur:null,source_order_status_rechecked:true,
  source_order_status_checked_at:'2026-10-11T09:00:00Z',
  period_from:month+'-01',period_to:to,orders_count:rows.length,orders:rows};
};
let browser;
try{
 browser=await chromium.launch({headless:true,channel:process.env.PLAYWRIGHT_CHANNEL||undefined});
 const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',route=>route.request().url().startsWith(origin)?route.continue():route.abort());
 await page.goto(origin);
 await page.evaluate(async()=>{
  const {createOdooQuotePipeline}=await import('/assets/odoo-quote-pipeline-d27.mjs');
  window.monthlyRequests=[];
  const base=(state,id,reference,date,company='GTA')=>({
   id,reference,date,company,client:'Compte de test',state,currency:'EUR',amount_ht:200,
   lines:[{id:id*10,sku:'SYNT',product_name:'Produit synthétique'}]});
  const raw=month=>{
   const [year,m]=month.split('-').map(Number);
   const to=new Date(Date.UTC(year,m,0)).toISOString().slice(0,10);
   const orders=[
    base('sent',1,'TEST-PENDING-TR',month+'-07 08:00:00','TR'),
    base('draft',2,'TEST-PENDING-GTA',month+'-08 08:00:00'),
    base('sale',3,'TEST-CONFIRMED',month+'-09 08:00:00'),
    base('cancel',4,'TEST-CANCELED',month+'-10 08:00:00')];
   return {source:'odoo_live_read_only',persisted:false,commissions_are_calculated:false,
    verified_commissions_eur:null,source_order_status_rechecked:true,
    source_order_status_checked_at:'2026-10-11T09:00:00Z',
    period_from:month+'-01',period_to:to,orders_count:orders.length,orders};
  };
  window.pipeline=createOdooQuotePipeline({
   request:async()=>{throw Error('odoo_unreachable')},
   monthlyReportRequest:async month=>{window.monthlyRequests.push(month);return raw(month)},
   isActive:()=>true,isAuthenticated:()=>true
  });
  await window.pipeline.load();
 });
 const panel=page.locator('.commission-monthly-panel');
 const month=page.locator('.commission-month-toolbar input[type=month]');
 await month.fill('2026-10');
 await page.waitForFunction(()=>window.monthlyRequests.includes('2026-10'));
 await page.getByText('TEST-PENDING-TR').first().waitFor();
 assert.match(await panel.innerText(),/TEST-PENDING-GTA/);
 assert.match(await panel.innerText(),/TEST-CONFIRMED/);
 assert.doesNotMatch(await panel.innerText(),/TEST-CANCELED/);
 assert.match(await panel.innerText(),/Source : rapport Odoo classique/);
 assert.match(await panel.innerText(),/Commissions validées/);
 assert.match(await panel.innerText(),/Non disponible/);
 assert.match(await panel.innerText(),/estimations de commissions suspendues/);
 assert.equal(await page.locator('.commission-month-row').count(),3);
 const boxes=await page.locator('.pipeline-filter input[type=checkbox]').evaluateAll(nodes=>
  nodes.map(n=>({w:n.getBoundingClientRect().width,h:n.getBoundingClientRect().height})));
 assert.equal(boxes.length,3);
 assert.ok(boxes.every(x=>x.w<=24&&x.h<=24),'Status checkboxes must stay compact: '+JSON.stringify(boxes));
 await month.fill('2026-09');
 await page.waitForFunction(()=>window.monthlyRequests.includes('2026-09'));
 assert.equal(await page.locator('.commission-month-row').count(),3);
 await page.locator('input[aria-label="Rechercher dans le bilan mensuel"]').fill('TEST-PENDING-GTA');
 assert.equal(await page.locator('.commission-month-row').count(),1);
 const quick=page.locator('input[aria-label="Rechercher dans le bilan mensuel"]');
 const geometry=await page.evaluate(()=>{
  const input=document.querySelector('input[aria-label="Rechercher dans le bilan mensuel"]');
  const row=document.querySelector('.commission-month-row');
  return {inputY:input.getBoundingClientRect().top,rowY:row.getBoundingClientRect().top};
 });
 assert.ok(geometry.inputY<geometry.rowY,'Search must appear above monthly document cards');
 assert.equal(await page.locator('.pipeline-filter').count(),0,'Do not show detail-only status filters while pipeline is offline');
 await page.locator('select[aria-label="Filtrer le bilan mensuel par société"]').selectOption('TR');
 assert.equal(await page.locator('.commission-month-row').count(),0);
 await page.locator('select[aria-label="Filtrer le bilan mensuel par société"]').selectOption('all');
 assert.equal(await page.locator('.commission-month-row').count(),1);
 assert.deepEqual(errors,[]);
 console.log('D27 fallback preview: Odoo 503 recovered, pending status, month navigation, checkboxes, search verified.');
}finally{await browser?.close();await new Promise(r=>server.close(r))}
