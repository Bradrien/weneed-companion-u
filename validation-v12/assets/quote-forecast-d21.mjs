/** D21 quote forecasts: replication of Kino browser algorithm, not Kino server payouts.
 * Inputs: verified catalogue SKU reference + quote quantity IN THAT SKU billing unit.
 * SPIFF disabled, excludes sample SKUs, does not infer financial entitlement.
 */
import {simulateKinoLine} from './kino-simulator-d7.mjs';

export function simulateQuoteLines(lines){
 if(!Array.isArray(lines)||lines.length===0||lines.length>20)throw Error('invalid_quote_lines');
 const result=[];let sales=0,comm=0;
 for(const l of lines){
  if(!l||!Number.isInteger(l.row_index)||l.row_index<0||
   typeof l.sku!=='string'||!l.sku.trim()||typeof l.tier!=='string'||!['A','B'].includes(l.tier)||
   typeof l.product_name!=='string'||typeof l.snapshot_id!=='string'||
   !/^[0-9a-f]{8}-[0-9a-f-]{27,}$/.test(l.snapshot_id)||
   /sample|échantillon|echantillon/i.test(l.sku+' '+l.product_name))throw Error('invalid_quote_product');
  const qty=Number(l.quantity),price=Number(l.unit_price),cost=Number(l.cost_eur);
  if(!Number.isFinite(qty)||qty<=0||qty>100000||
   !Number.isFinite(price)||price<=0||price>1000000||
   !Number.isFinite(cost)||cost<=0||cost>1000000)throw Error('invalid_quote_price_or_cost');
  const calc=simulateKinoLine({tier:l.tier,cost},{price,quantity:qty,spiff:false});
  if(!Number.isFinite(calc.commission)||!Number.isFinite(calc.sales))throw Error('invalid_quote_forecast');
  const salesLine=Math.round(calc.sales*100)/100;
  result.push({sku:l.sku,product_name:l.product_name,company:l.company||'',snapshot_id:l.snapshot_id,
    row_index:l.row_index,tier:l.tier,quantity:qty,unit_price:price,
    cost_eur:cost,sales_ht:salesLine,commission_estimate:Math.round(calc.commission*100)/100,
    rate:calc.rate,unit_confirmed:false});
  sales+=calc.sales;comm+=calc.commission;
 }
 return {lines:result,sales_ht:Math.round(sales*100)/100,
  commission_estimate:Math.round(comm*100)/100,
  coverage:'selected_kino_catalog_rows_only',
  method:'kino_browser_formula_provisional_without_spiff',
  payable:false};
}
export function validCatalogResults(v){
 if(!v||v.ok!==true||!Array.isArray(v.products)||v.products.length>25||
   typeof v.snapshot_id!=='string')throw Error('invalid_catalog_response');
 return v.products.filter(p=>p&&Number.isInteger(p.row_index)&&
  ['A','B'].includes(p.tier)&&typeof p.sku==='string'&&typeof p.product_name==='string'&&
  Number.isFinite(Number(p.cost_eur))&&Number(p.cost_eur)>0&&
  !/sample|échantillon|echantillon/i.test(p.sku+' '+p.product_name)).map(p=>({
   row_index:p.row_index,sku:p.sku,product_name:p.product_name,
   company:p.company,tier:p.tier,snapshot_id:v.snapshot_id,
   cost_eur:Number(p.cost_eur),list_price_eur:Number(p.list_price_eur)
  }));
}
