import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import assert from 'node:assert/strict';
import {calculateOdooOrder} from '../supabase/functions/odoo-commission-pipeline/core.mjs';
const {chromium}=await import('playwright');
const root=resolve('validation-v12'),mime={'.html':'text/html','.mjs':'text/javascript','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml'};
const server=createServer(async(req,res)=>{try{
 const path=new URL(req.url,'http://localhost').pathname,file=path==='/'?resolve(root,'index.html'):resolve(root,'.'+decodeURIComponent(path));
 if(!file.startsWith(root+sep))return res.writeHead(403).end();
 res.writeHead(200,{'content-type':mime[extname(file)]||'application/octet-stream'}).end(await readFile(file));
}catch{res.writeHead(404).end()}});
await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
const origin='http://127.0.0.1:'+server.address().port,id='11111111-1111-4111-8111-111111111111',taskId='22222222-2222-4222-8222-222222222222';
const time=new Date().toISOString(),month=time.slice(0,7),client={client_id:id,canonical_name:'Boutique Démo',status:'active',open_task_count:1,overdue_task_count:1};
const catalog=new Map([['TR|PB/G/TR/250',{sku:'PB/G/TR/250',product_name:'Peanut Butter 250-TR',tier:'B',cost_eur:190,list_price_eur:450}]]);
const makeOrder=(n,state,{amount=550}={})=>calculateOdooOrder({id:n,name:'DEMO-'+n,date_order:month+'-10 10:00:00',state,invoice_status:'to invoice',
 partner_id:[1,client.canonical_name],currency_id:[1,'EUR'],amount_untaxed:amount},[{id:n*10,name:'Peanut Butter 250-TR',product_id:[1,'Peanut Butter 250-TR'],
 product_uom_qty:1,price_unit:550,discount:0,price_subtotal:550,display_type:false}],{company:'TR',products:new Map([[1,{default_code:'',name:'[PB/G/TR/250] Peanut Butter 250-TR'}]]),catalog,duplicates:new Set(),catalogAvailable:true});
const pipeline={version:'odoo_commission_pipeline_v1',revision:9,scope:'owner_odoo_salesperson_read_only_states_and_invoice_status_rechecked',
 invoicing_semantics:'sale.order.invoice_status_not_payment_status',formula:'kino_browser_formula_provisional_without_spiff_units_unverified',
 calculation_version:'kino_browser_arithmetic_v1_cent_per_line',source_lines_rechecked:true,source_amounts_rechecked:true,catalog_available:true,
 catalog_products_total:1,catalog_snapshot_at:time,read_at:time,period_from:month+'-01',orders:[makeOrder(1,'sale'),makeOrder(2,'draft'),makeOrder(3,'sale',{amount:0})]};
const portfolio={version:'strategy_verified_v1',checked_at:time,clients:[{id,canonical_name:client.canonical_name,status:'active'}],
 verified_links:[{client_id:id,partner_odoo_id:1}],whatsapp:[],memories:[],odoo:{available:true,error:null,
 window:{from:'2025-10-01',to:time.slice(0,10)},orders:[{odoo_id:1,reference:'DEMO-1',date:month+'-01',state:'sale',partner_id:1,
 partner_name:client.canonical_name,company:'TR',amount_ht:550,currency:'EUR'}]}};
const headers={'access-control-allow-origin':'*','access-control-allow-headers':'authorization,apikey,content-type,x-client-info','access-control-allow-methods':'GET,POST,OPTIONS'};
const json=(body,status=200)=>({status,contentType:'application/json',headers,body:JSON.stringify(body)});
let browser,page,tasks=[],posts=[],pipelineReads=0,errors=[],taskReads=[];
try{
 browser=await chromium.launch({headless:true});page=await browser.newPage({viewport:{width:390,height:844},timezoneId:'Europe/Paris',locale:'fr-FR'});
 page.on('pageerror',e=>errors.push(e.message));
 await page.route('https://gcirlrghjvumhkekrtmf.supabase.co/**',async route=>{
  const req=route.request(),u=new URL(req.url());if(req.method()==='OPTIONS')return route.fulfill({status:204,headers});
  const p=u.pathname;let response;
  if(p==='/auth/v1/token')response={access_token:'synthetic-only',refresh_token:'synthetic-only',expires_in:3600};
  else if(p==='/functions/v1/companion-profile')response={ok:true,role:'owner'};
  else if(p==='/functions/v1/odoo-commission-pipeline'){pipelineReads++;response={ok:true,data:{...pipeline,period_from:u.searchParams.get('from')}}}
  else if(p==='/functions/v1/commission-returns')response={ok:true,data:{version:'commission_returns_v1',month:u.searchParams.get('month'),scope:'recorded_deductions_only',read_at:time,total:0,deductions:[]}};
  else if(p==='/functions/v1/companion-api/dashboard')response={ok:true,data:{stats:{clients_total:1,clients_needing_attention:1,open_actionable_tasks:1,overdue_actionable_tasks:1},attention_clients:[client],unassigned_actionable_tasks:[]}};
  else if(p==='/functions/v1/companion-api/clients')response={ok:true,data:[client]};
  else if(p==='/functions/v1/companion-api/clients/'+id+'/card')response={ok:true,data:{profile:{id,name:client.canonical_name,status:'active',address:'Toulouse',country:'France'},
   contacts:[{name:'Contact Démo',role:'Gérant',channels:[{type:'phone',value:'+33 6 00 00 00 00'},{type:'email',value:'contact@example.test'}]}],
   memory:{summary:'Contexte client de démonstration'},attention:{tasks:[{title:'Faire le point',description:'Préparer la prochaine commande',due_at:time}],open_task_count:1},activity:{recent:[]}}};
  else if(p.startsWith('/functions/v1/companion-api/clients/'))return route.fulfill(json({ok:false,error:'detail_unavailable'},503));
  else if(p==='/functions/v1/strategy-portfolio')response={ok:true,data:portfolio};
  else if(p==='/functions/v1/stock-monitor')response={ok:true,data:{checked_at:time,stale:false,last_error:null,scan_interval_minutes:5,total:1,summary:[{company:'TR',products:1,out_of_stock:0},{company:'GTA',products:0,out_of_stock:0}],items:[{company:'TR',product_id:7,sku:'PB/G/TR/250',product_name:'Peanut Butter 250-TR',unit:'Units',quantity_basis:'free_qty',available_quantity:3,on_hand_quantity:3,forecast_quantity:3,checked_at:time,watching:false}],alerts:[]}};
  else if(p==='/functions/v1/companion-tasks'){
   if(req.method()==='GET')taskReads.push(u);
   if(req.method()==='POST'){const body=req.postDataJSON();posts.push(body);tasks=[{id:taskId,...body.payload,client_name:client.canonical_name,status:'OPEN',is_suggested:false,
    updated_at:time,reminder_synced_at:null,reminder_sync_status:'PENDING',reminder_action:'UPSERT',reminder_reason:'eligible'}];response={ok:true,task_id:taskId,updated_at:time,duplicate:false}}
   else response={ok:true,data:{tasks,total:tasks.length,limit:200,checked_at:time}};
  }else if(p==='/auth/v1/logout')response={};
  else return route.fulfill(json({ok:false,error:'unavailable'},503));
  await route.fulfill(json(response));
 });
 const overflow=async()=>assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'V1 horizontal overflow');
 await page.goto(origin+'/?view=home');await page.locator('#login-password').fill('synthetic-only');await page.locator('#login-button').click();
 await page.locator('#metrics').getByText('99,45 €',{exact:true}).waitFor({state:'visible'});
 assert.ok(pipelineReads>=1);assert.equal(await page.locator('#bottom-nav [aria-current="page"]').getAttribute('data-nav'),'home');
 assert.equal(await page.locator('#recent-orders .client-row').count(),2);assert.match(await page.locator('#metrics').innerText(),/550,00/);
 for(const width of [320,360,390,768,1440]){await page.setViewportSize({width,height:844});await overflow()}
 await page.setViewportSize({width:390,height:844});await mkdir('artifacts-ux',{recursive:true});
 await page.screenshot({path:'artifacts-ux/home-mobile.png',fullPage:true});
 // Sales KPI -> precisely filtered list, accessible state, and review coverage.
 await page.locator('#metrics').getByRole('button',{name:/^Commandes confirmées/}).click();
 assert.equal(await page.locator('#status-select').inputValue(),'confirmed');assert.equal(await page.locator('#orders-list .order-card').count(),2);
 assert.equal(await page.locator('#page-title').evaluate(n=>n===document.activeElement),true);
 await page.locator('[data-company="TR"]').click();assert.equal(await page.locator('[data-company="TR"]').getAttribute('aria-pressed'),'true');
 await page.locator('#bottom-nav [data-nav="home"]').click();
 await page.getByText('Devis et couverture du calcul',{exact:true}).click();
 assert.match(await page.locator('#home-opportunities').innerText(),/Devis en cours/);
 await page.locator('#home-opportunities').getByRole('button',{name:/^Commandes à vérifier/}).click();
 assert.equal(await page.locator('#status-select').inputValue(),'review');assert.equal(await page.locator('#orders-list .order-card').count(),1);assert.match(await page.locator('#orders-list').innerText(),/DEMO-3/);
 await page.locator('#order-search').fill('no-such-order');await page.getByRole('button',{name:'Effacer les filtres',exact:true}).click();
 assert.equal(await page.locator('#order-search').inputValue(),'');assert.equal(await page.locator('#status-select').inputValue(),'all');
 await page.locator('#bottom-nav [data-nav="home"]').click();await page.getByText('Points à vérifier',{exact:true}).click();
 await page.locator('#review-cues .review-action').first().click();assert.equal(await page.locator('#order-search').inputValue(),'DEMO-3');await page.locator('#orders-list .order-details').waitFor({state:'visible'});
 await page.locator('#bottom-nav [data-nav="home"]').click();await page.locator('#recent-orders .client-row').first().click();
 assert.equal(await page.locator('#order-search').inputValue(),'DEMO-1');await page.locator('#orders-list .order-details').waitFor({state:'visible'});
 await page.getByRole('button',{name:/^Vérifier le stock de/}).click();
 assert.equal(new URL(page.url()).searchParams.get('view'),'stocks');assert.equal(await page.locator('#stock-company').inputValue(),'TR');assert.equal(await page.locator('#stock-search').inputValue(),'PB/G/TR/250');await page.locator('#stock-list .stock-card').waitFor();
 await page.goBack();await page.locator('#view-orders').waitFor({state:'visible'});
 await page.getByRole('button',{name:'Rechercher ce client',exact:true}).click();assert.equal(await page.locator('#client-search').inputValue(),client.canonical_name);
 await page.locator('#clients-list .client-row').first().click();await page.getByRole('button',{name:'Préparer une relance',exact:true}).waitFor({state:'visible'});
 await page.goBack();await page.locator('#clients-list .client-row').first().waitFor({state:'visible'});
 await page.goForward();await page.getByRole('button',{name:'Préparer une relance',exact:true}).waitFor({state:'visible'});
 const localOrders=page.getByRole('button',{name:/^Charger les commandes ·/});await page.locator('[data-disclosure="client-sales"]>summary').click();await localOrders.waitFor({state:'visible'});
 // Clear audit filters before the full sales task scenario.
 await page.goBack();await page.locator('#clients-list .client-row').first().waitFor({state:'visible'});
 await page.locator('#bottom-nav [data-nav="home"]').click();
 await page.locator('#view-home .v1-shortcut[data-nav="orders"]').click();await page.locator('#order-search').fill('no-such-order');await page.getByRole('button',{name:'Effacer les filtres',exact:true}).click();
 await page.locator('#bottom-nav [data-nav="home"]').click();

 await page.locator('#view-home .v1-shortcut[data-nav="orders"]').click();await page.locator('#orders-list .order-button').first().click();
 assert.match(await page.locator('#orders-list .order-details').first().innerText(),/Commission estimée : 99,45/);assert.match(await page.locator('#orders-list .order-details').first().innerText(),/Libellé rapproché/);
 await page.locator('#bottom-nav [data-nav="commissions"]').click();
 assert.equal(await page.locator('[data-disclosure="commission-orders"]').getAttribute('open'),null);
 assert.equal(await page.locator('#legacy-commission-details').getAttribute('open'),null);await overflow();
 await page.screenshot({path:'artifacts-ux/commissions-mobile.png',fullPage:true});
 await page.locator('[data-disclosure="commission-orders"]>summary').click();await page.locator('.pipeline-order-head').first().click();
 await page.locator('.pipeline-order-details').first().getByText('Libellé rapproché · PB/G/TR/250',{exact:true}).waitFor({state:'visible'});
 assert.match(await page.locator('.pipeline-order-details').first().innerText(),/99,45/);
 await page.locator('#bottom-nav [data-nav="clients"]').click();await page.locator('#clients-list .client-row').first().click();
 await page.getByRole('button',{name:'Préparer une relance',exact:true}).waitFor({state:'visible'});
 assert.equal(await page.locator('a[href="tel:+33600000000"]').count(),1);
 assert.equal(await page.locator('a[href="mailto:contact@example.test"]').count(),1);
 assert.equal(await page.locator('[data-disclosure="client-sales"]').getAttribute('open'),null);await overflow();
 await page.screenshot({path:'artifacts-ux/client-mobile.png',fullPage:true});
 await page.getByRole('button',{name:'Préparer une relance',exact:true}).click();await page.getByLabel('Action à réaliser').waitFor({state:'visible'});
 assert.equal(await page.getByLabel('Action à réaliser').inputValue(),'Relancer Boutique Démo');assert.equal(await page.getByLabel('Client',{exact:true}).inputValue(),id);
 assert.equal(posts.length,0,'draft saved without user action');await page.getByRole('button',{name:'Fermer',exact:true}).click();
 await page.locator('#bottom-nav [data-nav="home"]').click();await page.locator('#metrics').getByRole('button',{name:/^Actions en retard/}).click();await page.getByText('Tâches de tous les clients et actions sans client.',{exact:true}).waitFor({state:'visible'});
 assert.equal(taskReads.at(-1).searchParams.has('client_id'),false,'home task KPI must clear prior client scope');

 await page.locator('#bottom-nav [data-nav="strategy"]').click();await page.locator('.strategy-client').first().click();
 await page.getByRole('button',{name:'Préparer cette action',exact:true}).first().click();await page.getByLabel('Action à réaliser').waitFor({state:'visible'});
 assert.ok((await page.getByLabel('Action à réaliser').inputValue()).length>0);assert.equal(await page.getByLabel('Client',{exact:true}).inputValue(),id);assert.equal(posts.length,0);
 await page.getByRole('button',{name:'Enregistrer',exact:true}).click();await page.locator('.task-card').first().waitFor({state:'visible'});
 assert.equal(posts.length,1);assert.equal(posts[0].payload.client_id,id);await overflow();
 await page.locator('#logout-top').click();await page.locator('#login-panel').waitFor({state:'visible'});
 assert.equal(await page.locator('#client-detail').innerText(),'');assert.equal(errors.length,0,errors.join('\n'));
 console.log('Commercial UX passed: actionable KPI/review cues, quote coverage, stock/client shortcuts, client Back/Forward, scoped tasks reset, plus V1: automatic current-month dashboard, 320–1440px layouts, collapsed diagnostics, listing provenance, client contact shortcuts, unsaved follow-up draft, client-bound development action and logout isolation.');
}catch(error){await mkdir('artifacts-ux',{recursive:true});if(page){await page.screenshot({path:'artifacts-ux/failure.png',fullPage:true});console.log('V1 failure diagnostics',JSON.stringify({errors,visible:(await page.locator('#app-panel').innerText()).slice(0,2200),posts:posts.length}))}throw error;}finally{await browser?.close();await new Promise(ok=>server.close(ok))}
