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
   '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">'+
   '<link rel="stylesheet" href="/assets/app-crm-d24.css">'+
   '<link rel="stylesheet" href="/assets/commission-monthly-d27.css">'+
   '<link rel="stylesheet" href="/assets/commission-reconciliation-d30.css">'+
   '<link rel="stylesheet" href="/assets/commission-audit-d31.css">'+
   '<main id="odoo-quote-pipeline-root"></main>');
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
  const unresolved=(id,sku,product,reason,evidence)=>({line_id:id,sku,product,quantity:1,
   unit:'unité',price_unit:80,discount_pct:0,subtotal_ht:80,commission_estimate:null,reason,
   unit_basis:null,effective_unit_cost_eur:null,pack_size_g:null,catalog_unit_price_eur:null,
   kino_tier:null,catalog_evidence:evidence});
  const candidateEvidence={source:'product_label_prefix',company:'TR',sku:'TEST/TR/50',
   status:'found',catalog_name:'Produit catalogue test 50g',tier:'B',cost_eur:25,list_price_eur:90};
  const candidateOrder={...order,id:2,reference:'TEST-CANDIDATE',state:'sale',stage:'confirme',
   amount_ht:160,forecast:null,matched_lines:0,unmatched_lines:2,lines:[20,21].map(id=>
    unresolved(id,'','[TEST/TR/50] Produit test 50g','missing_odoo_sku',candidateEvidence))};
  const costOrder={...candidateOrder,id:3,reference:'TEST-COST',amount_ht:80,unmatched_lines:1,
   invoice_status:'invoiced',stage:'facture',lines:[unresolved(30,'COST/TR/50','Produit coût test 50g',
    'missing_kino_cost',{...candidateEvidence,source:'odoo_sku',sku:'COST/TR/50',cost_eur:0})]};
  const data={version:'odoo_commission_pipeline_v1',read_at:'2026-10-11T11:00:00Z',
   closed_window_from:'2026-10-01',period_from:'2026-10-01',
   pending_scope:'period_pending_seller_orders',catalog_snapshot_at:'2026-10-10T00:35:35Z',
   invoicing_semantics:'sale.order.invoice_status_not_payment_status',
   formula:'kino_browser_formula_provisional_without_spiff_units_unverified',
   scope:'owner_odoo_salesperson_read_only_states_and_invoice_status_rechecked',
   source_lines_rechecked:true,source_amounts_rechecked:true,orders:[order,candidateOrder,costOrder]};
  window.failNextRead=false;
  window.pipeline=createOdooQuotePipeline({request:async()=>{
   if(window.failNextRead)throw Error('odoo_unreachable');return {data};
  },isActive:()=>true,
   isAuthenticated:()=>true});
  await window.pipeline.load();
  // The same synthetic packs sold as grams must agree in scenario and Orders.
  const {renderCommissionScenario}=await import('/assets/commission-scenario-ui-d30.mjs');
  const {buildOrderLineCommissions,lineCommission}=await import('/assets/order-line-commission-d30.mjs');
  const report={verified_commissions_eur:null,commissions_are_calculated:false,persisted:false,
   source_order_status_rechecked:true,source_order_status_checked_at:data.read_at,
   catalog_matching:{matched:3},orders:[{id:1,reference:'TEST-TR',client:'Client synthétique',
    company:'TR',state:'sale',currency:'EUR',amount_ht:1020,commission_eur:null,issues:[],
    lines:order.lines.map(l=>({id:l.line_id,sku:l.sku,product_name:l.product,kind:'candidate',
     quantity:l.pack_size_g,unit_price:l.price_unit/l.pack_size_g,discount_pct:0,
     line_ht:l.subtotal_ht,commission_eur:null,catalog_match:{status:'matched',catalog_name:l.product,
      tier:l.kino_tier,cost_eur:l.effective_unit_cost_eur,list_price_eur:l.catalog_unit_price_eur}}))}]};
  const target=document.createElement('section');target.id='scenario-consistency';document.body.append(target);
  renderCommissionScenario(report,target);
  window.orderLineEstimates=report.orders[0].lines.map(l=>lineCommission(buildOrderLineCommissions(report),1,l.id));
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
 assert.match(await page.locator('#scenario-consistency').innerText(),/99,13\s*€/);
 assert.deepEqual(await page.evaluate(()=>window.orderLineEstimates.map(x=>x.commission)),[15.75,14.43,68.95]);
 assert.deepEqual(await page.evaluate(()=>window.orderLineEstimates.map(x=>x.costPerAssumedUnit)),[1,1.06,1.76]);
 await details.locator('.pipeline-calculation summary').first().click();
 assert.match(await details.locator('.pipeline-calculation').first().innerText(),/Prix net après remise/);
 assert.match(await details.locator('.pipeline-calculation').first().innerText(),/57,50\s*€/);
 assert.match(await details.locator('.pipeline-calculation').first().innerText(),/Taux appliqué\s+30\s*%/);
 assert.match(await page.locator('.commission-company-table').innerText(),/TR\s+99,13/);
 await page.locator('.pipeline-provenance summary').click();
 assert.match(await page.locator('.pipeline-provenance').innerText(),/Cette capture ne prouve pas les coûts à la date de vente/);
 const downloadPromise=page.waitForEvent('download');
 await page.getByRole('button',{name:'Exporter le bilan CSV',exact:true}).click();
 const download=await downloadPromise;
 assert.equal(download.suggestedFilename(),'commissions-provisoires-2026-10-all.csv');
 const csv=await readFile(await download.path(),'utf8');
 assert.match(csv,/estimation_ligne_provisoire/);assert.match(csv,/"99,13"/);
 assert.match(csv,/"TEST-CANDIDATE"/);assert.match(csv,/"desactive";"non"/);
 assert.match(await page.locator('.commission-export-controls').innerText(),/3 document\(s\), 6 ligne\(s\)/);
 assert.equal(await page.locator('.pipeline-reconciliation-group').count(),2);
 assert.match(await page.locator('.pipeline-reconciliation').innerText(),/Lignes à rapprocher · 3/);
 await page.locator('.pipeline-reconciliation-group summary').first().click();
 const candidate=page.locator('.pipeline-reconciliation-group').first();
 assert.match(await candidate.innerText(),/Code candidat TEST\/TR\/50/);
 assert.match(await candidate.innerText(),/Le champ SKU Odoo reste vide/);
 assert.match(await candidate.innerText(),/Société TR/);
 assert.match(await candidate.innerText(),/160,00\s*€ HT/);
 assert.match(await candidate.innerText(),/ne représente pas une commission/);
 // The direct command link restores a hidden stage and opens the source detail.
 await page.getByRole('checkbox',{name:'Inclure Confirmées non facturées entièrement',exact:true}).uncheck();
 await page.locator('.pipeline-reconciliation-group summary').first().click();
 await page.getByRole('button',{name:'TEST-CANDIDATE · Voir la commande',exact:true}).first().click();
 assert.equal(await page.getByRole('checkbox',{name:'Inclure Confirmées non facturées entièrement',exact:true}).isChecked(),true);
 assert.equal(await page.locator('[data-order-id="2"] .pipeline-order-head').getAttribute('aria-expanded'),'true');
 assert.match(await page.locator('[data-order-id="2"] .pipeline-order-details').innerText(),/Non estimée : SKU absent/);
 await page.locator('.pipeline-reconciliation-group summary').nth(1).click();
 assert.match(await page.locator('.pipeline-reconciliation-group').nth(1).innerText(),/coût 0,00\s*€ \(inutilisable pour le calcul\)/);
 assert.match(await page.locator('.pipeline-reconciliation-group').nth(1).innerText(),/Ces|Coût Kino absent ou nul/);
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);
 await page.getByRole('searchbox',{name:'Rechercher dans le bilan mensuel',exact:true}).fill('TEST-COST');
 assert.match(await page.locator('.commission-export-controls').innerText(),/1 document\(s\)/);
 await page.evaluate(async()=>{window.failNextRead=true;await window.pipeline.load(true)});
 assert.equal(await page.getByRole('button',{name:'Exporter le bilan CSV',exact:true}).isDisabled(),true);
 assert.match(await page.locator('#odoo-quote-pipeline-root').innerText(),/actualisation échouée/);
 assert.deepEqual(errors,[]);
 console.log('D31 mobile passed: audited line calculations, company breakdown, filtered CSV download, unresolved lines and stale-export guard.');
}finally{await browser?.close();await new Promise(ok=>server.close(ok))}
