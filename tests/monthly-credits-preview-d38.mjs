import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,join,extname,sep} from 'node:path';
import assert from 'node:assert/strict';
import {creditFixture} from './fixtures/monthly-credit-d38.mjs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const root=resolve('validation-v12'),mime={'.html':'text/html','.mjs':'text/javascript','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml'};
const server=createServer(async(req,res)=>{try{const u=new URL(req.url,'http://localhost'),p=u.pathname==='/'?join(root,'index.html'):resolve(root,'.'+decodeURIComponent(u.pathname));if(p!==root&&!p.startsWith(root+sep))return res.writeHead(403).end();res.writeHead(200,{'content-type':mime[extname(p)]||'text/plain'}).end(await readFile(p))}catch{res.writeHead(404).end()}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
const catalogTime=new Date(Date.now()-60000).toISOString();
const time=()=>new Date().toISOString(),uid='10000000-1111-4111-8111-000000000001';
const pipeline=month=>({ok:true,data:{version:'odoo_commission_pipeline_v1',scope:'owner_odoo_salesperson_read_only_states_and_invoice_status_rechecked',
 invoicing_semantics:'sale.order.invoice_status_not_payment_status',formula:'kino_browser_formula_provisional_without_spiff_units_unverified',
 calculation_version:'kino_browser_arithmetic_v1_cent_per_line',source_lines_rechecked:true,source_amounts_rechecked:true,
 catalog_available:true,catalog_products_total:1,catalog_snapshot_at:catalogTime,read_at:time(),period_from:month+'-01',orders:[]}});
const recorded=month=>({ok:true,data:{version:'commission_returns_v1',month,scope:'recorded_deductions_only',read_at:time(),total:1,
 deductions:[{id:uid,month,company:'TR',currency:'EUR',reference:'TEST-OLDER',description:'Retour enregistré de test',commission_cents:1050,
 kind:'excel_explicit_return',source_fingerprint:'a'.repeat(64),source_file:'Classeur de test.xlsx',source_sheet:'Mois du retour',amount_cell:'X4',
 net_formula_cell:'W6',net_formula:'W1-X4',verified_at:time()}]}});
const headers={'access-control-allow-origin':'*','access-control-allow-headers':'authorization,apikey,content-type,x-client-info','access-control-allow-methods':'GET,POST,OPTIONS'};
const json=(body,status=200)=>({status,contentType:'application/json',headers,body:JSON.stringify(body)});
let browser,fail=false,hold=false,release=null,creditReads=0;
try{
 browser=await chromium.launch({headless:true,...(process.env.PLAYWRIGHT_CHANNEL?{channel:process.env.PLAYWRIGHT_CHANNEL}:{})});
 const page=await browser.newPage({viewport:{width:390,height:844},timezoneId:'Europe/Paris'}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('https://gcirlrghjvumhkekrtmf.supabase.co/**',async route=>{
  const req=route.request(),u=new URL(req.url());if(req.method()==='OPTIONS')return route.fulfill({status:204,headers});
  if(u.pathname==='/auth/v1/token')return route.fulfill(json({access_token:'synthetic-only',refresh_token:'synthetic-only',expires_in:3600}));
  if(u.pathname==='/functions/v1/companion-profile')return route.fulfill(json({ok:true,role:'owner'}));
  if(u.pathname==='/functions/v1/odoo-commission-pipeline')return route.fulfill(json(pipeline(u.searchParams.get('from').slice(0,7))));
  if(u.pathname==='/functions/v1/commission-returns')return route.fulfill(json(recorded(u.searchParams.get('month'))));
  if(u.pathname==='/functions/v1/odoo-monthly-credits'){
   creditReads++;assert.equal(req.method(),'GET');const body=creditFixture(u.searchParams.get('month'));
   body.data.catalog_snapshot_at=catalogTime;const d=body.data.documents[0];d.note='<img src=x onerror="window.__creditInjected=true">';
   d.reversed_invoice_id=null;d.explicit_invoice_references=['TEST-INVOICE'];d.original_invoice.link_kind='explicit_invoice_note_reference';
   d.lines[0].link_kind='explicit_invoice_note_unique_line';d.lines[0].original_invoice_line_id=1001;
   if(hold){hold=false;release=()=>route.fulfill(json(body));return}
   return route.fulfill(fail?json({ok:false,error:'odoo_source_changed'},409):json(body));
  }
  if(u.pathname==='/auth/v1/logout')return route.fulfill(json({}));
  return route.fulfill(json({ok:true,data:{stats:{clients_total:0},attention_clients:[],unassigned_actionable_tasks:[]}}));
 });
 const login=async()=>{await page.locator('#login-password').fill('synthetic-only');await page.locator('#login-button').click();await page.locator('#app-panel').waitFor({state:'visible'})};
 const panel=()=>page.locator('.monthly-credit-panel'),button=()=>panel().getByRole('button',{name:'Lire les avoirs du mois',exact:true});
 const net=()=>page.locator('.commission-return-panel .commission-month-metric').nth(1).locator('strong');
 const loaded=async()=>{await panel().getByText('Commission à retirer estimée : −10,50 €',{exact:true}).waitFor({state:'visible'})};
 await page.goto(origin+'/?view=commissions&build=D38');await login();await button().waitFor({state:'visible'});
 await page.waitForFunction(()=>document.querySelectorAll('.commission-return-panel .commission-month-metric strong')[1]?.textContent.includes('10,50'));
 assert.equal(creditReads,0,'accounting read must be on demand');const initialNet=await net().innerText();
 await button().click();await loaded();assert.equal(await net().innerText(),initialNet,'candidate estimate was deducted twice');assert.equal(await panel().locator('.monthly-credit-net strong').innerText(),initialNet);
 assert.match(await panel().innerText(),/référence exacte citée dans la note/);assert.match(await panel().innerText(),/déduction Excel est déjà renseignée/);
 assert.equal(await page.evaluate(()=>window.__creditInjected),undefined);assert.equal(await panel().locator('img').count(),0);
 for(const a of await panel().locator('.commission-source-link').all()){
  assert.match(await a.getAttribute('href'),/^https:\/\/weneedweed\.odoo\.com\/web#/);assert.equal(await a.getAttribute('rel'),'noopener noreferrer');
 }
 await panel().getByText('Voir le calcul de la déduction',{exact:true}).click();assert.match(await panel().innerText(),/52,50/);
 await page.getByLabel('Filtrer le bilan mensuel par société').selectOption('GTA');assert.equal(await panel().locator('.monthly-credit-document').count(),0);
 await page.getByLabel('Filtrer le bilan mensuel par société').selectOption('TR');await page.getByLabel('Rechercher dans le bilan mensuel').fill('TEST-OLDER');
 assert.equal(await panel().locator('.monthly-credit-document').count(),1);await page.getByLabel('Rechercher dans le bilan mensuel').fill('absent');
 assert.equal(await panel().locator('.monthly-credit-document').count(),0);await page.getByLabel('Rechercher dans le bilan mensuel').fill('');
 fail=true;await button().click();await panel().getByText('Une source Odoo a changé pendant la lecture. Relance le rapprochement.',{exact:true}).waitFor({state:'visible'});
 assert.equal(await panel().locator('.monthly-credit-document').count(),0);assert.equal(await net().innerText(),initialNet);fail=false;
 hold=true;await button().click();for(let i=0;i<100&&!release;i++)await new Promise(r=>setTimeout(r,20));assert.ok(release);const releaseMonth=release;release=null;
 await page.getByLabel('Mois du bilan commissions').fill('2026-09');await page.getByLabel('Mois du bilan commissions').dispatchEvent('change');await releaseMonth();
 await button().waitFor({state:'visible'});assert.equal(await panel().locator('.monthly-credit-document').count(),0);await button().click();await loaded();
 hold=true;await button().click();for(let i=0;i<100&&!release;i++)await new Promise(r=>setTimeout(r,20));assert.ok(release);
 await page.locator('#logout-top').click();await page.locator('#login-panel').waitFor({state:'visible'});await login();await release();
 await button().waitFor({state:'visible'});assert.equal(await panel().locator('.monthly-credit-document').count(),0);
 await button().click();await loaded();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'mobile overflow');assert.deepEqual(errors,[]);
 console.log('D38 mobile passed: on-demand monthly credits, exact invoice-note provenance, source sale links, replayed prorata estimates, recorded-deduction duplicate warning, company/search scopes, literal notes and stale month/session guards.');
}finally{await browser?.close();await new Promise(r=>server.close(r))}
