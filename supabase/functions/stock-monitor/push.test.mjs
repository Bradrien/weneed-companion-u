import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import test from 'node:test';
// Load the actual endpoint validation; omit only the Deno/npm library import.
const source=(await readFile(new URL('./push.mjs',import.meta.url),'utf8')).replace(/^import webpush.*\n/,'const webpush = {};\n');
const {validSubscription}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
const sub=endpoint=>({endpoint,keys:{p256dh:'A'.repeat(87),auth:'B'.repeat(22)}});
for(const host of ['web.push.apple.com','fcm.googleapis.com','updates.push.services.mozilla.com'])test('accept trusted push host '+host,()=>assert.equal(validSubscription(sub('https://'+host+'/abc')),true));
for(const url of ['http://web.push.apple.com/abc','https://web.push.apple.com.evil.test/abc','https://localhost/abc','https://127.0.0.1/abc','https://user:pass@web.push.apple.com/abc','https://web.push.apple.com:8443/abc','https://web.push.apple.com/abc#bad'])test('reject untrusted endpoint '+url,()=>assert.equal(validSubscription(sub(url)),false));
test('reject malformed encryption keys',()=>{const value=sub('https://web.push.apple.com/abc');value.keys.auth='not-base64!';assert.equal(validSubscription(value),false)});
test('reject oversized endpoints',()=>assert.equal(validSubscription(sub('https://web.push.apple.com/'+ 'a'.repeat(2048))),false));
