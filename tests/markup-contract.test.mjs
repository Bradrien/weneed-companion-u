import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
test('all literal UI element IDs used in JS exist in HTML',()=>{
 const html=read('index.html'),script=read('assets/app.js');
 const ids=new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]));
 const referenced=new Set([...script.matchAll(/\$\('([^']+)'\)/g)].map(m=>m[1]));
 const missing=[...referenced].filter(id=>!ids.has(id));
 assert.deepEqual(missing,[]);
});
test('every main navigation destination has a corresponding view',()=>{
 const html=read('index.html');
 const navs=[...html.matchAll(/data-nav="([^"]+)"/g)].map(m=>m[1]);
 assert.deepEqual(new Set(navs),new Set(['home','orders','clients','commissions','settings']));
 for(const view of navs)assert.match(html,new RegExp('id="view-'+view+'"'));
});
test('client UI avoids HTML injection APIs',()=>{
 const script=read('assets/app.js');
 assert.equal(/\.innerHTML\s*=/.test(script),false);
 assert.equal(/document\.write\(/.test(script),false);
});
test('local app module imports exist',()=>{
 const source=read('assets/app.js');
 for(const m of source.matchAll(/from '\.\/(.+?)'/g)){
  assert.ok(existsSync(fileURLToPath(new URL('../assets/'+m[1],import.meta.url))),m[1]);
 }
});
