import test from 'node:test';
import assert from 'node:assert/strict';
import {reconcileKinoUnit} from '../supabase/functions/odoo-commission-pipeline/unit-basis.mjs';
import {calculateOdooOrder} from '../supabase/functions/odoo-commission-pipeline/core.mjs';
import {normalizeOdooPipeline} from '../validation-v12/assets/odoo-commission-model-d30.mjs';
import {normalizeOdooPipeline} from '../validation-v12/assets/odoo-commission-model-d24.mjs';

// Synthetic Odoo source figures based on the separately checked CBW quote lines.
// These are regression benchmarks, NOT a live claim that Odoo documents are confirmed/paid.
const products=[
 ['TR','BK/+/G/TR/50','Bubba Kush 50-TR +','B',50,150,110,50],
 ['TR','BP/G/+/TR/50','Berry Pie 50g-TR +','B',53,150,110,50],
 ['TR','BG/TR/250','Bacio Gelato 250-TR','A',440,900,800,250],
 ['GTA','SL/I','Slurp','A',1.4,3,2.5,null]
];
const catalog=(company)=>new Map(products.filter(p=>p[0]===company).map(p=>
 [p[0]+'|'+p[1],{company:p[0],sku:p[1],product_name:p[2],tier:p[3],cost_eur:p[4],list_price_eur:p[5]}]));
const item=(id,qty,price,sku)=>({id,order_id:[1,'TEST-CBW'],product_id:[id,sku],
 name:'['+sku+']',product_uom_qty:qty,price_unit:price,price_subtotal:qty*price,
 discount:0,display_type:false});
function result(company,variant='bags'){
 const rows=products.filter(p=>p[0]===company);
 const lines=rows.map((p,i)=>item(101+i,variant==='grams'&&p[7]?p[7]:variant==='bags'&&p[7]?1:500,
  variant==='grams'&&p[7]?p[6]/p[7]:p[6],p[1]));
 const subtotal=lines.reduce((a,l)=>a+l.price_subtotal,0);
 const order={id:1,name:company==='TR'?'T02163':'S03687',state:'sent',
 date_order:'2026-10-08 10:00:00',invoice_status:'to invoice',
 partner_id:[2,'CBW test'],currency_id:[1,'EUR'],amount_untaxed:subtotal};
 const productMap=new Map(rows.map((p,i)=>[101+i,{name:p[2],default_code:p[1]}]));
 return calculateOdooOrder(order,lines,{company,products:productMap,
  catalog:catalog(company),catalogAvailable:true,duplicates:new Set()});
}
test('CBW TR quote benchmark: 3 package SKUs reproduce Kino estimate 99.13 EUR',()=>{
 const out=result('TR','bags');
 assert.equal(out.forecast,99.13);
 assert.deepEqual(out.lines.map(x=>x.commission_estimate),[15.75,14.43,68.95]);
 assert.deepEqual(out.lines.map(x=>x.effective_unit_cost_eur),[50,53,440]);
 assert.deepEqual(out.lines.map(x=>x.pack_size_g),[50,50,250]);
 assert.ok(out.lines.every(x=>x.unit_basis==='catalog_price_matches_odoo_unit'));
 assert.equal(out.unmatched_lines,0);
});
test('TR alternative Odoo representation: selling same packs as grams does not multiply bag costs',()=>{
 const out=result('TR','grams');
 assert.equal(out.forecast,99.13);
 assert.deepEqual(out.lines.map(x=>x.commission_estimate),[15.75,14.43,68.95]);
 assert.deepEqual(out.lines.map(x=>x.pack_size_g),[50,50,250]);
 assert.ok(out.lines.every(x=>x.unit_basis==='pack_cost_divided_by_grams'));
 assert.ok(Math.abs(out.lines[0].effective_unit_cost_eur-1)<1e-12);
 assert.ok(Math.abs(out.lines[1].effective_unit_cost_eur-1.06)<1e-12);
 assert.ok(Math.abs(out.lines[2].effective_unit_cost_eur-1.76)<1e-12);
});
test('CBW GTA quote benchmark: Slurp remains per gram and matches Kino 102.15 EUR',()=>{
 const out=result('GTA');
 assert.equal(out.forecast,102.15);
 assert.equal(out.lines[0].effective_unit_cost_eur,1.4);
 assert.equal(out.lines[0].unit_basis,'catalog_price_matches_odoo_unit');
 assert.equal(out.lines[0].quantity,500);
});
test('Slurp priced as a 500-g pack but sold as quantity 1 must be unresolved, not overpaid',()=>{
 const unit=reconcileKinoUnit({sku:'SL/I',productName:'Slurp',cost:1.4,
  listedPrice:3,odooUnitPrice:1250});
 assert.equal(unit.ok,false);
 assert.equal(unit.reason,'unverified_unit_scale');
 const out=calculateOdooOrder({id:1,name:'S03687',date_order:'2026-10-08 10:00:00',
 state:'sent',invoice_status:'to invoice',partner_id:[2,'Client'],
 amount_untaxed:1250,currency_id:[1,'EUR']},[item(101,1,1250,'SL/I')],
 {company:'GTA',products:new Map([[101,{name:'Slurp',default_code:'SL/I'}]]),
 catalog:catalog('GTA'),catalogAvailable:true,duplicates:new Set()});
 assert.equal(out.forecast,null);
 assert.equal(out.lines[0].reason,'unverified_unit_scale');
 assert.equal(out.unmatched_lines,1);
});
test('SKU pack suffix alone is not sufficient: catalog product name must confirm size',()=>{
 assert.equal(reconcileKinoUnit({sku:'BG/TR/250',productName:'Bacio Gelato',
 cost:440,listedPrice:900,odooUnitPrice:3.2}).ok,false);
 assert.equal(reconcileKinoUnit({sku:'BG/TR/250',productName:'Bacio Gelato 250-TR',
 cost:440,listedPrice:900,odooUnitPrice:3.2}).ok,true);
});
test('implausible catalog price ratio or missing cost never produces an invented zero',()=>{
 for(const args of [
  {sku:'BG/TR/250',productName:'Bacio Gelato 250-TR',cost:440,listedPrice:900,odooUnitPrice:50},
  {sku:'BG/TR/250',productName:'Bacio Gelato 250-TR',cost:0,listedPrice:900,odooUnitPrice:800},
  {sku:'SL/I',productName:'Slurp',cost:1.4,listedPrice:0,odooUnitPrice:2.5}
 ])assert.equal(reconcileKinoUnit(args).ok,false);
});

test('D30 client normalizer preserves Kino unit audit and rejects forged unit metadata',()=>{
 const tr=result('TR');
 const report={version:'odoo_commission_pipeline_v1',read_at:'2026-10-11T10:00:00Z',
  closed_window_from:'2026-10-01',
  scope:'owner_odoo_salesperson_read_only_states_and_invoice_status_rechecked',
  invoicing_semantics:'sale.order.invoice_status_not_payment_status',
  formula:'kino_browser_formula_provisional_without_spiff_units_unverified',
  source_lines_rechecked:true,source_amounts_rechecked:true,orders:[tr]};
 const valid=normalizeOdooPipeline(report).orders[0];
 assert.equal(valid.forecast,99.13);
 assert.equal(valid.lines[2].effectiveUnitCostEur,440);
 assert.equal(valid.lines[2].packSizeG,250);
 assert.equal(valid.lines[2].kinoTier,'A');
 assert.equal(valid.lines[2].unitBasis,'catalog_price_matches_odoo_unit');
 const tampered=structuredClone(report);
 tampered.orders[0].lines[2].effective_unit_cost_eur=-440;
 assert.throws(()=>normalizeOdooPipeline(tampered),/invalid_odoo_unit_basis/);
});
