import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeConnectorStatus,connectorHealth,connectorIncident} from '../validation-v12/assets/connector-status-model-d34.mjs';
import {normalizeStockSnapshot} from '../validation-v12/assets/stock-model-d34.mjs';
import {sourceTime} from '../validation-v12/assets/source-state-d34.mjs';
const time='2026-10-11T13:00:00.000Z',now=Date.parse(time)+60000;
const connector=(changes={})=>({source:'gmail',sync_in_progress:false,continuation_pending:false,last_run_status:'success',
 coverage_from:'2026-10-11T06:55:00Z',watermark_at:time,last_success_at:time,last_run_started_at:time,
 last_run_finished_at:time,last_error:null,inserted_count:0,duplicate_count:0,skipped_count:0,failed_count:0,...changes});
const health=(changes={},clock=now)=>connectorHealth(normalizeConnectorStatus([connector(changes)])[0],clock);
test('three named source cards are required, unknown sources do not masquerade as Google coverage',()=>{
 const rows=normalizeConnectorStatus([connector(),{source:'whatsapp_cloud'}]);
 assert.deepEqual(rows.map(r=>r.source),['gmail','google_chat','google_drive']);
 assert.equal(connectorHealth(rows[0],now).kind,'current');assert.equal(connectorHealth(rows[1],now).kind,'missing');
 assert.throws(()=>normalizeConnectorStatus([connector(),connector()]),/invalid_connector_status/);
});
test('a complete empty run is healthy; a legacy success does not invent historical coverage',()=>{
 assert.equal(health().kind,'current');
 const row=normalizeConnectorStatus([connector({watermark_at:null,coverage_from:null})])[0];
 assert.equal(row.coverageKnown,false);assert.equal(connectorHealth(row,now).kind,'unknown');
 assert.equal(row.counts.inserted_count,0);assert.equal(row.counts.pages_count,null);
});
test('pending pages, failed runs, late watermarks and future clocks stay distinguishable',()=>{
 assert.equal(health({continuation_pending:true}).kind,'pending');
 assert.equal(health({last_run_status:'partial'}).kind,'pending');
 assert.equal(health({sync_in_progress:true,continuation_pending:true}).kind,'running');
 assert.equal(health({last_run_status:'failed'}).kind,'failed');
 assert.equal(health({failed_count:1}).kind,'failed');
 assert.equal(health({},now+900000).kind,'late');
 assert.equal(health({},Date.parse(time)-300001).kind,'clock');
 assert.equal(health({last_error:'google_request_failed'}).kind,'failed');
 assert.equal(health({last_error:'drive_text_too_large',limited_count:1}).kind,'current');
});
test('bad counts, contradictory coverage and impossible timestamps cannot make a healthy source',()=>{
 for(const change of [{inserted_count:'0'},{failed_count:-1},{sync_in_progress:'false'},{last_run_status:'successish'},
  {coverage_from:'2026-10-12T00:00:00Z'},{watermark_at:'2026-02-30T12:00:00Z'}])
  assert.throws(()=>normalizeConnectorStatus([connector(change)]));
 for(const value of ['',0,'2026-10-11','2026-13-01T00:00:00Z','2026-02-29T00:00:00Z','2026-10-11T24:00:00Z'])assert.throws(()=>sourceTime(value));
 assert.equal(sourceTime('2026-10-11T13:00:00.123456+00:00'),'2026-10-11T13:00:00.123456+00:00');
 assert.equal(sourceTime(null),null);
});
test('source incident messages never reproduce a raw provider error',()=>{
 const secret='private-person@example.test token=secret';assert.ok(!connectorIncident(secret).includes(secret));
 assert.match(connectorIncident('google_token_refresh_failed'),/connexion Google/);
 assert.match(connectorIncident('drive_search_incomplete'),/incomplète/);
});
const item=(company='TR',id=1)=>({company,product_id:id,sku:'TEST/G',product_name:'Produit de test',unit:'g',quantity_basis:'free_qty',
 available_quantity:-1.125,on_hand_quantity:2.5,forecast_quantity:null,checked_at:time});
const snapshot=(changes={})=>({checked_at:time,stale:false,last_error:null,scan_interval_minutes:5,total:1,
 summary:[{company:'TR',products:1,out_of_stock:1},{company:'GTA',products:1,out_of_stock:0}],items:[item()],alerts:[],...changes});
const scope={company:'TR',query:'',offset:0};
test('stock data preserves fractional and negative availability and global company summaries',()=>{
 const r=normalizeStockSnapshot(snapshot(),scope,now);
 assert.equal(r.items[0].available,-1.125);assert.equal(r.items[0].onHand,2.5);assert.equal(r.items[0].forecast,null);
 assert.equal(r.summary.length,2);assert.equal(r.total,1);assert.equal(r.stale,false);
 assert.equal(r.scope.company,'TR');
});
test('a company response, page or snapshot from another search is rejected',()=>{
 for(const r of [snapshot({items:[item('GTA')]}),snapshot({items:[]}),snapshot({total:2}),
  snapshot({items:[{...item(),checked_at:'2026-10-11T12:00:00Z'}]})])
  assert.throws(()=>normalizeStockSnapshot(r,scope,now));
 assert.throws(()=>normalizeStockSnapshot(snapshot(),{...scope,offset:50},now));
 const all=snapshot({total:2,items:[item('TR'),item('GTA')]});
 assert.equal(normalizeStockSnapshot(all,{...scope,company:'ALL'},now).items.length,2);
 const found=snapshot({total:0,items:[]});assert.equal(normalizeStockSnapshot(found,{...scope,query:'Absent'},now).total,0);
});
test('page boundaries enforce 50 unique items and accurate result counts',()=>{
 const items=Array.from({length:50},(_,i)=>item('TR',i+1));
 const r=snapshot({total:51,summary:[{company:'TR',products:51,out_of_stock:51},{company:'GTA',products:1,out_of_stock:0}],items});
 assert.equal(normalizeStockSnapshot(r,scope,now).items.length,50);
 const last={...r,items:[item('TR',51)]};assert.equal(normalizeStockSnapshot(last,{...scope,offset:50},now).items.length,1);
 const duplicate=structuredClone(r);duplicate.items[1]=duplicate.items[0];assert.throws(()=>normalizeStockSnapshot(duplicate,scope,now));
});
test('client time also marks old quantities stale and an empty monitor never appears current',()=>{
 assert.equal(normalizeStockSnapshot(snapshot(),scope,Date.parse(time)+720001).stale,true);
 const empty=snapshot({checked_at:null,summary:null,total:0,items:[]});assert.equal(normalizeStockSnapshot(empty,scope,now).stale,true);
 assert.throws(()=>normalizeStockSnapshot(snapshot({checked_at:null}),scope,now));
 assert.throws(()=>normalizeStockSnapshot(snapshot(),scope,Date.parse(time)-300001));
 assert.equal(normalizeStockSnapshot(snapshot({last_error:'stock_scan_failed'}),scope,now).lastError,true);
});
test('stock quantities cannot be coerced, alerts cannot cross the company scope or pretend to be changes',()=>{
 for(const available_quantity of ['0',null,Infinity,NaN])assert.throws(()=>normalizeStockSnapshot(snapshot({items:[{...item(),available_quantity}]}),scope,now));
 const alert={id:'test-alert',company:'TR',product_name:'Produit',unit:'g',kind:'back_in_stock',previous_quantity:0,current_quantity:2,created_at:time};
 assert.equal(normalizeStockSnapshot(snapshot({alerts:[alert]}),scope,now).alerts[0].current,2);
 for(const change of [{company:'GTA'},{kind:'unknown'},{current_quantity:'2'},{created_at:null},{current_quantity:-1},{previous_quantity:1}])
  assert.throws(()=>normalizeStockSnapshot(snapshot({alerts:[{...alert,...change}]}),scope,now));
});
