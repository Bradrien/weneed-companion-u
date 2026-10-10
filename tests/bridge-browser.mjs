/** Real MV3 extension + Chromium, synthetic Kino DOM only. No production requests or credentials. */
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {chromium} from 'playwright';

const extension=resolve(new URL('../kino-bridge',import.meta.url).pathname);
const profile=await mkdtemp(join(tmpdir(),'kino-bridge-test-'));
const html=`<!doctype html><html><head><title>Kino Commission</title><link rel="icon" href="data:,"><style>
body{font:16px sans-serif;margin:24px}input{width:400px;height:36px}
#results{width:400px}.item,button{display:block;padding:8px;min-height:20px}
</style></head><body><h1>Kino Commission — fixture synthétique</h1>
<input id="query" placeholder="Ajouter un produit par nom ou code…"><div id="results"></div>
<output id="selected">0</output><script>
window.fixture={selected:0,events:[],delay:100};
const input=document.querySelector('#query'),results=document.querySelector('#results');
let timer;
input.addEventListener('input',()=>{
 fixture.events.push(input.value);clearTimeout(timer);results.replaceChildren();
 if(!input.value)return;
 timer=setTimeout(()=>{
  results.innerHTML='<button>Toutes les catégories</button><button>Catégorie A</button>';
  if(!input.value.startsWith('DEMO/'))return;
  for(const [tag,attr,label] of [
    ['div','role="button"','DEMO/I GTA Synthetic flower'],
    ['div','class="cursor-pointer"','DEMO/I TR Synthetic flower'],
    ['li','','DEMO/I/Sample GTA Synthetic sample']]){
    const row=document.createElement(tag);row.className='item';
    if(attr.startsWith('role'))row.setAttribute('role','button');
    if(attr.startsWith('class'))row.classList.add('cursor-pointer');
    row.textContent=label;row.onclick=()=>{fixture.selected++;document.querySelector('#selected').textContent=fixture.selected;};
    results.append(row);
  }
 },fixture.delay);
});
</script></body></html>`;

let context;
try{
 context=await chromium.launchPersistentContext(profile,{channel:'chromium',headless:true,
  args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
 context.setDefaultTimeout(10000);
 const external=[];
 await context.route('**/*',async route=>{
  if(route.request().url().startsWith('chrome-extension://')){await route.continue();return;}
  if(route.request().url()==='https://kinocommission.base44.app/'){
   await route.fulfill({contentType:'text/html',body:html});return;
  }
  external.push(route.request().url());await route.abort();
 });
 const worker=context.serviceWorkers().find(w=>w.url().startsWith('chrome-extension://'))||
  await context.waitForEvent('serviceworker',{predicate:w=>w.url().startsWith('chrome-extension://')});
 await worker.evaluate(async()=>{
  for(let i=0;i<100&&!globalThis.chrome?.alarms?.clearAll;i++)await new Promise(resolve=>setTimeout(resolve,50));
  if(!globalThis.chrome?.alarms?.clearAll)throw Error('Extension bindings not ready');
  await chrome.alarms.clearAll();
  await chrome.storage.session.set({session:{access_token:'synthetic-not-a-token',expires_at_ms:Date.now()+3600000}});
 });
 const kino=await context.newPage();const errors=[];
 kino.on('pageerror',err=>errors.push(err.message));
 await kino.goto('https://kinocommission.base44.app/');
 const popup=await context.newPage();
 popup.on('pageerror',err=>errors.push(err.message));
 await popup.goto(`chrome-extension://${new URL(worker.url()).hostname}/popup.html`);
 try{await popup.locator('#signed').waitFor({state:'visible'});}
 catch(error){
  console.log('Synthetic popup diagnostics:',JSON.stringify({info:await popup.locator('#info').innerText(),errors,external,
   status:await popup.evaluate(()=>chrome.runtime.sendMessage({type:'STATUS'})),
   hasSyntheticSession:await worker.evaluate(async()=>Boolean((await chrome.storage.session.get('session')).session?.access_token))}));
  throw error;
 }
 const send=(sku)=>popup.evaluate(sku=>chrome.runtime.sendMessage({type:'SEARCH_LOCAL',sku}),sku);
 // Exercises real popup event, service worker and isolated content script.
 await popup.locator('#search-sku').fill('DEMO/I');
 await popup.locator('#search').click();
 await popup.waitForFunction(()=>!document.querySelector('#search').disabled);
 assert.match(await popup.locator('#info').innerText(),/Suggestions : 3/);
 assert.equal(await kino.locator('#query').inputValue(),'');
 assert.equal(await kino.locator('#selected').innerText(),'0');
 assert.deepEqual(await kino.evaluate(()=>fixture.events),['DEMO/I','']);
 assert.equal(await kino.evaluate(()=>typeof window.KinoSearch),'undefined','parser must remain in the isolated extension world');
 console.log('PASS MV3 popup, worker, isolated script, v0.6 suggestion shapes and cleanup');

 const empty=await send('MISSING/I');
 assert.equal(empty.ok,true);assert.equal(empty.summary.count,0);
 await kino.locator('#query').fill('user draft');
 assert.equal((await send('DEMO/I')).error,'search_field_not_empty');
 assert.equal(await kino.locator('#query').inputValue(),'user draft');
 await kino.locator('#query').fill('');

 const pending=send('DEMO/I');
 await kino.waitForFunction(()=>document.querySelector('#query').value==='DEMO/I');
 const busy=await send('OTHER/I');assert.equal(busy.error,'search_probe_busy');
 await kino.locator('#query').fill('new user draft');
 assert.equal((await pending).error,'search_interrupted_by_user');
 assert.equal(await kino.locator('#query').inputValue(),'new user draft');
 assert.equal(await kino.locator('#selected').innerText(),'0');
 assert.deepEqual(errors,[]);assert.deepEqual(external,[],'test must never access production');
 console.log('PASS empty result, existing draft, concurrent search, interruption; no product selected or network request');
}finally{
 if(context)await context.close();
 await rm(profile,{recursive:true,force:true});
}
