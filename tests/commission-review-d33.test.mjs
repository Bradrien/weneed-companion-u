import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {reviewPointsForOrders,buildCommissionReview,createReviewCsv,reviewAction,odooRecordUrl}
 from '../validation-v12/assets/commission-review-d33.mjs';
const line=(id,changes={})=>({id,product:'Produit test',sku:'',quantity:1,unit:'unité',subtotalHT:100,
 commissionEstimate:null,reason:'missing_odoo_sku',catalogEvidence:null,...changes});
const order=(id,changes={})=>({id,reference:'TEST-'+id,client:'Client test',company:'TR',
 date:'2026-10-09 09:00:00',stage:'confirme',state:'sale',invoiceStatus:'to invoice',currency:'EUR',
 amountHT:100,forecast:null,issues:[],lines:[line(id*10)],...changes});
const data=orders=>({orders,sourceInputsRechecked:true,readAt:'2026-10-11T12:00:00Z',catalogSnapshotAt:'2026-10-10T00:35:35Z'});
const options={month:'2026-10',company:'all',query:''};
function parseCsv(content){
 const result=spawnSync('python3',['-c',
  'import csv,io,json,sys\ns=sys.stdin.read().lstrip("\\ufeff")\nprint(json.dumps(list(csv.DictReader(io.StringIO(s),delimiter=";"))))'],
  {input:content,encoding:'utf8'});
 assert.equal(result.status,0,result.stderr);return JSON.parse(result.stdout);
}
test('review separates unresolved lines, monetary exclusions and whole-order issues without changing estimates',()=>{
 const o=order(1,{forecast:12,issues:['signed_adjustment','lines_total_mismatch'],lines:[
  line(10),line(11,{reason:'not_eligible',subtotalHT:-20}),
  line(12,{reason:'estimated_units_unverified',commissionEstimate:12})]});
 const before=structuredClone(o),r=reviewPointsForOrders([o]);
 assert.equal(r.points.length,4);assert.equal(r.ordersCount,1);assert.equal(r.lineCount,2);
 assert.equal(r.unestimatedLines,1);assert.equal(r.monetaryExclusions,1);assert.equal(r.blockedOrders,1);
 assert.equal(r.confirmedOrders,1);assert.equal(r.pendingOrders,0);assert.equal(r.payable,false);
 assert.deepEqual(o,before);
});
test('an actual zero estimate and a zero excluded subtotal are not mistaken for missing values',()=>{
 const r=reviewPointsForOrders([order(1,{forecast:0,lines:[line(10,{commissionEstimate:0,
  reason:'estimated_units_unverified'}),line(11,{reason:'not_eligible',subtotalHT:0})]})]);
 assert.equal(r.points.length,0);assert.equal(r.ordersCount,0);assert.equal(r.payable,false);
 const missing=reviewPointsForOrders([order(2,{lines:[line(20,{reason:'not_eligible',subtotalHT:null})]})]);
 assert.equal(missing.monetaryExclusions,1);assert.equal(missing.points[0].line.subtotalHT,null);
});
test('whole-order blockers are still exported when every line has an estimate',()=>{
 const r=createReviewCsv(data([order(1,{issues:['not_eur'],currency:'CHF',
  lines:[line(10,{commissionEstimate:1,reason:'estimated_units_unverified'})]})]),options);
 const rows=parseCsv(r.content);assert.equal(rows.length,1);assert.equal(rows[0].portee_point,'order');
 assert.equal(rows[0].id_ligne,'');assert.equal(rows[0].devise,'CHF');assert.equal(r.lines,0);
});
test('month, company, source product and candidate searches define the same review selection',()=>{
 const candidates={source:'product_label_prefix',sku:'TEST-CANDIDATE',status:'found',costEur:10};
 const input=data([order(1,{lines:[line(10,{catalogEvidence:candidates})]}),
  order(2,{company:'GTA'}),order(3,{date:'2026-09-09 09:00:00'})]);
 const selected={...options,company:'TR',query:'TEST-CANDIDATE'},r=buildCommissionReview(input,selected);
 assert.equal(r.ordersCount,1);assert.equal(r.points[0].order.id,1);
 const rows=parseCsv(createReviewCsv(input,selected).content);assert.equal(rows.length,1);
 assert.equal(rows[0].sku_officiel_odoo,'');assert.equal(rows[0].code_candidat,'TEST-CANDIDATE');
 assert.equal(rows[0].statut_candidat,'found');assert.equal(rows[0].commission_payable,'non');
});
test('signed, null and zero evidence remain different, with no cross-currency total',()=>{
 const input=data([order(1,{amountHT:-20,lines:[line(10,{subtotalHT:-20,reason:'not_eligible'})]}),
  order(2,{currency:'CHF',amountHT:null,lines:[line(20,{subtotalHT:null})]}),
  order(3,{amountHT:0,lines:[line(30,{subtotalHT:0})]})]);
 const r=buildCommissionReview(input,options);assert.equal('amountHT' in r,false);
 const rows=parseCsv(createReviewCsv(input,options).content);
 assert.deepEqual(rows.map(row=>row.ht_ligne),['-20','','0']);
 assert.deepEqual(rows.map(row=>row.devise),['EUR','CHF','EUR']);
 assert.ok(rows.every(row=>row.montants_a_additionner==='non'&&row.commission_payable==='non'));
});
test('source text is escaped for spreadsheets while numeric negative amounts stay numeric',()=>{
 const input=data([order(1,{client:'=SUM(1;2)',reference:'@formula',amountHT:-20,
  lines:[line(10,{product:'\t=cmd,"test"\nligne',sku:'-CODE',subtotalHT:-20})]})]);
 const rows=parseCsv(createReviewCsv(input,options).content);
 assert.equal(rows[0].client,"'=SUM(1;2)");assert.equal(rows[0].commande_odoo,"'@formula");
 assert.equal(rows[0].produit,"'\t=cmd,\"test\"\nligne");assert.equal(rows[0].sku_officiel_odoo,"'-CODE");
 assert.equal(rows[0].ht_ligne,'-20');
});
test('the dossier requires a rechecked source and never includes a calculated commission column',()=>{
 assert.throws(()=>createReviewCsv({...data([order(1)]),sourceInputsRechecked:false},options),/review_requires_rechecked_source/);
 const rows=parseCsv(createReviewCsv(data([order(1)]),options).content);
 assert.equal(rows[0].source_reverifiee,'oui');assert.equal(rows[0].commission_payable,'non');
 assert.equal('estimation_ligne_provisoire' in rows[0],false);
 assert.equal(createReviewCsv(data([order(1)]),options).filename,'points-a-verifier-2026-10-all.csv');
});
test('Odoo links only contain a fixed trusted origin, allowed model and safe numeric source id',()=>{
 for(const model of ['sale.order','account.move']){
  const u=new URL(odooRecordUrl(model,12));assert.equal(u.origin,'https://weneedweed.odoo.com');
  assert.equal(u.pathname,'/web');assert.equal(u.search,'');
  const hash=new URLSearchParams(u.hash.slice(1));assert.equal(hash.get('id'),'12');
  assert.equal(hash.get('model'),model);assert.equal(hash.get('view_type'),'form');
 }
 for(const model of ['res.users','javascript:alert(1)','constructor'])
  assert.throws(()=>odooRecordUrl(model,1),/invalid_odoo_record/);
 for(const id of ['1',0,-1,1.2,Infinity,Number.MAX_SAFE_INTEGER+1])
  assert.throws(()=>odooRecordUrl('sale.order',id),/invalid_odoo_record/);
});
test('unknown diagnostics are safely presented as a manual review, including prototype names',()=>{
 for(const reason of ['constructor','__proto__','new_future_reason'])
  assert.equal(reviewAction(reason).label,'Diagnostic à vérifier');
 assert.match(reviewAction('missing_odoo_sku').instruction,/ne remplace pas le SKU source/);
 assert.match(reviewAction('not_eligible').instruction,/validation contractuelle/);
});
