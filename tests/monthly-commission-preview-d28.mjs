import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=resolve('validation-v12');
const mime={'.mjs':'text/javascript','.css':'text/css'};
const server=createServer(async(req,res)=>{
 try{
  const path=new URL(req.url,'http://localhost').pathname;
  if(path==='/')return res.writeHead(200,{'content-type':'text/html'}).end(
   '<!doctype html><meta name="viewport" content="width=device-width"><link rel="stylesheet" href="/assets/app-crm-d23.css"><link rel="stylesheet" href="/assets/commission-monthly-d25.css"><main id="odoo-quote-pipeline-root"></main>');
  const file=resolve(root,'.'+decodeURIComponent(path));
  if(!file.startsWith(root+sep))return res.writeHead(403).end();
  res.writeHead(200,{'content-type':mime[extname(file)]||'text/plain'}).end(await readFile(file));
 }catch{res.writeHead(404).end('not found')}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const origin='http://127.0.0.1:'+server.address().port;
const line=(id,overrides={})=>({line_id:id,sku:'SYNTHETIC',product:'Produit de test',quantity:10,
 unit:'g',price_unit:10,discount_pct:0,subtotal_ht:100,
 commission_estimate:7.5,reason:'estimated_units_unverified',...overrides});
const order=(id,overrides={})=>({id,reference:'TEST-'+id,client:'Client synthétique',company:'GTA',
 date:'2026-10-09 09:00:00',state:'sale',invoice_status:'to invoice',stage:'confirme',
 currency:'EUR',amount_ht:100,forecast:7.5,matched_lines:1,unmatched_lines:0,
 lines:[line(id*10)],...overrides});
const fixture={version:'odoo_commission_pipeline_v1',read_at:'2026-10-11T08:00:00Z',
 closed_window_from:'2025-10-11',catalog_snapshot_at:'2026-10-10T08:00:00Z',
 pending_scope:'all_pending_seller_orders',invoicing_semantics:'sale.order.invoice_status_not_payment_status',
 formula:'kino_browser_formula_provisional_without_spiff_units_unverified',
 scope:'owner_odoo_salesperson_read_only_states_and_invoice_status_rechecked',orders:[
  order(1,{reference:'T-Q-A',client:'Client Alpha',state:'sent',stage:'en_cours',date:'2026-10-06 10:00:00'}),
  order(2,{reference:'S-Q-B',client:'Client Bêta',state:'draft',stage:'en_cours',date:'2026-10-07 10:00:00',
   forecast:null,matched_lines:0,unmatched_lines:1,
   lines:[line(20,{sku:'',commission_estimate:null,reason:'missing_odoo_sku'})]}),
  order(3,{reference:'SALE-C',client:'Client Gamma',state:'sale',stage:'confirme',date:'2026-10-08 10:00:00'}),
  order(4,{reference:'INV-D',client:'Client Delta',state:'sale',stage:'facture',invoice_status:'invoiced',date:'2026-10-09 10:00:00'}),
  order(5,{reference:'SEP-E',client:'Client Septembre',state:'sent',stage:'en_cours',date:'2026-09-09 10:00:00'})
 ],source_lines_rechecked:true,source_amounts_rechecked:true};
let browser;
try{
 browser=await chromium.launch({headless:true,channel:process.env.PLAYWRIGHT_CHANNEL||undefined});
 const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',route=>route.request().url().startsWith(origin)?route.continue():route.abort());
 await page.goto(origin);
 await page.evaluate(async data=>{
  const {createOdooQuotePipeline}=await import('/assets/odoo-quote-pipeline-d28.mjs');
  window.fixture=data;window.fail=false;window.requestedMonths=[];
  window.pipeline=createOdooQuotePipeline({request:async(month)=>{
   window.requestedMonths.push(month);
   if(window.fail)throw Object.assign(Error('odoo_unreachable'),{stage:'orders_read'});
   return {data:{...window.fixture,period_from:month+'-01',
    orders:window.fixture.orders.filter(o=>o.date.slice(0,7)===month)}};
  },isActive:()=>true,isAuthenticated:()=>true});
  await window.pipeline.load();
 },fixture);
 const panel=page.locator('.commission-monthly-panel');
 const month=page.locator('.commission-month-toolbar input[type=month]');
 await month.fill('2026-10');
 assert.equal(await page.locator('.commission-month-metric').count(),3);
 const metric=page.locator('.commission-month-metric');
 assert.match(await metric.nth(0).innerText(),/7,50/);
 assert.match(await metric.nth(0).innerText(),/2 document/);
 assert.match(await metric.nth(1).innerText(),/15,00/);
 assert.match(await metric.nth(1).innerText(),/2 document/);
 assert.match(await metric.nth(2).innerText(),/Non disponible/);
 assert.doesNotMatch(await panel.innerText(),/SEP-E/);
 assert.match(await panel.innerText(),/T-Q-A/);
 assert.match(await panel.innerText(),/S-Q-B/);
 assert.match(await panel.innerText(),/Estimation à rapprocher/);
 assert.match(await panel.innerText(),/INV-D/);
 // The free-text search must alter BOTH the full list and monthly counts.
 await page.locator('input[aria-label="Rechercher les devis Odoo"]').fill('Client Alpha');
 assert.equal(await page.locator('.commission-month-row').count(),1);
 assert.match(await metric.nth(0).innerText(),/1 document/);
 assert.match(await metric.nth(1).innerText(),/0 document/);
 await page.locator('input[aria-label="Rechercher les devis Odoo"]').fill('');
 await month.fill('2026-09');
 await page.waitForFunction(()=>window.requestedMonths.includes('2026-09'));
 await page.getByText('SEP-E').first().waitFor();
 assert.match(await panel.innerText(),/SEP-E/);
 assert.doesNotMatch(await panel.innerText(),/T-Q-A/);
 assert.equal(await page.locator('.commission-month-row').count(),1);
 // A failed refresh cannot silently replace prior values with fabricated zeroes.
 await page.evaluate(()=>{window.fail=true});
 await page.getByRole('button',{name:'Actualiser le bilan Odoo'}).click();
 assert.match(await panel.innerText(),/Dernière réponse enregistrée en mémoire/);
 assert.match(await panel.innerText(),/Étape : orders_read/);
 assert.deepEqual(await page.evaluate(()=>window.requestedMonths.slice(0,3)),['2026-10','2026-09','2026-09']);
 assert.match(await panel.innerText(),/SEP-E/);
 assert.deepEqual(errors,[]);
 console.log('D28 monthly enriched Odoo pipeline smoke passed: quotations, invoiced, month, search, unavailable, stale.');
}finally{await browser?.close();await new Promise(r=>server.close(r))}
