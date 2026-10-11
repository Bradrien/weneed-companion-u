import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {calculateKinoLine,kinoCommissionRate} from '../supabase/functions/odoo-commission-pipeline/calculation.mjs';
import {calculateOdooOrder} from '../supabase/functions/odoo-commission-pipeline/core.mjs';
import {normalizeOdooPipeline} from '../validation-v12/assets/odoo-commission-model-d30.mjs';
import {createCommissionCsv,catalogueProvenance,COMMISSION_CSV_COLUMNS,selectedCommissionOrders} from '../validation-v12/assets/commission-audit-d31.mjs';

// Synthetic records only. Parse exports with Python's independent standard CSV reader.
function rawOrder({id=1,company='GTA',state='sale',cost=100,price=140,quantity=4,sku='TEST',
 product='Produit test',discount=0,date='2026-10-09 09:00:00',amount,client='Client test'}={}){
 const subtotal=price*quantity*(1-discount/100);
 const order={id,name:'TEST-'+id,date_order:date,state,invoice_status:'to invoice',
  partner_id:[1,client],currency_id:[1,'EUR'],amount_untaxed:amount??subtotal};
 const line={id:id*10,product_id:[1,product],product_uom_qty:quantity,price_unit:price,
  discount,price_subtotal:subtotal,display_type:false,name:product};
 return calculateOdooOrder(order,[line],{company,products:new Map([[1,{default_code:sku,name:product}]]),
  catalog:new Map([[company+'|TEST',{product_name:'Produit test',tier:'A',cost_eur:cost,list_price_eur:140}]]),
  duplicates:new Set(),catalogAvailable:true});
}
const envelope=orders=>({version:'odoo_commission_pipeline_v1',revision:8,
 calculation_version:'kino_browser_arithmetic_v1_cent_per_line',catalog_available:true,catalog_products_total:1,
 read_at:'2026-10-11T12:00:00Z',catalog_snapshot_at:'2026-10-10T00:00:00Z',
 invoicing_semantics:'sale.order.invoice_status_not_payment_status',
 formula:'kino_browser_formula_provisional_without_spiff_units_unverified',
 scope:'owner_odoo_salesperson_read_only_states_and_invoice_status_rechecked',
 source_lines_rechecked:true,source_amounts_rechecked:true,orders});
const normalize=(...orders)=>normalizeOdooPipeline(envelope(orders));
function parseCsv(content){
 const result=spawnSync('python3',['-c',
  'import csv,io,json,sys\ns=sys.stdin.read().lstrip("\\ufeff")\nprint(json.dumps(list(csv.DictReader(io.StringIO(s), delimiter=";"))))'],
  {input:content,encoding:'utf8'});
 assert.equal(result.status,0,result.stderr);return JSON.parse(result.stdout);
}
test('shared Kino arithmetic exposes net sale price, cost adjustment, signed margin and rate',()=>{
 const c=calculateKinoLine({tier:'A',cost:100,quantity:4,subtotalHT:560});
 assert.deepEqual(c,{sales:560,netUnitPrice:140,costMultiplier:1.25,adjustedUnitCost:125,
  unitMargin:15,margin:60,marginRatio:.15,rate:.2321,commission:13.93});
 assert.equal(kinoCommissionRate('A',.8),.3);assert.equal(kinoCommissionRate('B',1),.3);
 assert.equal(kinoCommissionRate('B',0),.22254);
});
test('below-cost sales retain their negative calculation margin and a real zero estimate',()=>{
 const c=calculateKinoLine({tier:'B',cost:100,quantity:2,subtotalHT:200});
 assert.ok(Math.abs(c.margin+30)<1e-9);assert.equal(c.rate,0);assert.equal(c.commission,0);
 const out=normalize(rawOrder({price:120}));
 assert.equal(out.orders[0].forecast,0);assert.equal(out.orders[0].lines[0].calculation.margin,-20);
});
test('nonfinite, coerced, missing or nonpositive cost/quantity cannot be calculated',()=>{
 const good={tier:'A',cost:100,quantity:1,subtotalHT:140};
 for(const changes of [{cost:0},{cost:'100'},{cost:Infinity},{quantity:0},{quantity:null},
  {subtotalHT:-1},{subtotalHT:NaN},{tier:'C'},{quantity:Number.MAX_VALUE}])
  assert.throws(()=>calculateKinoLine({...good,...changes}),/invalid_calculation/);
});
test('discounted HT, not the undiscounted catalogue sale price, determines the calculation',()=>{
 const out=normalize(rawOrder({discount:10}));
 assert.equal(out.orders[0].lines[0].calculation.netUnitPrice,126);
 assert.equal(out.orders[0].lines[0].calculation.margin,4);
 assert.equal(out.orders[0].forecast,.81);
});
test('a tampered calculation or declared commission is rejected during client replay',()=>{
 const original=envelope([rawOrder()]);
 for(const field of ['sales','netUnitPrice','costMultiplier','adjustedUnitCost','unitMargin',
  'margin','marginRatio','rate','commission']){
  const tampered=structuredClone(original);tampered.orders[0].lines[0].calculation[field]+=1;
  assert.throws(()=>normalizeOdooPipeline(tampered),/invalid_odoo_calculation/);
 }
 const tampered=structuredClone(original);tampered.orders[0].lines[0].commission_estimate=13.94;
 assert.throws(()=>normalizeOdooPipeline(tampered),/invalid_odoo_calculation/);
});
test('revision 8 requires its audit contract and cannot attach calculations to blocked source lines',()=>{
 for(const changes of [{calculation_version:'unknown'},{catalog_available:false},
  {catalog_products_total:0},{catalog_snapshot_at:'not a date'}])
  assert.throws(()=>normalizeOdooPipeline({...envelope([rawOrder()]),...changes}),/invalid_odoo_pipeline/);
 const missing=envelope([rawOrder()]);delete missing.orders[0].lines[0].calculation;
 assert.throws(()=>normalizeOdooPipeline(missing),/invalid_odoo_calculation/);
 const bad=envelope([rawOrder({cost:0})]);bad.orders[0].lines[0].calculation={commission:0};
 assert.throws(()=>normalizeOdooPipeline(bad),/invalid_odoo_calculation/);
});
test('server and browser arithmetic helpers cannot drift',async()=>{
 const server=await readFile(new URL('../supabase/functions/odoo-commission-pipeline/calculation.mjs',import.meta.url),'utf8');
 const client=await readFile(new URL('../validation-v12/assets/kino-calculation-d31.mjs',import.meta.url),'utf8');
 assert.equal(client,server);
});
test('monthly CSV includes every selected source line and replayed details with explicit nonpayable status',()=>{
 const data=normalize(rawOrder(),rawOrder({id:2,state:'draft',company:'TR'}));
 const out=createCommissionCsv(data,{month:'2026-10'}),rows=parseCsv(out.content);
 assert.equal(out.orders,2);assert.equal(out.lines,2);assert.equal(rows.length,2);
 assert.deepEqual(Object.keys(rows[0]),COMMISSION_CSV_COLUMNS);
 assert.equal(rows[0].estimation_ligne_provisoire,'13,93');assert.equal(rows[0].marge_calcul_ligne,'60');
 assert.equal(rows[0].prix_net_par_unite_odoo,'140');assert.equal(rows[0].cout_brut_catalogue,'100');
 assert.equal(rows[0].cout_ajuste_par_unite_odoo,'125');assert.equal(rows[0].taux_commission_pct,'23,21');
 assert.match(rows[1].categorie_odoo,/Devis en cours/);
 for(const row of rows){assert.equal(row.payable,'non');assert.equal(row.couts_historiques_valides,'non');assert.equal(row.spiff,'desactive');}
 assert.ok(out.content.startsWith('\uFEFF'));assert.equal(out.filename,'commissions-provisoires-2026-10-all.csv');
});
test('CSV company, search and month scope exactly match the selected source view',()=>{
 const data=normalize(rawOrder(),rawOrder({id:2,company:'TR'}),rawOrder({id:3,date:'2026-09-09 09:00:00'}));
 assert.equal(createCommissionCsv(data,{month:'2026-10',company:'TR'}).orders,1);
 assert.equal(parseCsv(createCommissionCsv(data,{month:'2026-10',query:'TEST-1'}).content)[0].commande_odoo,'TEST-1');
 assert.equal(createCommissionCsv(data,{month:'2026-09'}).orders,1);
 assert.equal(selectedCommissionOrders(data,{month:'2026-10',query:'absent'}).length,0);
 assert.throws(()=>createCommissionCsv(data,{month:'2026-13'}),/invalid_month/);
});
test('zero costs and proposed codes remain source diagnostics, without assumed commissions or promoted SKUs',()=>{
 const data=normalize(rawOrder({cost:0}),rawOrder({id:2,sku:'',product:'[TEST] Produit test'}));
 const rows=parseCsv(createCommissionCsv(data,{month:'2026-10'}).content);
 assert.equal(rows[0].cout_brut_catalogue,'0');assert.equal(rows[0].estimation_ligne_provisoire,'');
 assert.equal(rows[0].estimation_commande_provisoire,'');assert.equal(rows[1].sku_odoo,'');
 assert.equal(rows[1].code_candidat,'TEST');assert.equal(rows[1].statut_catalogue,'found');
 assert.equal(rows[1].estimation_ligne_provisoire,'');
});
test('a blocked order exports no usable commission even when line arithmetic is available',()=>{
 const data=normalize(rawOrder({amount:561})),row=parseCsv(createCommissionCsv(data,{month:'2026-10'}).content)[0];
 assert.match(row.blocages_commande,/lines_total_mismatch/);
 assert.equal(row.estimation_ligne_provisoire,'');assert.equal(row.estimation_commande_provisoire,'');
 assert.equal(row.ht_ligne,'560');assert.equal(row.marge_calcul_ligne,'60');
});
test('real zero estimates remain distinct from missing estimates',()=>{
 const row=parseCsv(createCommissionCsv(normalize(rawOrder({price:120})),{month:'2026-10'}).content)[0];
 assert.equal(row.estimation_ligne_provisoire,'0');assert.equal(row.estimation_commande_provisoire,'0');
});
test('CSV quotes survive semicolons, line breaks and formula-like source text',()=>{
 for(const prefix of ['=','+','-','@','\t=',' \r=']){
  const client=prefix+'HYPERLINK("example";"test")\nSeconde ligne';
  const row=parseCsv(createCommissionCsv(normalize(rawOrder({client,product:client})),{month:'2026-10'}).content)[0];
  assert.equal(row.client,"'"+client);assert.equal(row.produit,"'"+client);
 }
});
test('signed source values remain signed numeric cells and unknown line values remain blank',()=>{
 const out=rawOrder();out.amount_ht=-25;out.forecast=null;out.matched_lines=0;out.unmatched_lines=0;
 Object.assign(out.lines[0],{quantity:-1,subtotal_ht:-25,commission_estimate:null,reason:'not_eligible',
  unit_basis:null,effective_unit_cost_eur:null,catalog_unit_price_eur:null,pack_size_g:null,kino_tier:null,
  catalog_cost_eur:null,catalog_price_eur:null,calculation:null});
 const row=parseCsv(createCommissionCsv(normalize(out),{month:'2026-10'}).content)[0];
 assert.equal(row.ht_commande,'-25');assert.equal(row.ht_ligne,'-25');assert.equal(row.quantite_odoo,'-1');
 assert.equal(row.estimation_ligne_provisoire,'');
});
test('unrechecked and fallback reports cannot be exported as enriched verified sources',()=>{
 const data=normalize(rawOrder());data.sourceInputsRechecked=false;
 assert.throws(()=>createCommissionCsv(data,{month:'2026-10'}),/export_requires_rechecked_source/);
});
test('a capture made after the sale is never historical cost proof',()=>{
 const data=normalize(rawOrder({date:'2026-09-09 09:00:00'})),p=catalogueProvenance(data,data.orders);
 assert.equal(p.beforeCapture,1);assert.equal(p.afterCapture,0);assert.equal(p.ageHours,36);
 assert.equal(p.historicalCostsVerified,false);assert.equal(p.payable,false);
});
test('unavailable, missing or future captures keep their provenance uncertainty explicit',()=>{
 const data=normalize(rawOrder());
 for(const changes of [{catalogSnapshotAt:null},{catalogSnapshotAt:'2026-10-12T00:00:00Z'},
  {catalogAvailable:false}]){
  const p=catalogueProvenance({...data,...changes},data.orders);
  assert.equal(p.ageHours,null);assert.equal(p.historicalCostsVerified,false);
 }
});
