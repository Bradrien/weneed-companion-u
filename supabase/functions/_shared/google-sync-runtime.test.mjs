import test from 'node:test';
import assert from 'node:assert/strict';
import { createSyncHandler } from './google-sync-runtime.mjs';
import { SyncError } from './google-sync-core.mjs';
const config = {
 SUPABASE_URL:'https://example.test', SUPABASE_SERVICE_ROLE_KEY:'synthetic-service-key',
 GOOGLE_OAUTH_JSON:JSON.stringify({client_id:'fixture',client_secret:'fixture',refresh_token:'fixture'}),
};
const request = token => new Request('https://example.test/functions/v1/gmail-sync',{
 method:'POST',headers:token?{'x-sync-token':token}:{},
});
function fixture({ validToken=true,busy=false,checkpoint=true,tokenError=false }={}) {
 const calls=[];
 const state={last_success_at:'2026-10-11T07:55:00Z',cursor:{}};
 const sb={
  from:()=> {
   const builder={select:()=>builder,eq:()=>builder,in:()=>builder,is:()=>builder,gt:()=>builder,
    maybeSingle:async()=>({data:validToken?{id:'fixture-id',purpose:'gmail_sync_cron'}:null,error:tokenError?{}:null})};
   return builder;
  },
  rpc:async(name,args)=>{calls.push({name,args});return {
   data:name==='claim_connector_sync'?(busy?null:state):name==='checkpoint_connector_sync'?checkpoint:true,error:null,
  };},
 };
 return {sb,calls,state};
}
function handler(f,provider) {return createSyncHandler({
 source:'gmail',createClient:()=>f.sb,createProvider:async()=>provider,
 env:key=>config[key],now:()=> '2026-10-11T08:00:00Z',uuid:()=> '00000000-0000-4000-8000-000000000001',
});}
test('missing/invalid trigger cannot acquire a lease or make a Google request',async t=>{
 let fetches=0;t.mock.method(globalThis,'fetch',async()=>{fetches++;throw Error('unexpected');});
 const f=fixture({validToken:false});
 assert.equal((await handler(f,{})(request())).status,401);
 assert.equal((await handler(f,{})(request('fixture'))).status,401);
 assert.equal(f.calls.length,0);assert.equal(fetches,0);
});
test('busy lease produces a non-error continuation response without an OAuth/API call',async t=>{
 t.mock.method(globalThis,'fetch',async()=>{throw Error('unexpected');});
 const f=fixture({busy:true});
 const response=await handler(f,{})(request('fixture'));
 assert.equal(response.status,202);
 assert.equal((await response.json()).status,'busy');
 assert.equal(f.calls.length,1);
});
test('complete success records only the bounded window watermark and exact counters',async t=>{
 t.mock.method(globalThis,'fetch',async()=>Response.json({access_token:'fixture-access'}));
 const f=fixture();
 const response=await handler(f,{scope:'fixture',fetchPage:async()=>({items:['first','second'],nextPageToken:null}),
  processItem:async id=>id==='first'?'inserted':'duplicate'})(request('fixture'));
 assert.equal(response.status,200);
 const body=await response.json();
 assert.equal(body.complete,true);assert.equal(body.inserted,1);assert.equal(body.duplicates,1);
 const final=f.calls.find(call=>call.name==='finish_connector_sync').args;
 assert.equal(final.p_status,'success');assert.equal(final.p_watermark,'2026-10-11T08:00:00.000Z');
 assert.equal(final.p_cursor.window,null);
 assert.ok(!JSON.stringify(body).includes('fixture-access'));
});
test('failed item produces retryable error with no successful watermark',async t=>{
 t.mock.method(globalThis,'fetch',async()=>Response.json({access_token:'fixture-access'}));
 const f=fixture();
 const response=await handler(f,{scope:'fixture',fetchPage:async()=>({items:['first','failed'],nextPageToken:null}),
  processItem:async id=>{if(id==='failed')throw new SyncError('raw_event_write_failed',503);return 'inserted';}})(request('fixture'));
 assert.equal(response.status,503);
 const final=f.calls.find(call=>call.name==='finish_connector_sync').args;
 assert.equal(final.p_status,'partial');assert.equal(final.p_watermark,null);
 assert.deepEqual(final.p_cursor.window.pending,['failed']);
 assert.equal(final.p_error,'raw_event_write_failed');
});
test('lease loss cannot finish with an advanced cursor',async t=>{
 t.mock.method(globalThis,'fetch',async()=>Response.json({access_token:'fixture-access'}));
 const f=fixture({checkpoint:false});
 const response=await handler(f,{scope:'fixture',fetchPage:async()=>{throw Error('unexpected');},processItem:async()=> 'inserted'})(request('fixture'));
 assert.equal(response.status,409);
 const final=f.calls.find(call=>call.name==='finish_connector_sync').args;
 assert.equal(final.p_cursor,null);assert.equal(final.p_watermark,null);
});
test('OAuth/provider errors are reduced to bounded codes and release the lease',async t=>{
 t.mock.method(globalThis,'fetch',async()=>Response.json({error:'private-account-or-secret'},{status:400}));
 const f=fixture();
 const response=await handler(f,{})(request('fixture'));
 const body=await response.json();
 assert.equal(body.error,'google_token_refresh_failed');
 assert.ok(!JSON.stringify(body).includes('private-account'));
 const final=f.calls.find(call=>call.name==='finish_connector_sync').args;
 assert.equal(final.p_cursor,null);assert.equal(final.p_error,'google_token_refresh_failed');
});

test('metadata-only text limitation is surfaced while a fully drained window advances',async t=>{
 t.mock.method(globalThis,'fetch',async()=>Response.json({access_token:'fixture-access'}));
 const f=fixture();
 const response=await handler(f,{scope:'fixture',fetchPage:async()=>({items:['large','next'],nextPageToken:null}),
  processItem:async id=>id==='large'?{outcome:'inserted',limitation:'drive_text_too_large'}:'inserted'})(request('fixture'));
 const body=await response.json();
 assert.equal(response.status,200);assert.equal(body.complete,true);assert.equal(body.limited,1);
 assert.equal(body.warning,'drive_text_too_large');assert.equal(body.failed,0);
 const final=f.calls.find(call=>call.name==='finish_connector_sync').args;
 assert.equal(final.p_status,'success');assert.equal(final.p_error,'drive_text_too_large');
 assert.equal(final.p_metrics.limited,1);assert.equal(final.p_cursor.window,null);
});
