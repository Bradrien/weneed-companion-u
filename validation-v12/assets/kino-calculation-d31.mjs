/** Kino browser arithmetic, without SPIFF. Does not establish cost history or entitlement. */
export function kinoCommissionRate(tier,ratio){
 if(!['A','B'].includes(tier)||!Number.isFinite(ratio))throw Error('invalid_calculation');
 if(ratio<=0)return tier==='A'?0.2:0.22254;
 if(tier==='B')return ratio>=1?0.3:0.22254+ratio*(0.3-0.22254);
 if(ratio>=0.8)return 0.3;
 if(ratio<=0.15)return 0.2+ratio/0.15*(0.2321-0.2);
 return 0.2321+(ratio-0.15)/0.65*(0.3-0.2321);
}
export function calculateKinoLine({tier,cost,quantity,subtotalHT}){
 if(!['A','B'].includes(tier)||[cost,quantity,subtotalHT].some(x=>
  typeof x!=='number'||!Number.isFinite(x))||cost<=0||quantity<=0||subtotalHT<0)
  throw Error('invalid_calculation');
 const netUnitPrice=subtotalHT/quantity,costMultiplier=tier==='A'?1.25:1.15,
  adjustedUnitCost=cost*costMultiplier,unitMargin=netUnitPrice-adjustedUnitCost,
  margin=unitMargin*quantity,marginRatio=unitMargin/cost,
  rate=margin>0?kinoCommissionRate(tier,marginRatio):0,
  amount=Math.round(Math.max(0,margin)*rate*100);
 if(!Number.isSafeInteger(amount)||[netUnitPrice,adjustedUnitCost,unitMargin,margin,marginRatio]
  .some(x=>!Number.isFinite(x)))throw Error('invalid_calculation');
 return {sales:subtotalHT,netUnitPrice,costMultiplier,adjustedUnitCost,unitMargin,margin,marginRatio,
  rate,commission:amount/100};
}
