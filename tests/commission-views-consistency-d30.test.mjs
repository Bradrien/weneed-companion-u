import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {calculateOdooOrder} from '../supabase/functions/odoo-commission-pipeline/core.mjs';
import {simulateOdooReport} from '../validation-v12/assets/commission-scenario-d30.mjs';
import {buildOrderLineCommissions,lineCommission} from '../validation-v12/assets/order-line-commission-d30.mjs';

// Synthetic data only; no customer documents or private prices are persisted here.
function fixture({grams=false,quantity=1,price=110,cost=50,discount=0,code='TEST/TR/50',title='Produit synthétique 50g',note='Produit synthétique',state='sale'}={}){
 const qty=grams?quantity*50:quantity,unitPrice=grams?price/50:price;
 const ht=qty*unitPrice*(1-discount/100);
 const catalog={product_name:title,catalog_name:title,tier:'B',cost_eur:cost,list_price_eur:150};
 const source={id:1,name:'TEST-1',date_order:'2026-10-09 12:00:00',state,
  invoice_status:'to invoice',partner_id:[1,'Client synthétique'],currency_id:[1,'EUR'],amount_untaxed:ht};
 const rawLine={id:10,product_id:[1,title],product_uom_qty:qty,price_unit:unitPrice,
  price_subtotal:ht,discount,display_type:false,name:note};
 const options={company:'TR',products:new Map([[1,{name:title,default_code:code}]]),
  catalog:new Map([['TR|'+code,catalog]]),duplicates:new Set(),catalogAvailable:true};
 const report={verified_commissions_eur:null,commissions_are_calculated:false,persisted:false,
  source_order_status_rechecked:true,source_order_status_checked_at:'2026-10-11T11:00:00Z',
  catalog_matching:{matched:1},orders:[{id:1,reference:'TEST-1',company:'TR',client:'Client synthétique',
   state,currency:'EUR',amount_ht:ht,commission_eur:null,issues:[],lines:[{
    id:10,sku:code,product_name:title,kind:'candidate',quantity:qty,unit_price:unitPrice,
    discount_pct:discount,line_ht:ht,commission_eur:null,catalog_match:{status:'matched',...catalog}}]}]};
 return {source,rawLine,options,report};
}
test('monthly pipeline, scenario and Orders agree for bags and equivalent gram sales',()=>{
 for(const grams of [false,true]){
  const f=fixture({grams});
  const server=calculateOdooOrder(f.source,[f.rawLine],f.options);
  const scenario=simulateOdooReport(f.report);
  const orderLine=lineCommission(buildOrderLineCommissions(f.report),1,10);
  assert.equal(server.forecast,15.75);
  assert.equal(scenario.total,server.forecast);
  assert.equal(orderLine.commission,server.forecast);
  assert.equal(scenario.ready[0].cost_per_assumed_unit,grams?1:50);
  assert.equal(scenario.ready[0].unit_basis,server.lines[0].unit_basis);
 }
});
test('all views round each line before adding the order and company totals',()=>{
 const f=fixture({price:140,cost:100,code:'TEST',title:'Produit synthétique'});
 f.options.catalog.get('TR|TEST').tier='A';
 f.report.orders[0].lines[0].catalog_match.tier='A';
 f.source.amount_untaxed*=2;f.report.orders[0].amount_ht*=2;
 const second={...f.rawLine,id:11};
 f.report.orders[0].lines.push({...f.report.orders[0].lines[0],id:11});
 const server=calculateOdooOrder(f.source,[f.rawLine,second],f.options);
 const scenario=simulateOdooReport(f.report);
 assert.equal(server.forecast,6.96);
 assert.equal(scenario.total,6.96);
 assert.equal(buildOrderLineCommissions(f.report).orders.get(1).amount,6.96);
});
test('a sale invoice note mentioning samples and shipping does not exclude the product',()=>{
 const f=fixture({note:'Produit synthétique\nSamples shipped separately; transport information.'});
 const server=calculateOdooOrder(f.source,[f.rawLine],f.options);
 assert.equal(server.lines[0].reason,'estimated_units_unverified');
 assert.equal(server.forecast,simulateOdooReport(f.report).total);
});
test('explicit sample and shipping identities remain excluded, including French accents',()=>{
 for(const title of ['Produit synthétique Sample','Échantillon produit','Shipping','Livraison']){
  const f=fixture({title});
  assert.equal(calculateOdooOrder(f.source,[f.rawLine],f.options).lines[0].reason,'not_eligible');
 }
 const named=fixture({title:'Transporter synthétique'});
 assert.notEqual(calculateOdooOrder(named.source,[named.rawLine],named.options).lines[0].reason,'not_eligible');
});
test('ambiguous units or zero cost do not become a simulated zero commission',()=>{
 for(const opts of [{price:20},{cost:0}]){
  const f=fixture(opts),server=calculateOdooOrder(f.source,[f.rawLine],f.options),scenario=simulateOdooReport(f.report);
  assert.equal(server.forecast,null);
  assert.equal(scenario.ready.length,0);
  assert.equal(lineCommission(buildOrderLineCommissions(f.report),1,10).status,'excluded');
 }
});
test('draft quotes remain excluded from the confirmed scenario and Orders estimate',()=>{
 const f=fixture({state:'draft'}),scenario=simulateOdooReport(f.report);
 assert.equal(scenario.ready.length,0);
 assert.equal(scenario.reasons.not_confirmed,1);
 assert.equal(lineCommission(buildOrderLineCommissions(f.report),1,10).status,'excluded');
 assert.equal(scenario.payable,false);
});
test('client and server unit reconciliation rules cannot drift silently',async()=>{
 const server=await readFile(new URL('../supabase/functions/odoo-commission-pipeline/unit-basis.mjs',import.meta.url),'utf8');
 const client=await readFile(new URL('../validation-v12/assets/kino-unit-basis-d30.mjs',import.meta.url),'utf8');
 assert.equal(client,server);
});
