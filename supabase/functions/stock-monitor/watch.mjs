export function parseWatch(value){
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!['company','product_id','watching'].includes(k))||
  !['TR','GTA'].includes(value.company)||!Number.isSafeInteger(value.product_id)||value.product_id<=0||typeof value.watching!=='boolean')throw Error('invalid_watch');
 return {company:value.company,product_id:value.product_id,watching:value.watching};
}
export function notificationBody(rows){
 const names=rows.filter(r=>r.kind==='back_in_stock').map(r=>String(r.product_name||'Référence').slice(0,80));
 if(names.length===rows.length)return ('Retour en stock : '+names.slice(0,2).join(', ')+(names.length>2?' · +'+(names.length-2)+' référence(s)':'')).slice(0,250);
 const ruptures=rows.filter(r=>r.kind==='out_of_stock').length,retours=names.length;
 return [ruptures?`${ruptures} rupture${ruptures>1?'s':''}`:'',retours?`${retours} retour${retours>1?'s':''} en stock`:''].filter(Boolean).join(' · ')||`${rows.length} variation(s) de stock`;
}
