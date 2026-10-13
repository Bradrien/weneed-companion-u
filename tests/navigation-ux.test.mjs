import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createNavigation} from '../validation-v12/assets/navigation-ux.mjs';
const id='11111111-1111-4111-8111-111111111111';
function browser(){
 const handlers={},entries=[{url:'https://example.test/validation-v12/?v=test',state:null}];let index=0;
 const win={scrollY:0,location:{href:entries[0].url},addEventListener:(name,fn)=>handlers[name]=fn};
 win.history={get state(){return entries[index].state},replaceState(state,_,url){entries[index]={state,url};win.location.href=url},pushState(state,_,url){entries.splice(++index);entries.push({state,url});win.location.href=url}};
 return {win,entries,back:async()=>{index--;win.location.href=entries[index].url;await handlers.popstate()},forward:async()=>{index++;win.location.href=entries[index].url;await handlers.popstate()}};
}
test('view navigation supports Back/Forward and preserves scroll without putting names into URLs',async()=>{
 const b=browser(),restored=[],nav=createNavigation({win:b.win,onRestore:r=>restored.push(r)});
 nav.write('home');b.win.scrollY=184;nav.write('clients');b.win.scrollY=260;nav.write('clients',id);
 assert.equal(b.entries.length,3);assert.equal(new URL(b.win.location.href).searchParams.get('view'),'clients');assert.ok(!b.win.location.href.includes(id));
 await b.back();assert.deepEqual(restored.at(-1),{view:'clients',client:null,scroll:260});
 await b.back();assert.deepEqual(restored.at(-1),{view:'home',client:null,scroll:184});
 await b.forward();await b.forward();assert.equal(restored.at(-1).client,id);
});
test('duplicate routes do not grow history; invalid client IDs and views are ignored',()=>{
 const b=browser(),nav=createNavigation({win:b.win,onRestore:()=>{}});nav.write('clients','client name');nav.write('clients',null);
 assert.equal(b.entries.length,1);assert.equal(b.win.history.state.companion.client,null);nav.write('javascript:alert(1)');assert.equal(b.entries.length,1);
 nav.reset();assert.equal(b.win.history.state,null);
});
test('a later user navigation invalidates an unfinished restoration',async()=>{
 const b=browser();let release,valid;
 const nav=createNavigation({win:b.win,onRestore:async(r,isCurrent)=>{await new Promise(resolve=>release=resolve);valid=isCurrent()}});
 nav.write('home');nav.write('orders');const pending=b.back();nav.write('tasks');release();await pending;
 assert.equal(valid,false);assert.equal(new URL(b.win.location.href).searchParams.get('view'),'tasks');
});
