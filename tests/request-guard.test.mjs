import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequestGuard} from '../assets/request-guard.mjs';
test('an old month cannot replace a newer response',async()=>{
  const gate=createRequestGuard();const september=gate.begin();gate.invalidate();const october=gate.begin();
  let visible=null;
  const complete=(ticket,value)=>{if(gate.isCurrent(ticket))visible=value;};
  complete(october,'October');await Promise.resolve();complete(september,'September');
  assert.equal(visible,'October');
});
test('sign-out invalidates pending reports even after signing back in',()=>{
  const gate=createRequestGuard();const oldSession=gate.begin();gate.invalidate();
  assert.equal(gate.isCurrent(oldSession),false);
  assert.equal(gate.isCurrent(gate.begin()),true);
});
