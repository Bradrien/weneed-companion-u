import test from 'node:test';
import assert from 'node:assert/strict';
import {cursor,wavDuration,validUuid,validChat} from './core.mjs';
test('reject malformed pagination cursors without accepting injected fields',()=>{
 for(const input of ['not JSON','{}','{"pk":-1,"at":"2026-10-01T00:00:00Z"}','{"pk":2,"at":"invalid"}'])assert.equal(cursor(input),false);
 assert.equal(cursor(null),null);
 assert.deepEqual(cursor('{"pk":2,"at":"2026-10-01T00:00:00Z"}'),{pk:2,at:'2026-10-01T00:00:00Z'});
});
test('reject invalid scope identifiers',()=>{
 assert.equal(validUuid('not-a-client'),false);assert.equal(validUuid('00000000-0000-4000-8000-000000000001'),true);
 for(const n of [-1,1.5,'x',Number.MAX_SAFE_INTEGER+1])assert.equal(validChat(n),false);
});
function wav(seconds=1){const bytes=new Uint8Array(44+32000*seconds),v=new DataView(bytes.buffer);const tag=(at,s)=>bytes.set(new TextEncoder().encode(s),at);tag(0,'RIFF');v.setUint32(4,bytes.length-8,true);tag(8,'WAVE');tag(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,16000,true);v.setUint32(28,32000,true);v.setUint16(32,2,true);v.setUint16(34,16,true);tag(36,'data');v.setUint32(40,bytes.length-44,true);return bytes;}
test('duration derives from actual PCM bytes; corrupted or misleading headers fail',()=>{
 assert.equal(wavDuration(wav(2)),2);
 const wrongRate=wav();new DataView(wrongRate.buffer).setUint32(28,1,true);assert.equal(wavDuration(wrongRate),null);
 const truncated=wav().slice(0,44);assert.equal(wavDuration(truncated),null);
 const stereo=wav();new DataView(stereo.buffer).setUint16(22,2,true);assert.equal(wavDuration(stereo),null);
});
