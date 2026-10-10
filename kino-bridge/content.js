/* Kino Bridge v0.7: read-only DOM observation & public catalog snapshot.
 * This content script runs only on kinocommission.base44.app; it never accesses
 * cookies, localStorage, sessionStorage, passwords, authentication tokens,
 * application internals, network APIs or merchant data mutation routes.
 */
'use strict';
function isVisible(el) {
  if (!el || typeof el.getClientRects !== 'function' || !el.getClientRects().length) return false;
  const css=getComputedStyle(el);
  return css.visibility!=='hidden' && css.display!=='none';
}
function textOf(el,size=140) {
  return String(el?.innerText||el?.textContent||'').replace(/\s+/g,' ').trim().slice(0,size);
}
function unique(arr,limit) {return [...new Set(arr.filter(Boolean))].slice(0,limit);}
function snapshot() {
  const page=document.querySelector('main')||document.body;
  return {
    page_title:String(document.title||'').slice(0,150),
    pathname:location.pathname.slice(0,250),
    section_headings:unique([...document.querySelectorAll('h1,h2,h3,[role="heading"]')].filter(isVisible).map(el=>textOf(el,120)),25),
    buttons:unique([...document.querySelectorAll('button,[role="button"],[role="tab"]')].filter(isVisible).map(el=>textOf(el,150)||el.getAttribute('aria-label')||''),80),
    inputs:unique([...document.querySelectorAll('input,select,textarea')].filter(isVisible).map(el=>[el.tagName.toLowerCase(),(el.getAttribute('type')||''),(el.getAttribute('placeholder')||''),(el.getAttribute('aria-label')||''),(el.getAttribute('id')||'')].join(' | ').slice(0,150)),30),
    table_headers:unique([...document.querySelectorAll('th,[role="columnheader"]')].filter(isVisible).map(el=>textOf(el,100)),30),
    table_rows:[...document.querySelectorAll('tbody tr,[role="row"]')].filter(isVisible).slice(0,12).map(el=>textOf(el,320)),
    visible_excerpt:String(page?.innerText||'').slice(0,4000),
    collection_status:'ok'
  };
}
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function euroNumber(raw) {
  const s=String(raw||'').replace(/[^0-9,.-]/g,'');
  if (!s || s.startsWith('-')) return null;
  // Kino uses Italian/French decimal commas, e.g. 1.000,00 €.
  const fixed=s.includes(',')?s.replace(/\./g,'').replace(',','.') : s;
  if(!/^\d+(?:\.\d{1,2})?$/.test(fixed))return null;
  const n=Number(fixed);
  return Number.isFinite(n)&&n>=0&&n<=10000000?Math.round(n*100)/100:null;
}
function catalogTable() {
  return [...document.querySelectorAll('table')].find(table=>{
    const header=[...table.querySelectorAll('thead th,thead [role="columnheader"]')]
      .map(el=>textOf(el,70).toUpperCase());
    return header.length>=7 && header.some(x=>x==='SKU') &&
      header.some(x=>/NOME|NAME|NOM/.test(x)) &&
      header.some(x=>/AZIENDA|ENTREPRISE|COMPANY|SOCIÉTÉ|SOCIETE/.test(x));
  })||null;
}
function catalogRows(table){
  if(!table)return [];
  const lines=[];
  for(const tr of [...table.querySelectorAll('tbody tr')].slice(0,1500)){
    const cells=[...tr.querySelectorAll('td')];
    if(cells.length<7)continue;
    const cell=i=>textOf(cells[i],i===1?180:100);
    const sku=cell(0), name=cell(1), tier=cell(2).toUpperCase(),
      cost=euroNumber(cell(3)),price=euroNumber(cell(4)),
      category=cell(5).toUpperCase(),company=cell(6).toUpperCase();
    if(!sku || !name || !['A','B'].includes(tier) ||
      cost===null || price===null || !['GTA','TR'].includes(company) || !category)continue;
    lines.push({sku:sku.slice(0,100),name:name.slice(0,180),tier,
      cost_eur:cost,list_price_eur:price,category:category.slice(0,24),company});
  }
  return lines;
}
function totalProductCount(){
  const page=document.querySelector('main')||document.body;
  const full=String(page?.innerText||'').slice(0,200000);
  const m=full.match(/\b(\d{1,4})\s*(?:PRODOTTI|PRODUCTS|PRODUITS)\b/i);
  return m?Number(m[1]):null;
}
// Only catalog pagination buttons, never reset, checkout, navigation or form controls.
// Kino's translated label may be "Afficher les 1 335 autres produits", 
// "Mostra altri 1335" or "Show 1335 more".  Match intent, not word order.
function cleanLabel(el){
  return textOf(el,140).normalize('NFKC').replace(/[\u00a0\u202f]/g,' ').replace(/\s+/g,' ').trim();
}
function isCatalogExpandLabel(raw){
  const t=String(raw||'').normalize('NFKC').trim().toLowerCase();
  if(t.length<5||t.length>140)return false;
  if(/\b(reset|ripristina|réinitialiser|reinitialiser|logout|déconnexion|esci|delete|remove|supprimer|filtrer|export)\b/i.test(t))return false;
  const action=/(?:mostra|show|load|afficher|voir|charger|carica|visualizza|expand|plus de|ver mais|mostrar)/i.test(t);
  const more=/(?:altri|altre|other|more|plus|autres?|restant|remaining|prodotti|products?|produits?|carica|weiter|ver mais)/i.test(t);
  if(!action||!more)return false;
  // Allow numeric count as prefix, infix or suffix, or an unambiguous plain "show more".
  const numeric=/\d/.test(t);
  const simple=/^(?:mostra altri|show more|load more|afficher plus|voir plus|charger plus|voir davantage|afficher davantage|carica altri)$/i.test(t);
  return numeric||simple;
}
function expandCandidates(){
  return [...document.querySelectorAll('button')]
    .filter(isVisible).map(el=>({el,label:cleanLabel(el)}))
    .filter(x=>isCatalogExpandLabel(x.label));
}
function showMoreButton(){
  // A single recognized load-more control is safe to click. Multiple candidates:
  // prefer a button with 'products' language and a remaining count.
  const a=expandCandidates();
  if(!a.length)return null;
  if(a.length===1)return a[0];
  return a.find(x=>/(?:product|produit|prodott)/i.test(x.label))||null;
}
function catalogPageButtons(){
  const labels=[...document.querySelectorAll('button')]
    .filter(isVisible).map(el=>cleanLabel(el)).filter(Boolean);
  // Return only likely pagination labels; never expose unrelated app text.
  return labels.filter(t=>/(?:mostra|show|load|afficher|voir|charger|carica|altri|autres|more|plus|restant)/i.test(t)).slice(0,8);
}
let catalogBusy=false;
async function collectCatalog(){
  if(catalogBusy||searchBusy) return {ok:false,error:'catalog_collection_busy'};
  catalogBusy=true;
  try {
    if(location.hostname!=='kinocommission.base44.app' || !/kino commission/i.test(document.title))
      return {ok:false,error:'not_kino_catalog'};
    let table=catalogTable();
    if(!table)return {ok:false,error:'catalog_table_not_found'};
    const expected=totalProductCount();
    let clicks=0,stop_reason='no_show_more_button',last_button='';
    // Only click the specifically recognized catalog expansion control. 
    // Does not touch forms, prices, orders, exports, reset or authenticated state.
    while(clicks<35){
      const more=showMoreButton();
      if(!more){stop_reason=expandCandidates().length>1?'ambiguous_buttons':'button_not_identified';break;}
      if(catalogRows(table).length>=1500){stop_reason='catalog_safety_limit';break;}
      const before=catalogRows(table).length;
      last_button=more.label.slice(0,100);
      more.el.click();clicks++;
      let grew=false;
      for(let attempt=0;attempt<35;attempt++){
        await sleep(100);
        table=catalogTable()||table;
        const current=catalogRows(table).length;
        if(current>before){grew=true;break;}
      }
      if(!grew){stop_reason='clicked_but_no_new_rows';break;}
      if(expected!==null && catalogRows(table).length===expected){stop_reason='complete';break;}
    }
    const rows=catalogRows(table),count=rows.length;
    if(!count)return {ok:false,error:'catalog_no_valid_rows'};
    const status=Number.isSafeInteger(expected)&&expected===count?'complete':'partial';
    if(status==='complete')stop_reason='complete';
    else if(clicks>=35)stop_reason='maximum_expand_clicks';
    return {ok:true,result:{catalog:{status,expected_count:expected,collected_count:count,rows,
      diagnostics:{clicks,stop_reason,last_button,
        pagination_labels:catalogPageButtons()}}}};
  }catch{return {ok:false,error:'catalog_collection_failed'};}
  finally {catalogBusy=false;}
}

// v0.4: metadata-only simulator control survey. Never inspect input values,
// form state, cookies, authentication data, backend requests or page scripts.
function simulatorProbe(){
  if(location.hostname!=='kinocommission.base44.app' || !/kino commission/i.test(document.title))
    return {ok:false,error:'not_kino'};
  const main=document.querySelector('main')||document.body;
  const headings=unique([...main.querySelectorAll('h1,h2,h3,[role="heading"]')]
    .filter(isVisible).map(el=>textOf(el,100)),20);
  const els=[...main.querySelectorAll('input,textarea,select,button,[role="combobox"],[role="spinbutton"]')]
    .filter(isVisible).filter(el=>{
      const kind=(el.getAttribute('type')||'').toLowerCase();
      return !['password','hidden','email','file'].includes(kind);
    });
  const controls=els.slice(0,60).map((el,i)=>{
    const tag=el.tagName.toLowerCase();
    const kind=(el.getAttribute('type')||'').toLowerCase();
    let nearby='';
    const lab=el.closest('label')|| (el.id?
       [...document.querySelectorAll('label[for]')].find(x=>x.htmlFor===el.id):null);
    if(lab)nearby=textOf(lab,120);
    else nearby=textOf(el.parentElement,120);
    return {index:i,tag:tag==='textarea'?'textarea':tag,
      control_type:kind.slice(0,30),role:String(el.getAttribute('role')||'').slice(0,35),
      placeholder:String(el.getAttribute('placeholder')||'').slice(0,120),
      aria_label:String(el.getAttribute('aria-label')||'').slice(0,120),
      label:tag==='button'?textOf(el,120):'',
      nearby_text:nearby};
  });
  const hint=['commission','provvigioni','spiff','marge','margine','total','vénte','vendite',
    'quantité','quantita','prezzo','prix','price'];
  const summary_labels=unique(
    [...main.querySelectorAll('h1,h2,h3,h4,strong,small,label,span')]
      .filter(isVisible).map(el=>textOf(el,100))
      .filter(t=>t.length>0&&t.length<=100&&hint.some(x=>t.toLowerCase().includes(x)))
    ,35);
  return {ok:true,result:{simulator:{
    controls,total_visible_controls:els.length,headings,summary_labels,
    collection_status:'metadata_only_no_values'
  }}};
}


// v0.5: bounded reversible catalog search. It types a SKU into the empty simulator
// search field, reads only nearby *visible suggestion labels*, then CLEARS the field.
// Never clicks a result, submits a form, changes GTA/TR, edits price or changes SPIFF.
let searchBusy=false;
function searchInput(){
  const re=/(?:ajout(?:er|ez)|aggiungi|add).{0,70}(?:produit|prodotto|product)/i;
  const list=[...document.querySelectorAll('input:not([type="password"])')]
    .filter(isVisible).filter(el=>re.test(el.getAttribute('placeholder')||''));
  return list.length===1?list[0]:null;
}
function writeText(el,value){
  const proto=window.HTMLInputElement.prototype;
  const setter=Object.getOwnPropertyDescriptor(proto,'value')?.set;
  if(!setter)throw Error('input_setter_unavailable');
  setter.call(el,value);
  el.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:value?'insertText':'deleteContentBackward',data:value||null}));
}
function suggestionLabels(input,sku){
  const r=input.getBoundingClientRect(),items=[],seen=new Set();
  // Preserve v0.6's clickable div/list variants, with the stricter SKU+company parser.
  const selectors='[role="option"],li,[cmdk-item],[data-slot="command-item"],button,div[role="button"],div[class*="cursor-pointer"],div[class*="hover:"]';
  const els=[...document.querySelectorAll(selectors)].filter(isVisible);
  let rejected=0;
  for(const el of els){
    if(el.disabled||el.getAttribute('aria-disabled')==='true'||el.closest('table,thead,tbody,[role="tablist"],nav,header,form#login'))continue;
    const b=el.getBoundingClientRect();
    if(b.width<28||b.height<12||b.height>130)continue;
    if(b.top<r.bottom-10||b.top>r.bottom+540)continue;
    if(b.right<r.left||b.left>r.right)continue;
    const parsed=KinoSearch.classify(textOf(el,181),sku);
    if(!parsed){rejected++;continue;}
    const key=parsed.company+'|'+parsed.sku.toUpperCase();
    if(seen.has(key))continue;
    seen.add(key);
    items.push({tag:['button','li','div','span','p','option'].includes(el.tagName.toLowerCase())?el.tagName.toLowerCase():'div',
      role:String(el.getAttribute('role')||'').slice(0,30),text:parsed.text});
    if(items.length>=18)break;
  }
  return {candidates:items,diagnostics:{input_accepted:input.value===sku,
    rejected_non_products:rejected,
    suggestion_container_detected:Boolean(document.querySelector('[role="listbox"],[cmdk-list],[data-slot="command-list"]'))}};
}
async function probeSearch(query){
  if(searchBusy||catalogBusy)return {ok:false,error:'search_probe_busy'};
  if(location.hostname!=='kinocommission.base44.app'|| !/kino commission/i.test(document.title))
    return {ok:false,error:'not_kino'};
  if(typeof query!=='string'||!/^[A-Za-z0-9][A-Za-z0-9+\/_().-]{0,63}$/.test(query))
    return {ok:false,error:'invalid_sku'};
  const input=searchInput();
  if(!input)return {ok:false,error:'simulator_search_not_unique'};
  // Do not read or report the user's existing search. Avoid overwriting a draft.
  if(input.value.length!==0)return {ok:false,error:'search_field_not_empty'};
  searchBusy=true;let restored=false,report=null,probeError=null,interrupted=false;
  try{
    input.focus();writeText(input,query);
    await sleep(1700);
    if(!input.isConnected)throw Error('search_field_replaced');
    if(input.value!==query){interrupted=true;throw Error('search_interrupted');}
    const observed=suggestionLabels(input,query);
    const mode=observed.candidates.length?'search_observed':'no_matches';
    report={ok:true,result:{search:{query_sku:query,search_field_found:true,
      mode,candidates:observed.candidates,diagnostics:observed.diagnostics,restore_status:'cleared'}}};
  }catch{probeError=interrupted?'search_interrupted_by_user':'search_probe_failed';}
  finally{
    // Never erase text typed by the user while the asynchronous probe was running.
    const current=input.isConnected?input:searchInput();
    if(current&&(current.value===query||current.value==='')&&!interrupted){
      try{writeText(current,'');await sleep(0);restored=current.isConnected&&current.value==='';current.blur();}catch{}
    }else if(current&&current.value!==query){interrupted=true;}
    searchBusy=false;
  }
  if(interrupted)return {ok:false,error:'search_interrupted_by_user'};
  if(!restored)return {ok:false,error:'search_field_restore_failed'};
  if(probeError)return {ok:false,error:probeError};
  return report;
}

chrome.runtime.onMessage.addListener((message,sender,respond)=>{
  if(message?.type==='KINO_INSPECT'){
    try{respond({ok:true,result:snapshot()});}
    catch{respond({ok:false,error:'dom_inspection_failed'});}
  }else if(message?.type==='KINO_CATALOG_SNAPSHOT'){
    void collectCatalog().then(respond).catch(()=>respond({ok:false,error:'catalog_collection_failed'}));
    return true;
  }else if(message?.type==='KINO_SIMULATOR_PROBE'){
    try{respond(simulatorProbe());}
    catch{respond({ok:false,error:'simulator_probe_failed'});}
  }else if(message?.type==='KINO_SIMULATOR_SEARCH_PROBE'){
    void probeSearch(message.sku).then(respond).catch(()=>respond({ok:false,error:'search_probe_failed'}));
    return true;
  }
});
