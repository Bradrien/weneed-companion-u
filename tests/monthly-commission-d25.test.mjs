import test from 'node:test';
import assert from 'node:assert/strict';
import {currentCommissionMonth,shiftCommissionMonth,labelCommissionMonth,summarizeCommissionMonth} from '../validation-v12/assets/monthly-commission-d25.mjs';
const row=(id,stage,forecast,more={})=>({id,stage,forecast,reference:'DOC-'+id,
 client:'Client essai',company:'GTA',date:'2026-10-08 10:00:00',
 currency:'EUR',amountHT:100,unmatchedLines:forecast===null?1:0,excludedMonetaryLines:0,
 partial:forecast===null,issues:[],...more});
test('current and adjacent commission months use calendar months, not month-end seconds',()=>{
 assert.equal(currentCommissionMonth(new Date(2026,9,11)),'2026-10');
 assert.equal(shiftCommissionMonth('2026-01',-1),'2025-12');
 assert.equal(shiftCommissionMonth('2026-12',1),'2027-01');
 assert.match(labelCommissionMonth('2026-10'),/octobre 2026/i);
 assert.throws(()=>shiftCommissionMonth('2026-13',1),/invalid_month/);
});
test('CBW-like synthetic pending quote is separate from confirmed, invoiced included only once',()=>{
 const data={orders:[row(1,'en_cours',12.5),row(2,'en_cours',null),
  row(3,'confirme',4.2),row(4,'facture',10.3),
  row(5,'facture',11.1,{date:'2026-09-29 12:00:00'}),
  row(6,'confirme',8,{company:'TR',date:'2026-10-10 10:00:00'})]};
 const x=summarizeCommissionMonth(data,{month:'2026-10'});
 assert.equal(x.totalDocuments,5);
 assert.equal(x.pending.count,2);
 assert.equal(x.pending.forecast,12.5);
 assert.equal(x.pending.unavailableCount,1);
 assert.equal(x.confirmed.count,3);
 assert.equal(x.confirmed.forecast,22.5);
 assert.equal(x.validated.amount,null);
 assert.equal(x.validated.available,false);
 const g=summarizeCommissionMonth(data,{month:'2026-10',company:'TR'});
 assert.equal(g.totalDocuments,1);
 assert.equal(g.confirmed.forecast,8);
 assert.equal(g.pending.forecast,null);
});
test('no document and unestimated documents do not fake a zero commission',()=>{
 const data={orders:[row(1,'en_cours',null)]};
 const a=summarizeCommissionMonth(data,{month:'2026-10'});
 assert.equal(a.pending.forecast,null);
 assert.equal(a.confirmed.forecast,null);
 const b=summarizeCommissionMonth(data,{month:'2026-09'});
 assert.equal(b.totalDocuments,0);
 assert.equal(b.pending.forecast,null);
 assert.throws(()=>summarizeCommissionMonth(data,{month:'2026-19'}),/invalid_month/);
});
test('search limits monthly metrics to matching documents',()=>{
 const data={orders:[row(1,'en_cours',5,{reference:'TEST-A',client:'Client_A'}),
 row(2,'en_cours',2,{reference:'TEST-B',client:'Client_B'})]};
 const a=summarizeCommissionMonth(data,{month:'2026-10',query:'Client_B'});
 assert.equal(a.pending.count,1);
 assert.equal(a.pending.orders[0].reference,'TEST-B');
 assert.equal(a.pending.forecast,2);
});
