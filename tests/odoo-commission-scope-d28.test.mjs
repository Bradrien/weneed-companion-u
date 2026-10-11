import test from 'node:test';
import assert from 'node:assert/strict';
import {monthPeriod,parseOdooPeriod,odooPeriodDomain} from '../supabase/functions/odoo-commission-pipeline/scope.mjs';
test('current month defaults to bounded 31-day window, not unbounded 365-day history',()=>{
 const period=parseOdooPeriod('https://example.com/functions/v1/odoo-commission-pipeline',new Date('2026-10-11T10:00:00Z'));
 assert.deepEqual(period,{from:'2026-10-01',to:'2026-10-31'});
 assert.deepEqual(monthPeriod(new Date('2024-02-12T12:00:00Z')),{from:'2024-02-01',to:'2024-02-29'});
});
test('selected September and October are constrained to seller, state and both dates',()=>{
 const period=parseOdooPeriod('https://example.com/functions/v1/odoo-commission-pipeline?from=2026-10-01&to=2026-10-31');
 assert.deepEqual(odooPeriodDomain(25,['draft','sent'],period),[
  ['user_id','=',25],['state','in',['draft','sent']],
  ['date_order','>=','2026-10-01 00:00:00'],['date_order','<=','2026-10-31 23:59:59']]);
 assert.deepEqual(parseOdooPeriod('https://example.com/?from=2026-09-01&to=2026-09-30'),
  {from:'2026-09-01',to:'2026-09-30'});
});
test('prevent arbitrary Odoo read windows and unsupported parameters',()=>{
 for(const suffix of ['?foo=1','?from=2026-10-01','?from=2026-10-01&to=2026-10-31&extra=x']){
  assert.throws(()=>parseOdooPeriod('https://example.com/'+suffix),/unsupported_query/);
 }
 for(const suffix of ['?from=2026-10-32&to=2026-11-01',
  '?from=2026-02-30&to=2026-03-01','?from=2026-10-20&to=2026-10-01',
  '?from=2025-01-01&to=2026-10-01','?from=2026-10-01&to=2026-10-XX']){
  assert.throws(()=>parseOdooPeriod('https://example.com/'+suffix),/invalid_period/);
 }
 assert.throws(()=>odooPeriodDomain(0,['draft'],{from:'2026-10-01',to:'2026-10-31'}),/invalid_period/);
 assert.throws(()=>odooPeriodDomain(1,['cancel'],{from:'2026-10-01',to:'2026-10-31'}),/invalid_period/);
});
