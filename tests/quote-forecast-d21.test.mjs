import test from 'node:test';
import assert from 'node:assert/strict';
import {simulateQuoteLines,validCatalogResults} from '../validation-v12/assets/quote-forecast-d21.mjs';
const a={snapshot_id:'b495e665-e0ea-4036-85fa-7cf58aeff612',row_index:8,sku:'ML/G',
 product_name:'1 Million',company:'GTA',tier:'B',cost_eur:0.65,quantity:1000,unit_price:1.3};
test('quote forecast matches Kino browser simulator with one final aggregate rounding',()=>{
 const result=simulateQuoteLines([a,{...a,row_index:9,sku:'ML2/G',tier:'A',cost_eur:0.9,unit_price:1.9}]);
 assert.equal(result.payable,false);assert.equal(result.lines.length,2);
 assert.equal(result.sales_ht,3200);
 assert.ok(result.commission_estimate>0);
 assert.equal(result.method,'kino_browser_formula_provisional_without_spiff');
});
test('cost, SKU and quantity guard reject unreliable calculations',()=>{
 assert.throws(()=>simulateQuoteLines([{...a,cost_eur:0}]));
 assert.throws(()=>simulateQuoteLines([{...a,quantity:0}]));
 assert.throws(()=>simulateQuoteLines([{...a,sku:'FT/G/Sample',product_name:'Free Sample'}]));
});
test('catalog lookup does not consider samples as products eligible for a forecast',()=>{
 const list=validCatalogResults({ok:true,snapshot_id:a.snapshot_id,products:[
  {row_index:8,sku:'ML/G',product_name:'1 Million',company:'GTA',tier:'B',cost_eur:'0.65',list_price_eur:'1.20'},
  {row_index:10,sku:'ML/G/Sample',product_name:'1 Million Sample',company:'GTA',tier:'B',cost_eur:'1.95',list_price_eur:'6.00'}]});
 assert.equal(list.length,1);assert.equal(list[0].cost_eur,0.65);
});
