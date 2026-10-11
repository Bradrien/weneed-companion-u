import {sourceTime,sourceCount,sourceText} from './source-state-d34.mjs';
const companies=new Set(['GTA','TR']);
const quantity=x=>{if(typeof x!=='number'||!Number.isFinite(x)||Math.abs(x)>1e12)throw Error('invalid_stock_quantity');return x};
const company=x=>{if(!companies.has(x))throw Error('invalid_stock_company');return x};
const text=(x,n,empty=false)=>sourceText(x,n,{empty});
export function normalizeStockSnapshot(raw,scope={company:'ALL',query:'',offset:0},now=Date.now()){
 if(!raw||typeof raw!=='object'||Array.isArray(raw)||typeof raw.stale!=='boolean'||
  !Array.isArray(raw.items)||!Array.isArray(raw.alerts)||raw.items.length>50||raw.alerts.length>30||
  !['ALL','GTA','TR'].includes(scope.company)||typeof scope.query!=='string'||scope.query.length>120||
  !Number.isSafeInteger(scope.offset)||scope.offset<0||scope.offset>10000)throw Error('invalid_stock_snapshot');
 const checkedAt=sourceTime(raw.checked_at),total=sourceCount(raw.total),interval=sourceCount(raw.scan_interval_minutes,60);
 if(!interval||!Number.isFinite(now)||checkedAt&&Date.parse(checkedAt)>now+300_000)throw Error('invalid_stock_snapshot');
 const summaries=raw.summary===null?[]:raw.summary;
 if(!Array.isArray(summaries)||summaries.length>2)throw Error('invalid_stock_snapshot');
 const seenSummary=new Set(),summary=summaries.map(r=>{
  const c=company(r.company),products=sourceCount(r.products),outOfStock=sourceCount(r.out_of_stock);
  if(seenSummary.has(c)||outOfStock>products)throw Error('invalid_stock_snapshot');seenSummary.add(c);
  return {company:c,products,outOfStock};
 }).sort((a,b)=>a.company.localeCompare(b.company));
 if(checkedAt&&seenSummary.size!==2||!checkedAt&&(total||summary.length||raw.items.length))throw Error('invalid_stock_snapshot');
 const scopeTotal=summary.filter(r=>scope.company==='ALL'||r.company===scope.company).reduce((n,r)=>n+r.products,0);
 if(total>scopeTotal||!scope.query&&total!==scopeTotal||raw.items.length!==Math.min(50,Math.max(0,total-scope.offset)))throw Error('invalid_stock_snapshot');
 const seen=new Set(),items=raw.items.map(r=>{
  const c=company(r.company),id=sourceCount(r.product_id,Number.MAX_SAFE_INTEGER),at=sourceTime(r.checked_at),key=c+':'+id;
  if(!id||seen.has(key)||scope.company!=='ALL'&&c!==scope.company||!at||Date.parse(at)!==Date.parse(checkedAt)||
   !['free_qty','qty_available'].includes(r.quantity_basis))throw Error('invalid_stock_snapshot');
  seen.add(key);return {company:c,id,sku:r.sku==null?'':text(r.sku,250,true),name:text(r.product_name,1000),unit:text(r.unit,120),
   basis:r.quantity_basis,available:quantity(r.available_quantity),onHand:quantity(r.on_hand_quantity),
   forecast:r.forecast_quantity==null?null:quantity(r.forecast_quantity),checkedAt:at};
 });
 const seenAlerts=new Set(),alerts=raw.alerts.map(r=>{
  const c=company(r.company),id=text(r.id,80),at=sourceTime(r.created_at);
  if(seenAlerts.has(id)||scope.company!=='ALL'&&c!==scope.company||!at||
   !['out_of_stock','back_in_stock','quantity_changed'].includes(r.kind))throw Error('invalid_stock_snapshot');
  const previous=quantity(r.previous_quantity),current=quantity(r.current_quantity);
  if(Date.parse(at)>now+300_000||r.kind==='out_of_stock'&&!(previous>0&&current<=0)||
   r.kind==='back_in_stock'&&!(previous<=0&&current>0)||r.kind==='quantity_changed'&&previous===current)throw Error('invalid_stock_snapshot');
  seenAlerts.add(id);return {id,company:c,kind:r.kind,name:text(r.product_name,1000),unit:text(r.unit,120),
   previous,current,at};
 });
 return {checkedAt,total,summary,items,alerts,scope:{...scope},interval,
  stale:raw.stale||!checkedAt||now-Date.parse(checkedAt)>720_000,
  lastError:typeof raw.last_error==='string'&&raw.last_error.length>0};
}
