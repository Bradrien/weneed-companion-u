import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,join,extname,sep} from 'node:path';
import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');

const root=resolve('validation-v12');
const mime={'.mjs':'text/javascript','.css':'text/css'};
const server=createServer(async(req,res)=>{
 try{
  const path=new URL(req.url,'http://localhost').pathname;
  if(path==='/')return res.writeHead(200,{'content-type':'text/html'}).end(
   '<!doctype html><meta name="viewport" content="width=device-width"><link rel="stylesheet" href="/assets/app-crm-d23.css"><main id="odoo-quote-pipeline-root"></main>');
  const file=resolve(root,'.'+decodeURIComponent(path));
  if(!file.startsWith(root+sep))return res.writeHead(403).end();
  res.writeHead(200,{'content-type':mime[extname(file)]||'text/plain'}).end(await readFile(file));
 }catch{res.writeHead(404).end('not found')}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const origin='http://127.0.0.1:'+server.address().port;
const line=(id,overrides={})=>({line_id:id,sku:'TEST',product:'Produit synthétique',quantity:10,
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
  order(1,{amount_ht:110,lines:[line(10),line(11,{product:'Livraison synthétique',quantity:1,subtotal_ht:10,
   commission_estimate:null,reason:'not_eligible'})]}),
  order(2,{amount_ht:120}),
  order(3,{amount_ht:90,lines:[line(30),line(31,{product:'Ajustement synthétique',quantity:-1,
   subtotal_ht:-10,commission_estimate:null,reason:'not_eligible'})]}),
  order(4,{currency:'CHF',forecast:null})],source_lines_rechecked:true,source_amounts_rechecked:true};
let browser;
try{
 browser=await chromium.launch({headless:true,channel:process.env.PLAYWRIGHT_CHANNEL||undefined});
 const page=await browser.newPage({viewport:{width:390,height:844}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',route=>route.request().url().startsWith(origin)?route.continue():route.abort());
 await page.goto(origin);
 await page.evaluate(async data=>{
  const {createOdooQuotePipeline}=await import('/assets/odoo-quote-pipeline-d24.mjs');
  window.fixture=data;window.fail=false;
  window.pipeline=createOdooQuotePipeline({request:async()=>{
   if(window.fail)throw Error('odoo_unreachable');return {data:window.fixture};
  },isActive:()=>true,isAuthenticated:()=>true});
  await window.pipeline.load();
 },fixture);
 const rootUI=page.locator('#odoo-quote-pipeline-root');
 assert.equal(await page.locator('.pipeline-order').count(),4);
 assert.match(await rootUI.innerText(),/Commissions payables : non validées/);
 assert.match(await rootUI.innerText(),/sources SPIFF divergent/);
 assert.match(await rootUI.innerText(),/Plusieurs devises : total non additionné/);
 assert.match(await rootUI.innerText(),/1 partiel\(s\), 3 suspendu\(s\)/);
 await page.locator('.pipeline-order-head').nth(0).click();
 assert.match(await page.locator('.pipeline-order-details').nth(0).innerText(),/potentielle partielle/);
 assert.match(await page.locator('.pipeline-order-details').nth(0).innerText(),/1 ligne\(s\) hors scénario/);
 await page.locator('.pipeline-order-head').nth(1).click();
 assert.match(await page.locator('.pipeline-order-details').nth(1).innerText(),/Total HT différent/);
 assert.doesNotMatch(await page.locator('.pipeline-order-details').nth(1).innerText(),/Commission estimée :/);
 await page.locator('.pipeline-order-head').nth(2).click();
 assert.match(await page.locator('.pipeline-order-details').nth(2).innerText(),/-10/);
 assert.match(await page.locator('.pipeline-order-details').nth(2).innerText(),/Ligne négative ou ajustement/);
 assert.match(await page.locator('.pipeline-order-head').nth(3).innerText(),/CHF/);
 await page.evaluate(()=>{window.fail=true});
 await page.getByRole('button',{name:/Actualiser Odoo/}).click();
 assert.match(await rootUI.innerText(),/Dernière lecture en mémoire/);
 assert.equal(await page.locator('.pipeline-order').count(),4);
 assert.deepEqual(errors,[]);
 console.log('Commission mobile smoke passed: source signs, coverage, blocked estimates, currencies, stale data.');
}finally{await browser?.close();await new Promise(r=>server.close(r))}
