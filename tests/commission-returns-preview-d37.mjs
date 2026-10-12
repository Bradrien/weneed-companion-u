import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,join,extname,sep} from 'node:path';
import assert from 'node:assert/strict';
import {calculateKinoLine} from '../validation-v12/assets/kino-calculation-d31.mjs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=resolve('validation-v12'),mime={'.html':'text/html','.mjs':'text/javascript','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml'};
const server=createServer(async(req,res)=>{try{const u=new URL(req.url,'http://localhost'),p=u.pathname==='/'?join(root,'index.html'):resolve(root,'.'+decodeURIComponent(u.pathname));if(p!==root&&!p.startsWith(root+sep))return res.writeHead(403).end();res.writeHead(200,{'content-type':mime[extname(p)]||'text/plain'}).end(await readFile(p))}catch{res.writeHead(404).end()}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
const uid=n=>'10000000-1111-4111-8111-'+String(n).padStart(12,'0'),time=()=>new Date().toISOString();
function pipeline(month){
 const c=calculateKinoLine({tier:'A',cost:1,quantity:100,subtotalHT:300});
 const order=(id,company,state,invoice)=>({id,reference:'TEST-'+id,client:'Client de test '+id,company,state,
  invoice_status:invoice,currency:'EUR',date:month+'-10T12:00:00Z',stage:state==='draft'?'en_cours':invoice==='invoiced'?'facture':'confirme',
  amount_ht:300,forecast:c.commission,matched_lines:1,unmatched_lines:0,
  lines:[{line_id:100+id,product:'Produit de test',sku:'TEST/SKU',unit:'g',quantity:100,subtotal_ht:300,
   price_unit:3,discount_pct:0,commission_estimate:c.commission,reason:'estimated_units_unverified',unit_basis:'catalog_price_matches_odoo_unit',
   effective_unit_cost_eur:1,catalog_unit_price_eur:3,pack_size_g:null,kino_tier:'A',catalog_cost_eur:1,catalog_price_eur:3,calculation:c}]});
 return {ok:true,data:{version:'odoo_commission_pipeline_v1',scope:'owner_odoo_salesperson_read_only_states_and_invoice_status_rechecked',
  invoicing_semantics:'sale.order.invoice_status_not_payment_status',formula:'kino_browser_formula_provisional_without_spiff_units_unverified',
  calculation_version:'kino_browser_arithmetic_v1_cent_per_line',source_lines_rechecked:true,source_amounts_rechecked:true,
  catalog_available:true,catalog_products_total:1,catalog_snapshot_at:time(),read_at:time(),period_from:month+'-01',
  orders:month==='2026-06'?[]:[order(1,'TR','sale','to invoice'),order(2,'GTA','sale','invoiced'),order(3,'TR','draft','no')]}};
}
function returns(month){
 const row=(id,company,amount)=>({id:uid(id),month,company,currency:'EUR',reference:'TEST-OLDER-'+id,description:'Retour de test d’une commande antérieure',
  commission_cents:amount,kind:'excel_explicit_return',source_fingerprint:'a'.repeat(64),source_file:'Classeur de test.xlsx',source_sheet:'Mois du retour',
  amount_cell:'X'+id,net_formula_cell:'W6',net_formula:'W1-X4',verified_at:time()});
 const rows=month==='2026-06'?[row(1,'TR',7500)]:[row(1,'TR',2000),row(2,'GTA',2500)];
 return {ok:true,data:{version:'commission_returns_v1',month,scope:'recorded_deductions_only',read_at:time(),total:rows.length,deductions:rows}};
}
const headers={'access-control-allow-origin':'*','access-control-allow-headers':'authorization,apikey,content-type,x-client-info','access-control-allow-methods':'GET,POST,OPTIONS'};
const json=(body,status=200)=>({status,contentType:'application/json',headers,body:JSON.stringify(body)});
let browser,failReturns=false,failPipeline=false,holdReturns=false,release=null;
try{
 browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHANNEL?{channel:process.env.PLAYWRIGHT_CHANNEL}:{})});
 const page=await browser.newPage({viewport:{width:390,height:844},timezoneId:'Europe/Paris'}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('https://gcirlrghjvumhkekrtmf.supabase.co/**',async route=>{
  const req=route.request(),u=new URL(req.url());if(req.method()==='OPTIONS')return route.fulfill({status:204,headers});
  if(u.pathname==='/auth/v1/token')return route.fulfill(json({access_token:'synthetic-only',refresh_token:'synthetic-only',expires_in:3600}));
  if(u.pathname==='/functions/v1/companion-profile')return route.fulfill(json({ok:true,role:'owner'}));
  if(u.pathname==='/functions/v1/commission-returns'){
   const body=returns(u.searchParams.get('month'));
   if(holdReturns){holdReturns=false;body.data.deductions[0].commission_cents=999999;release=()=>route.fulfill(json(body));return}
   return route.fulfill(failReturns?json({ok:false,error:'return_deductions_unavailable'},503):json(body));
  }
  if(u.pathname==='/functions/v1/odoo-commission-pipeline')return route.fulfill(failPipeline?
   json({ok:false,error:'odoo_unreachable'},503):json(pipeline((u.searchParams.get('from')||u.searchParams.get('month')||'2026-10').slice(0,7))));
  if(u.pathname==='/functions/v1/commission-catalog-review')return route.fulfill(json({ok:false,error:'monthly_odoo_unavailable'},503));
  if(u.pathname==='/auth/v1/logout')return route.fulfill(json({}));
  return route.fulfill(json({ok:true,data:{stats:{clients_total:0},attention_clients:[],unassigned_actionable_tasks:[]}}));
 });
 const showFilters=async()=>{const d=page.locator('[data-disclosure="commission-filters"]');if(!await d.evaluate(x=>x.open))await d.locator('summary').click()};
 const login=async()=>{await page.locator('#login-password').fill('synthetic-only');await page.locator('#login-button').click();await page.locator('#app-panel').waitFor({state:'visible'})};
 const net=()=>page.locator('.commission-return-panel .commission-month-metric').nth(1).locator('strong');
 await page.goto(origin+'/?view=commissions&build=D37');await login();await page.getByText('Après déductions enregistrées · provisoire',{exact:true}).waitFor({state:'visible'});
 await page.waitForFunction(()=>document.querySelectorAll('.commission-return-panel .commission-month-metric strong')[1]?.textContent.includes('60,00'));
 assert.match(await page.locator('.commission-return-panel').textContent(),/commande confirmée déclenche/);
 assert.match(await page.locator('.commission-return-panel').innerText(),/105,00/);assert.match(await page.locator('.commission-return-panel').innerText(),/45,00/);
 await page.locator('[data-disclosure="return-source-info"]>summary').click();
 assert.match(await page.locator('.commission-return-panel').innerText(),/autre mois/);
 await page.locator('[data-disclosure="return-source-info"]>summary').click();
 await showFilters();await page.getByLabel('Filtrer le bilan mensuel par société').selectOption('TR');assert.match(await net().innerText(),/32,50/);
 await showFilters();await page.getByLabel('Rechercher dans le bilan mensuel').fill('TEST-1');assert.equal(await net().innerText(),'Non calculé');
 assert.match(await page.locator('.commission-return-panel').innerText(),/Efface la recherche/);
 await showFilters();await page.getByLabel('Rechercher dans le bilan mensuel').fill('');await showFilters();await page.getByLabel('Filtrer le bilan mensuel par société').selectOption('all');
 failReturns=true;await page.getByLabel('Actualiser le bilan Odoo').click();await page.getByText('Les déductions de retour ne sont pas disponibles. Le montant après retours reste non confirmé.',{exact:true}).waitFor({state:'visible'});
 assert.equal(await page.locator('.commission-return-panel .commission-month-metric').count(),0);failReturns=false;
 await page.getByLabel('Mois du bilan commissions').fill('2026-06');await page.getByLabel('Mois du bilan commissions').dispatchEvent('change');
 await page.waitForFunction(()=>document.querySelectorAll('.commission-return-panel .commission-month-metric strong')[1]?.textContent.includes('75,00'));
 assert.match(await net().innerText(),/-75,00|−75,00/);
 failPipeline=true;await page.getByLabel('Actualiser le bilan Odoo').click();await page.waitForFunction(()=>document.querySelector('.commission-return-panel .commission-month-metric:nth-child(2) strong')?.textContent==='Non calculé');failPipeline=false;
 holdReturns=true;await page.getByLabel('Actualiser le bilan Odoo').click();
 for(let i=0;i<100&&!release;i++)await new Promise(r=>setTimeout(r,20));assert.ok(release);
 await page.locator('#logout-top').click();await page.locator('#login-panel').waitFor({state:'visible'});await login();await release();
 await page.waitForFunction(()=>document.querySelectorAll('.commission-return-panel .commission-month-metric strong')[1]?.textContent.includes('60,00'));
 assert.match(await net().innerText(),/60,00/);assert.equal((await page.locator('.commission-return-panel').innerText()).includes('9 999,99'),false);
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'mobile overflow');assert.deepEqual(errors,[]);
 console.log('D37 mobile passed: confirmed-order trigger, estimates before returns, exact company scope, prior-order deductions, negative balances, failed-source guards, filtered-search scope and late-session isolation.');
}finally{await browser?.close();await new Promise(r=>server.close(r))}
