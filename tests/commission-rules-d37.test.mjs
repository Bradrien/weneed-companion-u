import test from 'node:test';
import assert from 'node:assert/strict';
import {COMMISSION_RULE_STATUS,normalizeReturnDeductions,commissionAfterReturns} from '../validation-v12/assets/commission-rules-d37.mjs';
const id=n=>'10000000-1111-4111-8111-'+String(n).padStart(12,'0'),time='2026-10-11T21:00:00Z';
const row=(n,company='TR',amount=4700)=>({id:id(n),month:'2026-06',company,currency:'EUR',reference:'TEST-'+n,
 commission_cents:amount,kind:'excel_explicit_return',source_fingerprint:'a'.repeat(64),source_file:'Source de test.xlsx',
 source_sheet:'June 26',amount_cell:'X'+(n+1),net_formula_cell:'W6',net_formula:'W1-X4',verified_at:time});
const body=rows=>({ok:true,data:{version:'commission_returns_v1',month:'2026-06',scope:'recorded_deductions_only',
 read_at:time,total:rows.length,deductions:rows}});
const group={count:3,forecast:1000,unavailableCount:0,partialCount:0};
const options={month:'2026-06',company:'all',query:'',fresh:true};
test('the owner-confirmed trigger and return rule are independent of calculation completeness',()=>{
 assert.equal(COMMISSION_RULE_STATUS.trigger,'confirmed_order');assert.equal(COMMISSION_RULE_STATUS.triggerVerified,true);
 assert.equal(COMMISSION_RULE_STATUS.returnsPolicy,'subtract_return_commission');assert.equal(COMMISSION_RULE_STATUS.returnsPolicyVerified,true);
 assert.equal(COMMISSION_RULE_STATUS.payable,false);assert.equal(COMMISSION_RULE_STATUS.historicalCostsVerified,false);
});
test('return commissions reduce confirmed commissions once and never use invoice HT',()=>{
 const source=normalizeReturnDeductions(body([row(1,'TR',12345),row(2,'GTA',1000)]),'2026-06');
 const r=commissionAfterReturns(group,source,options);assert.equal(r.grossCents,100000);assert.equal(r.deductionCents,13345);assert.equal(r.netCents,86655);
 assert.equal(r.rows.length,2);assert.equal(r.complete,false);
 assert.equal(commissionAfterReturns(group,source,{...options,company:'TR'}).netCents,87655);
});
test('a return from an earlier order can produce a negative monthly balance without being clamped',()=>{
 const source=normalizeReturnDeductions(body([row(1,'TR',12345)]),'2026-06');
 const empty={count:0,forecast:null,unavailableCount:0,partialCount:0};
 const r=commissionAfterReturns(empty,source,options);assert.equal(r.grossCents,0);assert.equal(r.netCents,-12345);
});
test('missing gross, read failure, another month and filtered searches never produce a final amount',()=>{
 const source=normalizeReturnDeductions(body([row(1)]),'2026-06');
 for(const [g,s,o] of [[{...group,forecast:null},source,options],[group,null,options],[group,source,{...options,fresh:false}],
  [group,source,{...options,month:'2026-07'}],[group,source,{...options,query:'TEST-1'}]])assert.equal(commissionAfterReturns(g,s,o).available,false);
 assert.equal(commissionAfterReturns({...group,partialCount:1},source,options).partial,true);
});
test('duplicate identities and source cells, wrong periods, unsigned source errors and invoice amounts are rejected',()=>{
 const mutations=[rows=>rows.push({...rows[0]}),rows=>rows.push({...rows[0],id:id(2)}),rows=>rows[0].month='2026-05',
  rows=>rows[0].commission_cents=-10,rows=>rows[0].commission_cents=1.5,rows=>rows[0].currency='USD',
  rows=>rows[0].company='OTHER',rows=>rows[0].kind='invoice_amount_ht',rows=>rows[0].verified_at='2026-02-30T12:00:00Z'];
 for(const fn of mutations){const rows=[row(1)];fn(rows);assert.throws(()=>normalizeReturnDeductions(body(rows),'2026-06'))}
 const r=body([row(1)]);r.data.total=2;assert.throws(()=>normalizeReturnDeductions(r,'2026-06'));
});
test('an empty list is recorded coverage and does not certify that no returns exist',()=>{
 const source=normalizeReturnDeductions(body([]),'2026-06'),r=commissionAfterReturns(group,source,options);
 assert.equal(r.netCents,100000);assert.equal(r.complete,false);assert.equal(source.scope,'recorded_deductions_only');
});
