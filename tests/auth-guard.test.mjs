import test from 'node:test';
import assert from 'node:assert/strict';
import {createRefreshGate} from '../assets/auth-guard.mjs';
const deferred=()=>{let resolve;let reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject}};
test('concurrent refresh operations share a single request',async()=>{
 const gate=createRefreshGate();const response=deferred();let calls=0;
 const refresh=()=>gate.run(async current=>{calls++;await response.promise;if(!current())throw Error('stale');return 'new-token'});
 const first=refresh(),second=refresh();
 assert.equal(first,second);
 await Promise.resolve();
 assert.equal(calls,1);
 response.resolve();
 assert.equal(await first,'new-token');
 assert.equal(await second,'new-token');
 assert.equal(await refresh(),'new-token');
 assert.equal(calls,2);
});
test('logout invalidates a pending refresh before it can restore credentials',async()=>{
 const gate=createRefreshGate();const response=deferred();
 let restored=false;
 const task=gate.run(async current=>{
  await response.promise;
  if(current())restored=true;
 });
 await Promise.resolve();
 gate.invalidate();
 response.resolve();
 await task;
 assert.equal(restored,false);
});
test('new session can refresh before a stale previous request finishes',async()=>{
 const gate=createRefreshGate();
 const old=deferred(),fresh=deferred();
 const first=gate.run(async current=>{await old.promise;return current()?'old-token':null});
 await Promise.resolve();gate.invalidate();
 const second=gate.run(async current=>{await fresh.promise;return current()?'fresh-token':null});
 fresh.resolve();assert.equal(await second,'fresh-token');
 old.resolve();assert.equal(await first,null);
});
test('failed refresh releases gate and permits retry',async()=>{
 const gate=createRefreshGate();
 await assert.rejects(gate.run(async()=>{throw Error('network-failed')}));
 assert.equal(await gate.run(async()=>7),7);
});
