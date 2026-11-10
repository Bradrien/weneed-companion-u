import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=process.env.BRIDGE_TEST_ROOT || path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../kino-bridge');
const source=fs.readFileSync(process.env.BRIDGE_TEST_SOURCE || path.join(root,'background.js'),'utf8');
function harness(tabs,respond){
  const sent=[],network=[],stored={session:{access_token:'test-only',expires_at_ms:Date.now()+3600000}};
  let listener;
  const chrome={
    runtime:{id:'test-extension',getURL:p=>'chrome-extension://test-extension/'+p,
      onMessage:{addListener:f=>listener=f},onInstalled:{addListener:()=>{}},onStartup:{addListener:()=>{}}},
    storage:{session:{get:async()=>stored,set:async v=>Object.assign(stored,v),remove:async k=>delete stored[k]}},
    tabs:{query:async()=>tabs,sendMessage:async(id,message)=>{sent.push({id,...message});return respond(id,message);}},
    alarms:{create:async()=>{},onAlarm:{addListener:()=>{}}}
  };
  const context=vm.createContext({chrome,Date,console,importScripts:()=>{},fetch:async(url)=>{
    network.push(url); return {ok:true,json:async()=>({ok:true,job:null})};
  }});
  vm.runInContext(source,context);
  const send=(type,sender={id:'test-extension',url:'chrome-extension://test-extension/popup.html'})=>
    new Promise(resolve=>listener({type},sender,resolve));
  return {send,sent,network,stored};
}
const snapshot={ok:true,result:{page_title:'Kino Commission',section_headings:[],buttons:[]}};
test('skips an old tab without a receiver and uses a responding tab',async()=>{
  const h=harness([{id:1,status:'complete'},{id:2,status:'complete'}],id=>{
    if(id===1)throw Error('Receiving end does not exist');return snapshot;
  });
  const r=await h.send('INSPECT_LOCAL');
  assert.equal(r.ok,true);
  assert.deepEqual(h.sent.map(x=>x.id),[1,2]);
  assert.equal(h.network.length,0);
});
test('prefers the active Kino tab even when another responding tab is first',async()=>{
  const h=harness([{id:1,status:'complete',lastAccessed:999},{id:2,status:'complete',active:true}],()=>snapshot);
  assert.equal((await h.send('INSPECT_LOCAL')).ok,true);
  assert.deepEqual(h.sent.map(x=>x.id),[2]);
});
test('uses the same selected tab for the local catalog and does not upload it',async()=>{
  const h=harness([{id:1,status:'complete'},{id:2,status:'complete'}],(id,m)=>{
    if(id===1)throw Error('No receiver');
    if(m.type==='KINO_INSPECT')return snapshot;
    return {ok:true,result:{catalog:{rows:[{sku:'TEST',company:'GTA'}],collected_count:1,expected_count:1,status:'complete'}}};
  });
  const r=await h.send('CATALOG_LOCAL');
  assert.equal(r.ok,true);
  assert.deepEqual(h.sent.map(x=>[x.id,x.type]),[[1,'KINO_INSPECT'],[2,'KINO_INSPECT'],[2,'KINO_CATALOG_SNAPSHOT']]);
  assert.equal(h.network.length,0);
});
test('polls the remote queue when a later Kino tab responds',async()=>{
  const h=harness([{id:1,status:'complete'},{id:2,status:'complete'}],id=>{
    if(id===1)throw Error('No receiver');return snapshot;
  });
  await h.send('CHECK');
  assert.equal(h.network.length,1);
  assert.match(h.network[0],/kino-bridge\?op=poll$/);
});
test('reports missing receivers without contacting the server or exposing raw error text',async()=>{
  const h=harness([{id:1,status:'complete'}],()=>{throw Error('sensitive browser detail');});
  await h.send('CHECK');
  assert.equal(h.stored.bridgeStatus.error,'kino_receiver_unavailable');
  assert.doesNotMatch(h.stored.bridgeStatus.message,/sensitive browser detail/);
  assert.equal(h.network.length,0);
});
test('distinguishes a responding script whose inspection failed',async()=>{
  const h=harness([{id:1,status:'complete'}],()=>({ok:false,error:'dom_inspection_failed'}));
  await h.send('CHECK');
  assert.equal(h.stored.bridgeStatus.error,'kino_inspection_failed');
});
test('distinguishes a missing tab and a loading tab',async()=>{
  for(const [tabs,expected] of [[[],'kino_tab_missing'],[[{id:1,status:'loading'}],'kino_tab_loading']]){
    const h=harness(tabs,()=>snapshot);await h.send('CHECK');
    assert.equal(h.stored.bridgeStatus.error,expected);
    assert.equal(h.sent.length,0);
  }
});
test('bounds inspection attempts to eight tabs',async()=>{
  const h=harness(Array.from({length:20},(_,id)=>({id:id+1,status:'complete'})),()=>{throw Error('No receiver');});
  await h.send('CHECK');assert.equal(h.sent.length,8);
});
test('rejects content-script commands before touching tabs or the queue',async()=>{
  const h=harness([{id:1,status:'complete'}],()=>snapshot);
  const r=await h.send('CHECK',{id:'test-extension',url:'https://kinocommission.base44.app/'});
  assert.equal(r.error,'unsupported_message');assert.equal(h.sent.length,0);assert.equal(h.network.length,0);
});
test('adds no permissions and puts the connection status before the form',()=>{
  const old={permissions:['storage','alarms'],host_permissions:['https://kinocommission.base44.app/*','https://gcirlrghjvumhkekrtmf.supabase.co/*']};
  const current=JSON.parse(fs.readFileSync(path.join(root,'manifest.json'),'utf8'));
  assert.deepEqual(current.permissions,old.permissions);assert.deepEqual(current.host_permissions,old.host_permissions);
  const html=fs.readFileSync(path.join(root,'popup.html'),'utf8');
  assert.ok(html.indexOf('id="info"')<html.indexOf('id="login"'));
});
