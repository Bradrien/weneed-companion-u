import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const core=require('../kino-bridge/search-core.js');
const source=fs.readFileSync(new URL('../kino-bridge/content.js',import.meta.url),'utf8');

test('suggestions distinguish the same SKU in GTA and TR',()=>{
  assert.deepEqual(core.classify('DEMO/I GTA Example flower','DEMO/I'),
    {sku:'DEMO/I',company:'GTA',name:'Example flower',text:'DEMO/I GTA Example flower',exact:true});
  assert.equal(core.classify('DEMO/I TR Example flower','DEMO/I').company,'TR');
});
for(const label of ['Toutes les catégories','Catégorie A','Catégorie B','GTA','TR','DEMO/I','DEMO/I GTA',
  'DEMO/I Example flower','X/I GTA Example flower','DEMO/I GTA Example X/I TR Other']){
  test(`reject unrelated or ambiguous label: ${label}`,()=>assert.equal(core.classify(label,'DEMO/I'),null));
}
test('partial matches are distinguished from the exact SKU',()=>{
  assert.equal(core.classify('DEMO/I/Sample GTA Sample flower','DEMO/I').exact,false);
  assert.equal(core.classify('demo/i\u202fGTA\nExample flower','DEMO/I').exact,true);
});
test('reject unsupported search strings and overlong labels',()=>{
  for(const query of ['',null,'<script>', 'A'.repeat(65)])assert.equal(core.classify('DEMO/I GTA Flower',query),null);
  assert.equal(core.classify('DEMO/I GTA '+'a'.repeat(180),'DEMO/I'),null);
});

// A minimal DOM double: these are simulated tests, not browser/React verification.
function harness({labels=[],existing='',hidden=[],disabled=[],duringWait,hostname='kinocommission.base44.app',replacement=false,failClear=false}={}){
  let value=existing;let writes=[];let clicks=0;let onMessage;let waited=false;
  class Input{
    isConnected=true;
    get value(){return value;}
    set value(v){if(v===''&&failClear)throw Error('clear failed');value=v;writes.push(v);}
    getAttribute(name){return name==='placeholder'?'Ajouter un produit par nom ou code…':null;}
    getClientRects(){return [{}];}
    getBoundingClientRect(){return {top:10,bottom:40,left:0,right:500};}
    dispatchEvent(){}
    focus(){}
    blur(){}
  }
  const input=new Input();
  const candidates=labels.map((text,i)=>({innerText:text,tagName:'BUTTON',disabled:disabled.includes(i),
    getClientRects:()=>hidden.includes(i)?[]:[{}],getAttribute:()=>null,closest:()=>null,
    getBoundingClientRect:()=>({top:50+i*30,bottom:75+i*30,left:0,right:300,width:300,height:25}),
    click:()=>{clicks++;}}));
  const context=vm.createContext({KinoSearch:core,document:{title:'Kino Commission',
    querySelectorAll:selector=>selector.startsWith('input')?[input]:candidates},
    location:{hostname},window:{HTMLInputElement:Input},getComputedStyle:()=>({visibility:'visible',display:'block'}),
    InputEvent:class{},Event:class{},setTimeout:fn=>queueMicrotask(()=>{
      if(!waited){waited=true;if(duringWait)value=duringWait;if(replacement)input.isConnected=false;}fn();}),
    chrome:{runtime:{onMessage:{addListener:fn=>{onMessage=fn;}}}}});
  vm.runInContext(source,context);
  return {context,input,writes,clicks:()=>clicks,probe:query=>context.probeSearch(query),
    message:message=>new Promise(resolve=>onMessage(message,{},resolve))};
}
test('DOM probe ignores catalogue filters and restores the empty search',async()=>{
  const h=harness({labels:['Toutes les catégories','Catégorie A','Catégorie B','DEMO/I GTA Example','DEMO/I TR Example']});
  const r=await h.probe('DEMO/I');
  assert.equal(r.ok,true);assert.equal(r.result.search.candidates.length,2);
  assert.equal(r.result.search.restore_status,'cleared');assert.equal(h.input.value,'');
  assert.deepEqual(h.writes,['DEMO/I','']);assert.equal(h.clicks(),0);
});
test('no matches is reported without treating filters as suggestions',async()=>{
  const h=harness({labels:['Toutes les catégories','Catégorie A']});
  assert.equal((await h.probe('DEMO/I')).result.search.mode,'no_matches');
});
test('never overwrite a pre-existing user search',async()=>{
  const h=harness({existing:'draft'});
  assert.equal((await h.probe('DEMO/I')).error,'search_field_not_empty');assert.equal(h.writes.length,0);
});
test('never erase user input arriving during the asynchronous probe',async()=>{
  const h=harness({duringWait:'my new search'});
  assert.equal((await h.probe('DEMO/I')).error,'search_interrupted_by_user');
  assert.equal(h.input.value,'my new search');assert.deepEqual(h.writes,['DEMO/I']);
});
test('simultaneous probes refuse a second operation',async()=>{
  const h=harness();const first=h.probe('DEMO/I');
  assert.equal((await h.probe('X/I')).error,'search_probe_busy');await first;
});
test('catalogue and search operations cannot race',async()=>{
  const h=harness();vm.runInContext('catalogBusy=true',h.context);
  assert.equal((await h.probe('DEMO/I')).error,'search_probe_busy');
});
test('hidden and disabled products are not selectable suggestions',async()=>{
  const h=harness({labels:['DEMO/I GTA Hidden','DEMO/I TR Disabled'],hidden:[0],disabled:[1]});
  assert.equal((await h.probe('DEMO/I')).result.search.candidates.length,0);
});
test('duplicate nested labels do not inflate the candidate count',async()=>{
  const h=harness({labels:['DEMO/I GTA Flower','DEMO/I GTA Flower']});
  assert.equal((await h.probe('DEMO/I')).result.search.candidates.length,1);
});
test('failed cleanup is never reported as a successful probe',async()=>{
  assert.equal((await harness({failClear:true}).probe('DEMO/I')).error,'search_field_restore_failed');
});
test('a re-rendered input prevents reporting stale suggestions',async()=>{
  assert.equal((await harness({replacement:true}).probe('DEMO/I')).ok,false);
});
test('non-Kino pages fail closed',async()=>{
  const h=harness({hostname:'example.com'});
  assert.equal((await h.probe('DEMO/I')).error,'not_kino');assert.equal(h.writes.length,0);
});
test('runtime message reaches the tested probe',async()=>{
  assert.equal((await harness().message({type:'KINO_SIMULATOR_SEARCH_PROBE',sku:'DEMO/I'})).ok,true);
});
test('Chrome permissions stay limited to Kino and the existing Supabase project',()=>{
  const manifest=JSON.parse(fs.readFileSync(new URL('../kino-bridge/manifest.json',import.meta.url)));
  assert.deepEqual(manifest.permissions,['storage','alarms']);
  assert.deepEqual(manifest.host_permissions,['https://kinocommission.base44.app/*','https://gcirlrghjvumhkekrtmf.supabase.co/*']);
  assert.deepEqual(manifest.content_scripts[0].matches,['https://kinocommission.base44.app/*']);
  assert.deepEqual(manifest.content_scripts[0].js,['search-core.js','content.js']);
  assert.equal(manifest.content_scripts[0].world,undefined);
});
test('catalogue pagination labels reject business actions',()=>{
  const {context:c}=harness();
  for(const label of ['Afficher 1335 de plus','Show 1335 more','Mostra altri 1335'])assert.equal(c.isCatalogExpandLabel(label),true);
  for(const label of ['Supprimer 1335 produits','Exporter tous les produits','Réinitialiser','GTA'])assert.equal(c.isCatalogExpandLabel(label),false);
});
test('catalogue amounts preserve decimal precision and reject negatives',()=>{
  const {context:c}=harness();
  assert.equal(c.euroNumber('1\u202f000,25 €'),1000.25);
  assert.equal(c.euroNumber('0,65 €'),0.65);
  assert.equal(c.euroNumber('-1,00 €'),null);
});

function catalogueHarness({total=1385,stalls=false}={}){
  const h=harness();const c=h.context;let count=50;let clicks=0;
  c.catalogTable=()=>({});
  c.catalogRows=()=>Array.from({length:count},(_,i)=>({sku:`FAKE/${i}`,company:'GTA'}));
  c.totalProductCount=()=>total;
  c.showMoreButton=()=>count<total?{label:`Afficher ${total-count} de plus`,el:{click(){clicks++;if(!stalls)count=Math.min(count+50,total);}}}:null;
  c.expandCandidates=()=>[];c.catalogPageButtons=()=>[];
  return {c,clicks:()=>clicks};
}
test('catalogue collection traverses all 1385 simulated products',async()=>{
  const h=catalogueHarness();const r=await h.c.collectCatalog();
  assert.equal(r.ok,true);assert.equal(r.result.catalog.collected_count,1385);
  assert.equal(r.result.catalog.status,'complete');assert.equal(h.clicks(),27);
});
test('catalogue pagination stops after a stalled page',async()=>{
  const h=catalogueHarness({stalls:true});const r=await h.c.collectCatalog();
  assert.equal(r.result.catalog.status,'partial');assert.equal(h.clicks(),1);
  assert.equal(r.result.catalog.diagnostics.stop_reason,'clicked_but_no_new_rows');
});
test('catalogue collection enforces its 1500-row safety bound',async()=>{
  const h=catalogueHarness({total:2500});const r=await h.c.collectCatalog();
  assert.equal(r.result.catalog.status,'partial');assert.equal(r.result.catalog.collected_count,1500);
  assert.equal(r.result.catalog.diagnostics.stop_reason,'catalog_safety_limit');
});
test('catalogue collection releases its lock after an error',async()=>{
  const h=catalogueHarness();h.c.catalogRows=()=>{throw Error('dom changed');};
  assert.equal((await h.c.collectCatalog()).error,'catalog_collection_failed');
  assert.equal((await h.c.collectCatalog()).error,'catalog_collection_failed');
});

function backgroundHarness(){
  let listener;const messages=[];
  const c=vm.createContext({importScripts:()=>{},KinoSearch:core,
    chrome:{runtime:{onMessage:{addListener:fn=>listener=fn},onInstalled:{addListener(){}},onStartup:{addListener(){}}},
      alarms:{onAlarm:{addListener(){}},create(){}},
      tabs:{query:async()=>[{id:1,status:'complete'}],sendMessage:async(id,message)=>{
        messages.push(message);return {ok:true,result:{search:{query_sku:message.sku,candidates:[]}}};
      }}}});
  vm.runInContext(fs.readFileSync(new URL('../kino-bridge/background.js',import.meta.url),'utf8'),c);
  return {messages,send:(message,sender={})=>new Promise(resolve=>listener(message,sender,resolve))};
}
test('popup search forwards the chosen SKU through the service worker',async()=>{
  const h=backgroundHarness();const r=await h.send({type:'SEARCH_LOCAL',sku:'DEMO/OTHER'});
  assert.equal(r.ok,true);assert.equal(r.summary.sku,'DEMO/OTHER');
  assert.equal(h.messages[0].sku,'DEMO/OTHER');
});
test('invalid popup SKU never reaches the Kino content script',async()=>{
  const h=backgroundHarness();assert.equal((await h.send({type:'SEARCH_LOCAL',sku:'<invalid>'})).ok,false);
  assert.equal(h.messages.length,0);
});
test('page content cannot invoke popup search commands',async()=>{
  const h=backgroundHarness();assert.equal((await h.send({type:'SEARCH_LOCAL',sku:'DEMO/I'},{tab:{id:1}})).ok,false);
  assert.equal(h.messages.length,0);
});
