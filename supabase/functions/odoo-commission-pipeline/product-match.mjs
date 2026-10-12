// Small listing errors are tolerated; company, numbers and quality markers stay exact.
const txt=x=>typeof x==='string'?x:'';
export const cleanSku=x=>txt(x).normalize('NFKC').toUpperCase().replace(/\s+/g,'');
export function productWords(value){
 const first=txt(value).split(/\r?\n/)[0].replace(/^\s*\[[^\]]{1,100}\]\s*/,'');
 return first.normalize('NFKD').replace(/\p{M}/gu,'').toLowerCase()
  .replace(/(\d)\s*(?:grams?|gr|g)(?=$|[^a-z])/g,'$1')
  .match(/[\p{L}\p{N}]+|\+/gu)||[];
}
function oneEdit(a,b){
 if(Math.abs(a.length-b.length)>1||a===b)return false;
 let i=0,j=0,edits=0;
 while(i<a.length&&j<b.length){
  if(a[i]===b[j]){i++;j++;continue}
  if(++edits>1)return false;
  if(a.length>=b.length)i++;if(b.length>=a.length)j++;
 }
 return edits+(i<a.length||j<b.length?1:0)===1;
}
export function compareProductNames(a,b){
 const x=productWords(a),y=productWords(b);
 if(x.length<2||x.length!==y.length)return null;
 const different=x.flatMap((v,i)=>v===y[i]?[]:[i]);
 if(!different.length)return 'normalized_name';
 if(different.length!==1)return null;
 const i=different[0];
 return /^[a-z]{5,}$/.test(x[i])&&/^[a-z]{5,}$/.test(y[i])&&oneEdit(x[i],y[i])?'minor_name_typo':null;
}
export function compatibleListingSku(a,b){
 const x=cleanSku(a),y=cleanSku(b);if(x===y)return true;
 const p=x.split('/'),q=y.split('/');
 return p.length>=2&&p.length===q.length&&p.slice(1).every((v,i)=>v===q[i+1])&&
  /^[A-Z]{3,}$/.test(p[0])&&/^[A-Z]{3,}$/.test(q[0])&&oneEdit(p[0],q[0]);
}
export function validateListingMatch(match,{company,sku,product}){
 if(!match||match.company!==company||match.unique!==true||
  !['label_sku','normalized_name','minor_name_typo','minor_sku_typo'].includes(match.method)||
  typeof match.catalog_sku!=='string'||!cleanSku(match.catalog_sku)||
  typeof match.catalog_name!=='string'||match.catalog_name.length>1000)return false;
 const quality=compareProductNames(product,match.catalog_name);if(!quality)return false;
 const prefix=txt(product).match(/^\s*\[([A-Za-z0-9_+./ -]{2,100})\]/)?.[1]||'';
 const source=cleanSku(sku)||cleanSku(prefix);
 if(source&&!compatibleListingSku(source,match.catalog_sku))return false;
 if(match.method==='label_sku')return !cleanSku(sku)&&!!prefix&&cleanSku(prefix)===cleanSku(match.catalog_sku);
 if(match.method==='minor_sku_typo')return !!source&&source!==cleanSku(match.catalog_sku)&&quality==='normalized_name';
 return quality===match.method&&(!source||source===cleanSku(match.catalog_sku));
}
export function resolveCatalogProduct({company,sku,product,catalog,duplicates=new Set(),catalogAvailable=true}){
 const source=cleanSku(sku),key=company+'|'+source;
 if(!catalogAvailable)return {row:null,match:null,reason:'catalog_unavailable'};
 if(source&&duplicates.has(key))return {row:null,match:null,reason:'ambiguous_sku'};
 if(source&&catalog.has(key))return {row:catalog.get(key),match:null,reason:null};
 const prefix=txt(product).match(/^\s*\[([A-Za-z0-9_+./ -]{2,100})\]/)?.[1]||'';
 const reference=source||cleanSku(prefix),candidates=[];
 for(const [k,row] of catalog){
  if(!k.startsWith(company+'|'))continue;
  const code=cleanSku(row.sku||k.slice(company.length+1)),quality=compareProductNames(product,row.product_name);
  if(!quality||reference&&!compatibleListingSku(reference,code))continue;
  const method=!source&&reference===code?'label_sku':reference&&reference!==code?
   quality==='normalized_name'?'minor_sku_typo':null:quality;
  if(method)candidates.push({row,key:k,quality,method,code});
 }
 const exact=candidates.filter(c=>c.quality==='normalized_name'),pool=exact.length?exact:candidates;
 if(pool.length!==1||duplicates.has(pool[0]?.key))return {row:null,match:null,
  reason:pool.length?'ambiguous_sku':source?'missing_kino_match':'missing_odoo_sku'};
 const c=pool[0],match={method:c.method,company,catalog_sku:c.code,catalog_name:txt(c.row.product_name),unique:true};
 if(!validateListingMatch(match,{company,sku,product}))return {row:null,match:null,reason:'missing_kino_match'};
 return {row:c.row,match,reason:null};
}
