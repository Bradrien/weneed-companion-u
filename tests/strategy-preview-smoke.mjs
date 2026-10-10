import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,join,extname,sep} from 'node:path';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';

const root=resolve('validation-v12');
const mime={'.html':'text/html','.mjs':'text/javascript','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml'};
const server=createServer(async(req,res)=>{
 try{
  const url=new URL(req.url,'http://localhost');
  const requested=decodeURIComponent(url.pathname),path=requested==='/'?join(root,'index.html'):resolve(root,'.'+requested);
  if(path!==root&&!path.startsWith(root+sep))return res.writeHead(403).end();
  const file=await readFile(path);
  res.writeHead(200,{'content-type':mime[extname(path)]||'text/plain','cache-control':'no-store'}).end(file);
 }catch{res.writeHead(404).end('not found')}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const origin='http://127.0.0.1:'+server.address().port;
const one='d4522538-54d8-497f-a80d-15a1cf214189',two='1ba23913-c5d8-4235-b638-86468013ef64';
const portfolio={version:'strategy_verified_v1',checked_at:'2026-10-11T00:00:00Z',
 clients:[{id:one,canonical_name:'Green Purple',status:'active'},{id:two,canonical_name:'Other',status:'prospect'}],
 verified_links:[{client_id:one,partner_odoo_id:3277}],whatsapp:[],memories:[],
 odoo:{available:true,error:null,window:{from:'2025-10-11',to:'2026-10-11'},
 orders:[{odoo_id:77,reference:'G999',date:'2026-09-01',state:'sale',partner_id:3277,partner_name:'Green Purple',
  company:'GTA',amount_ht:1000,currency:'EUR'},
 {odoo_id:78,reference:'T888',date:'2026-10-01',state:'done',partner_id:3277,partner_name:'Green Purple',
  company:'TR',amount_ht:500,currency:'EUR'},
 {odoo_id:80,reference:'G888',date:'2026-10-03',state:'sale',partner_id:998,partner_name:'Other',
  company:'GTA',amount_ht:2000,currency:'EUR'}]}};
let quoteRows=[];
const quoteId='fef12218-1111-4111-8111-bb011ac01acf';
const json=(data,status=200)=>({status,contentType:'application/json',headers:{
 'access-control-allow-origin':'*','access-control-allow-headers':'authorization,apikey,content-type,x-client-info',
 'access-control-allow-methods':'GET,POST,OPTIONS'},body:JSON.stringify(data)});
let browser;
try{
 browser=await chromium.launch({headless:true});
 const page=await browser.newPage({viewport:{width:390,height:844},deviceScaleFactor:2});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('https://gcirlrghjvumhkekrtmf.supabase.co/**',async route=>{
  const req=route.request(),u=new URL(req.url());let data;
  if(req.method()==='OPTIONS')return route.fulfill({status:204,headers:json(null).headers});
  if(u.pathname==='/auth/v1/token')data={access_token:'dummy-browser-only',refresh_token:'dummy-browser-only',expires_in:3600};
  else if(u.pathname==='/functions/v1/companion-profile')data={ok:true,role:'owner'};
  else if(u.pathname==='/functions/v1/strategy-portfolio')data={ok:true,data:portfolio};
  else if(u.pathname==='/functions/v1/manual-commission-quotes'){
   if(req.method()==='GET')data={ok:true,quotes:quoteRows,payable:false};
   else {
    const input=req.postDataJSON();
    assert.ok(['create','update'].includes(input.action));
    const now=input.action==='create'?'2026-10-11T10:00:00Z':'2026-10-11T10:01:00Z';
    if(input.action==='update')assert.equal(input.expected_updated_at,quoteRows[0].updated_at);
    const quote={id:quoteId,...input.quote,source_payload:{
     notes:input.quote.notes||'',products:input.quote.products||''},
     calculation_source:'manual_quote_d20',created_at:'2026-10-11T10:00:00Z',updated_at:now};
    quoteRows=[quote];data={ok:true,quote};
   }
  }
  else if(u.pathname==='/functions/v1/companion-api/dashboard')data={ok:true,data:{stats:{clients_total:2},attention_clients:[],unassigned_actionable_tasks:[]}};
  else if(u.pathname==='/auth/v1/logout')data={};
  else if(u.pathname.startsWith('/functions/v1/'))data={ok:true,data:[]};
  else throw Error('Unmocked route '+u.pathname);
  await route.fulfill(json(data));
 });
 await page.goto(origin+'/?view=strategy&build=D19',{waitUntil:'domcontentloaded'});
 await page.locator('#login-panel').waitFor({state:'visible'});
 await page.locator('#login-email').fill('owner@example.test');
 await page.locator('#login-password').fill('fake-password');
 await page.locator('#login-button').click();
 try{await page.locator('#view-strategy').waitFor({state:'visible',timeout:7000})}
 catch(e){
  console.log('D19 diagnosis:',JSON.stringify({errors,appVisible:await page.locator('#app-panel').isVisible(),
   loginVisible:await page.locator('#login-panel').isVisible(),
   loginMessage:await page.locator('#login-error').textContent(),url:page.url()}));
  throw e;
 }
 try{await page.getByText('Green Purple',{exact:true}).first().waitFor({state:'visible',timeout:7000})}
 catch(e){
  console.log('D19 portfolio diagnosis:',JSON.stringify({body:(await page.locator('#strategy-root').innerText()).slice(0,1600),
   errors,location:page.url()}));
  throw e;
 }
 assert.match(await page.locator('#strategy-root').innerText(),/131|2 client/i);
 assert.match(await page.locator('#strategy-root').innerText(),/1500|1.?500/);
 await page.locator('#strategy-root .strategy-client').filter({hasText:'Green Purple'}).first().click();
 await page.getByText('Laboratoire de remise',{exact:false}).waitFor({state:'visible'});
 assert.match(await page.locator('#strategy-root').innerText(),/Panier moyen/);
 assert.match(await page.locator('#strategy-root').innerText(),/2 commande/);
 const inputs=page.locator('.strategy-input-field input');
 for(const [i,v] of ['2.5','1.5','2.3','1000','1300'].entries())await inputs.nth(i).fill(v);
 await page.getByText('Hausse de volume nécessaire').waitFor({state:'visible'});
 assert.match(await page.locator('.strategy-outcome').innerText(),/25/);
 await page.locator('#bottom-nav [data-nav="commissions"]').click();
 await page.locator('#manual-quotes-root').getByText('Devis commerciaux en cours').waitFor({state:'visible'});
 await page.getByRole('button',{name:'+ Ajouter un devis'}).click();
 await page.getByLabel('Référence unique du devis').fill('DEV-DEMO-2026');
 await page.getByLabel('Client / boutique').fill('Client fictif');
 await page.getByLabel('Montant HT du devis (€)').fill('1450');
 await page.getByLabel('Commission prévue (€) — optionnel').fill('210');
 await page.locator('.quote-form button[type="submit"]').click();
 await page.locator('#manual-quotes-root').getByText('DEV-DEMO-2026 · GTA').waitFor({state:'visible'});
 assert.match(await page.locator('#manual-quotes-root').innerText(),/commission prévisionnelle/i);
 assert.match(await page.locator('#manual-quotes-root').innerText(),/210/);
 assert.equal(quoteRows.length,1);
 await page.locator('.quote-row button').first().click();
 await page.getByLabel('Statut').selectOption('valide');
 await page.locator('.quote-form button[type="submit"]').click();
 await page.getByText('Validé · 1').waitFor({state:'visible'});
 assert.equal(quoteRows[0].status,'valide');
 assert.equal(errors.length,0,'Unexpected runtime errors: '+errors.join(' | '));
 console.log('D20 iPhone smoke succeeded: private source data, navigation, verified metrics and price simulator');
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve))}
