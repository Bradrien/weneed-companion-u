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
   '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><main id="odoo-quote-pipeline-root"></main>');
  const file=resolve(root,'.'+decodeURIComponent(path));
  if(!file.startsWith(root+sep))return res.writeHead(403).end();
  res.writeHead(200,{'content-type':mime[extname(file)]||'text/plain'}).end(await readFile(file));
 }catch{res.writeHead(404).end('not found')}
});
await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
let browser;
try{
 const origin='http://127.0.0.1:'+server.address().port;
 browser=await chromium.launch({headless:true,channel:process.env.PLAYWRIGHT_CHANNEL||undefined});
 const page=await browser.newPage({viewport:{width:390,height:844}});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('**/*',route=>route.request().url().startsWith(origin)?route.continue():route.abort());
 await page.goto(origin);
 await page.evaluate(async()=>{
  const {createOdooQuotePipeline}=await import('/assets/odoo-quote-pipeline-d30.mjs');
  const line=(id,sku,product,price,cost,estimate,tier,pack)=>({
   line_id:id,sku,product,quantity:1,unit:'unité',price_unit:price,discount_pct:0,
   subtotal_ht:price,commission_estimate:estimate,reason:'estimated_units_unverified',
   unit_basis:'catalog_price_matches_odoo_unit',effective_unit_cost_eur:cost,
   pack_size_g:pack,catalog_unit_price_eur:pack===250?900:150,kino_tier:tier
  });
  const order={id:1,reference:'T02163',client:'CBW – compte synthétique',company:'TR',
   date:'2026-10-08 10:00:00',state:'sent',invoice_status:'to invoice',stage:'en_cours',
   currency:'EUR',amount_ht:1020,forecast:99.13,matched_lines:3,unmatched_lines:0,
   excluded_lines:0,issues:[],lines:[
    line(1,'BK/+/G/TR/50','Bubba Kush 50-TR +',110,50,15.75,'B',50),
    line(2,'BP/G/+/TR/50','Berry Pie 50-TR +',110,53,14.43,'B',50),
    line(3,'BG/TR/250','Bacio Gelato 250-TR',800,440,68.95,'A',250)
   ]};
  const data={version:'odoo_commission_pipeline_v1',read_at:'2026-10-11T11:00:00Z',
   closed_window_from:'2026-10-01',period_from:'2026-10-01',
   pending_scope:'period_pending_seller_orders',catalog_snapshot_at:'2026-10-10T00:35:35Z',
   invoicing_semantics:'sale.order.invoice_status_not_payment_status',
   formula:'kino_browser_formula_provisional_without_spiff_units_unverified',
   scope:'owner_odoo_salesperson_read_only_states_and_invoice_status_rechecked',
   source_lines_rechecked:true,source_amounts_rechecked:true,orders:[order]};
  window.pipeline=createOdooQuotePipeline({request:async()=>({data}),isActive:()=>true,
   isAuthenticated:()=>true});
  await window.pipeline.load();
 });
 await page.locator('.commission-month-toolbar input[type=month]').fill('2026-10');
 assert.match(await page.locator('.commission-monthly-panel').innerText(),/99,13/);
 await page.locator('.pipeline-order-head').first().click();
 const details=page.locator('.pipeline-order-details').first();
 assert.match(await details.innerText(),/Coût 50,00\s*€/);
 assert.match(await details.innerText(),/Coût 53,00\s*€/);
 assert.match(await details.innerText(),/Coût 440,00\s*€/);
 assert.match(await details.innerText(),/Sachet Kino 250 g/);
 assert.match(await details.innerText(),/Coût historique à confirmer/);
 assert.match(await details.innerText(),/99,13\s*€/);
 assert.deepEqual(errors,[]);
 console.log('D30 Kino drill-down mobile passed: three independent line costs, pack units and pending forecast.');
}finally{await browser?.close();await new Promise(ok=>server.close(ok))}
