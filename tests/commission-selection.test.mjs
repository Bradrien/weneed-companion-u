import {test} from 'node:test';
import assert from 'node:assert/strict';
import {selectCommissions,commissionStatus,defaultCommissionStatuses} from '../validation-v12/assets/commission-selection.mjs';
import {createCommissionCsv} from '../validation-v12/assets/commission-audit-d31.mjs';
const keys=['draft','sent','confirmed','invoiced'];
const order=(id,company,status,forecast)=>({id,reference:'CMD-'+id,client:'Client '+id,company,
 date:'2026-11-10',state:status==='draft'||status==='sent'?status:'sale',stage:status==='draft'||status==='sent'?'en_cours':status==='invoiced'?'facture':'confirme',
 forecast,partial:false,amountHT:100,currency:'EUR',issues:[],lines:[{product:'Produit '+id,sku:'SKU-'+id,commissionEstimate:forecast}],excludedMonetaryLines:0});
const orders=['TR','GTA'].flatMap((company,i)=>keys.map((key,j)=>order(i*4+j+1,company,key,(i+1)*10+j+.01)));
const data={orders,sourceInputsRechecked:true};
const select=opts=>selectCommissions(data,{month:'2026-11',...opts});
test('default shows validated and invoiced exactly once',()=>{
 assert.deepEqual([...defaultCommissionStatuses()],['confirmed','invoiced']);
 assert.equal(select().count,4);assert.equal(select().forecast,70.04);
 assert.equal(select().potentialCount,0);
});
test('all 16 status combinations, all companies: total equals exact visible documents',()=>{
 for(let mask=0;mask<16;mask++)for(const company of ['all','TR','GTA']){
  const statuses=new Set(keys.filter((_,i)=>mask&(1<<i)));
  const s=select({company,statuses});
  const expected=orders.filter(o=>(company==='all'||o.company===company)&&statuses.has(commissionStatus(o)));
  assert.deepEqual(s.orders.map(o=>o.id).sort(),expected.map(o=>o.id).sort());
  assert.equal(s.forecast,expected.reduce((sum,o)=>sum+Math.round(o.forecast*100),0)/100);
  assert.equal(Math.round(s.forecast*100),Math.round(s.companies.TR.forecast*100)+Math.round(s.companies.GTA.forecast*100));
 }
});
test('counts show available statuses regardless of chosen statuses',()=>{
 assert.deepEqual(select({statuses:new Set(),company:'TR'}).counts,{draft:1,sent:1,confirmed:1,invoiced:1});
});
test('month, client, reference and product narrow the same selection',()=>{
 assert.equal(select({month:'2026-10'}).count,0);
 for(const query of ['Client 3','CMD-3','Produit 3','SKU-3']){
  const s=select({query});assert.equal(s.count,1);assert.equal(s.forecast,12.01);
 }
});
test('missing amounts remain unavailable; partial sums are explicit and real zero survives',()=>{
 const d={orders:[order(1,'TR','confirmed',null),{...order(2,'TR','confirmed',4.24),partial:true}]};
 let s=selectCommissions(d,{month:'2026-11'});
 assert.equal(s.forecast,4.24);assert.equal(s.unavailableCount,1);assert.equal(s.partialCount,1);
 s=selectCommissions({orders:[order(1,'TR','confirmed',null)]},{month:'2026-11'});assert.equal(s.forecast,null);
 s=selectCommissions({orders:[order(1,'TR','confirmed',0)]},{month:'2026-11'});assert.equal(s.forecast,0);assert.equal(s.unavailableCount,0);
});
test('selected export includes the same documents and preserves missing amounts',()=>{
 const s=select({company:'TR',statuses:new Set(['draft','invoiced'])});
 const csv=createCommissionCsv({...data,orders:s.orders},{month:'2026-11',company:'TR'});
 assert.equal(csv.orders,2);assert.match(csv.content,/CMD-1/);assert.match(csv.content,/CMD-4/);assert.doesNotMatch(csv.content,/CMD-2/);
});
