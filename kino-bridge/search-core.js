'use strict';
// Pure label classification shared by the isolated content script and Node tests.
// No page internals, network, authentication data or product selection.
(function(root){
  const skuPattern=/^[A-Z0-9][A-Z0-9+\/_().-]{0,63}$/i;
  function classify(label,query){
    if(typeof label!=='string'||typeof query!=='string'||!skuPattern.test(query))return null;
    const text=label.normalize('NFKC').replace(/\s+/g,' ').trim();
    if(text.length>180)return null;
    const parts=text.match(/^(\S+)\s+(GTA|TR)\s+(.+)$/i);
    if(!parts||!skuPattern.test(parts[1]))return null;
    const sku=parts[1],company=parts[2].toUpperCase(),name=parts[3].trim();
    if(!name||/\S+\s+(?:GTA|TR)\s+/i.test(name))return null; // combined parent nodes
    const code=sku.toUpperCase(),wanted=query.toUpperCase();
    if(!code.includes(wanted))return null;
    return {sku,company,name,text,exact:code===wanted};
  }
  const api=Object.freeze({classify,validSku:value=>typeof value==='string'&&skuPattern.test(value)});
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.KinoSearch=api;
})(globalThis);
